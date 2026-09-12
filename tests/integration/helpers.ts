import { createHmac, randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

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
  if (enrollError || !enrolled.totp?.secret) throw new Error(`Falha ao preparar MFA da fixture: ${enrollError?.code ?? "sem_fator"}`);
  const { error: verifyError } = await session.auth.mfa.challengeAndVerify({
    factorId: enrolled.id,
    code: currentTotp(enrolled.totp.secret),
  });
  if (verifyError) throw new Error(`Falha ao elevar MFA da fixture: ${verifyError.code}`);
  const { data: assurance, error: assuranceError } = await session.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assuranceError || assurance?.currentLevel !== "aal2") throw new Error("Fixture administrativa nao atingiu AAL2.");
}

export async function createQaAdmin(
  service: SupabaseClient,
  url: string,
  anonKey: string
) {
  const { data: profileRows, error: profileError } = await service
    .from("usuarios")
    .select("id")
    .eq("perfil", "administrador")
    .eq("status", "ativo");
  if (profileError) throw new Error(`Falha ao localizar administrador ativo: ${profileError.code}`);

  const { data: authRows, error: authError } = await service.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  if (authError) throw new Error(`Falha ao conferir identidades da homologacao: ${authError.code}`);

  const authIds = new Set(authRows.users.map((user) => user.id));
  const creatorId = profileRows?.find((profile) => authIds.has(profile.id))?.id;
  if (!creatorId) throw new Error("Homologacao sem administrador ativo consistente para criar fixtures QA_RC_.");

  const suffix = randomUUID();
  const identity: Omit<QaIdentity, "id"> = {
    email: `qa_rc_admin-${suffix}@example.com`,
    password: `Tmp-${randomUUID()}-A9!`,
    role: "administrador",
  };
  const { data, error } = await service.auth.admin.createUser({
    email: identity.email,
    password: identity.password,
    email_confirm: true,
    user_metadata: {
      nome: `QA_RC_ADMIN_${suffix}`,
      perfil: identity.role,
      created_by: creatorId,
    },
  });
  if (error || !data.user) throw new Error(`Falha ao criar QA_RC_ADMIN: ${error?.code ?? "sem_usuario"}`);

  const result: QaIdentity = { ...identity, id: data.user.id };
  const session = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error: loginError } = await session.auth.signInWithPassword(result);
  if (loginError) {
    await service.from("usuarios").delete().eq("id", result.id);
    await service.auth.admin.deleteUser(result.id);
    throw new Error(`Falha ao autenticar QA_RC_ADMIN: ${loginError.code}`);
  }
  try {
    await elevateQaAdminToAal2(session);
  } catch (mfaError) {
    await service.from("usuarios").delete().eq("id", result.id);
    await service.auth.admin.deleteUser(result.id);
    throw mfaError;
  }
  return { identity: result, session };
}
