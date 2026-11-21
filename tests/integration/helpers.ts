import { createHmac, randomUUID } from "node:crypto";
import { createClient, type AdminUserAttributes, type SupabaseClient } from "@supabase/supabase-js";

export type QaIdentity = {
  id: string;
  email: string;
  password: string;
  role: "administrador";
};

function decodeBase32(value: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of value.replace(/[=\s-]/g, "").toUpperCase()) {
    const index = alphabet.indexOf(char);
    if (index < 0) throw new Error("Segredo TOTP de fixture invalido.");
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let offset = 0; offset + 8 <= bits.length; offset += 8) bytes.push(Number.parseInt(bits.slice(offset, offset + 8), 2));
  return Buffer.from(bytes);
}

// Uso exclusivo da suite remota: produz o OTP efemero para elevar a fixture
// descartavel via API oficial do Supabase. Nenhum segredo e persistido ou logado.
function currentTotp(secret: string) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac("sha1", decodeBase32(secret)).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const value = ((digest[offset] & 0x7f) << 24) | (digest[offset + 1] << 16) | (digest[offset + 2] << 8) | digest[offset + 3];
  return String(value % 1_000_000).padStart(6, "0");
}

export async function elevateQaAdminToAal2(session: SupabaseClient) {
  const { data: enrolled, error: enrollError } = await session.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: "QA only",
  });
  // Ownership imediato: qualquer falha apos enroll pertence a este escopo.
  // No sucesso o chamador recebe o ID e assume o cleanup normal.
  const factorId = enrolled?.id;
  try {
    if (enrollError || !factorId || !enrolled?.totp?.secret) throw new Error("Falha ao preparar MFA da fixture.", { cause: enrollError });
    const { data: challenge, error: challengeError } = await session.auth.mfa.challenge({ factorId });
    if (challengeError || !challenge?.id) throw new Error("Falha no challenge MFA da fixture.", { cause: challengeError });
    const { error: verifyError } = await session.auth.mfa.verify({
      factorId, challengeId: challenge.id, code: currentTotp(enrolled.totp.secret),
    });
    if (verifyError) throw new Error("Falha ao elevar MFA da fixture.", { cause: verifyError });
    const { data: assurance, error: assuranceError } = await session.auth.mfa.getAuthenticatorAssuranceLevel();
    if (assuranceError || assurance?.currentLevel !== "aal2") throw new Error("Fixture administrativa nao atingiu AAL2.", { cause: assuranceError });
    return factorId;
  } catch (error) {
    if (factorId) {
      try {
        const removed = await session.auth.mfa.unenroll({ factorId });
        if (removed.error) throw removed.error;
      } catch {
        // Mensagem fixa: jamais serializar erro Auth, ID, OTP, secret ou URI.
        console.error("QA_MFA_CLEANUP_FAILED: falha ao remover fator desta execucao.");
      }
    }
    throw error;
  }
}


const qaAdministrators = new WeakMap<SupabaseClient, SupabaseClient>();

// O servico entrega o convite; somente a sessao admin AAL2 autoriza o perfil.
// generateLink evita enviar email de teste. O Auth executa o mesmo fluxo invite.
export async function createQaUser(service: SupabaseClient, attributes: AdminUserAttributes) {
  const actor = qaAdministrators.get(service);
  if (!actor) throw new Error("Prepare createQaAdmin antes das identidades QA.");
  const metadata = attributes.user_metadata as { nome?: string; perfil?: string } | undefined;
  const { data: invitation, error } = await actor.rpc("prepare_user_invitation", {
    p_email: attributes.email, p_nome: metadata?.nome,
    p_perfil: metadata?.perfil,
  });
  if (error || !invitation) throw new Error("Falha ao autorizar fixture QA: " + error?.code);
  try {
    const generated = await service.auth.admin.generateLink({
      type: "invite", email: attributes.email!,
      options: { data: { provisioning_token: invitation.token } },
    });
    if (generated.error || !generated.data.user) throw new Error("Falha no convite QA: " + generated.error?.message);
    const updated = await service.auth.admin.updateUserById(generated.data.user.id, {
      password: attributes.password, email_confirm: true,
    });
    if (updated.error) {
      await service.from("auditoria").delete().eq("entidade_id", generated.data.user.id);
      await service.from("profissionais").delete().eq("usuario_id", generated.data.user.id);
      await service.from("usuarios").delete().eq("id", generated.data.user.id);
      await service.auth.admin.deleteUser(generated.data.user.id);
    }
    return updated;
  } finally {
    // So esta autorizacao QA; ausencia da linha tambem impede replay do token.
    const cleaned = await service.from("convites_provisionamento").delete().eq("id", invitation.id);
    if (cleaned.error) throw new Error("Cleanup do convite QA falhou: " + cleaned.error.code);
  }
}

export async function authorizeQaProvisioner(service: SupabaseClient, url: string, anonKey: string) {
  if (process.env.SUPABASE_TEST_HOMOLOGATION !== "I_ACKNOWLEDGE_FAKE_DATA_ONLY") {
    throw new Error("Homologacao ficticia nao confirmada.");
  }
  const bootstrap = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const signed = await bootstrap.auth.signInWithPassword({
    email: process.env.SUPABASE_TEST_ADMIN_EMAIL ?? "",
    password: process.env.SUPABASE_TEST_ADMIN_PASSWORD ?? "",
  });
  if (signed.error || !signed.data.user) throw new Error("Administrador QA de bootstrap indisponivel.");
  const profile = await bootstrap.from("usuarios").select("nome,perfil,status").eq("id", signed.data.user.id).single();
  if (profile.error || profile.data.perfil !== "administrador" || profile.data.status !== "ativo"
    || !/^(QA_|HOMOLOG_)/.test(profile.data.nome)) {
    throw new Error("Bootstrap exige administrador explicitamente reservado a QA.");
  }
  // Fator efemero exclusivo da conta QA: cadastrado e removido nesta chamada.
  const factorId = await elevateQaAdminToAal2(bootstrap);
  qaAdministrators.set(service, bootstrap);
  return { session: bootstrap, factorId, id: signed.data.user.id };
}

export async function createQaAdmin(service: SupabaseClient, url: string, anonKey: string) {
  const { session: bootstrap, factorId } = await authorizeQaProvisioner(service, url, anonKey);
  const suffix = randomUUID();
  const credentials = { email: `qa_rc_admin-${suffix}@example.com`, password: `Tmp-${randomUUID()}-A9!` };
  let created;
  let primaryFailed = false;
  try {
    created = await createQaUser(service, { ...credentials, user_metadata: { nome: `QA_RC_ADMIN_${suffix}`, perfil: "administrador" } });
    if (created.error || !created.data.user) throw new Error("Falha ao criar administrador QA.", { cause: created.error });
  } catch (error) {
    primaryFailed = true;
    throw error;
  } finally {
    try {
      // Apenas o ID devolvido pelo enroll desta execucao; nunca listar fatores.
      const removed = await bootstrap.auth.mfa.unenroll({ factorId });
      if (removed.error) throw removed.error;
    } catch {
      if (!primaryFailed) throw new Error("Falha ao remover fator temporario do bootstrap QA.");
      console.error("QA_MFA_CLEANUP_FAILED: falha ao remover fator desta execucao.");
    }
  }
  const identity: QaIdentity = { ...credentials, id: created.data.user.id, role: "administrador" };
  const session = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  try {
    const login = await session.auth.signInWithPassword(credentials);
    if (login.error) throw new Error("Falha ao autenticar administrador QA.");
    await elevateQaAdminToAal2(session);
  } catch (error) {
    for (const cleanup of [
      () => service.from("auditoria").delete().eq("entidade_id", identity.id),
      () => service.from("usuarios").delete().eq("id", identity.id),
      () => service.auth.admin.deleteUser(identity.id),
    ]) {
      try {
        const removed = await cleanup();
        if (removed.error) throw removed.error;
      } catch {
        console.error("QA_USER_CLEANUP_FAILED: falha ao remover identidade desta execucao.");
      }
    }
    throw error;
  }
  qaAdministrators.set(service, session);
  return { identity, session };
}
