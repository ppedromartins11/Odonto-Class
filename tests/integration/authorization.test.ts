import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createQaAdmin } from "./helpers";

type Role = "administrador" | "dentista" | "recepcao";

type TestIdentity = {
  id: string;
  email: string;
  password: string;
  role: Role;
};

const REQUIRED_MARKER = "I_ACKNOWLEDGE_FAKE_DATA_ONLY";
const createdUsers: TestIdentity[] = [];

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} nao configurada em .env.test.local.`);
  return value;
}

function userClient(url: string, anonKey: string) {
  return createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

describe("autorizacao Sprint 1.5 em homologacao", () => {
  let url: string;
  let anonKey: string;
  let serviceKey: string;
  let service: SupabaseClient;
  let adminSession: SupabaseClient;
  let adminId: string;
  let disposableAdmin: TestIdentity;
  let dentist: TestIdentity;
  let reception: TestIdentity;
  let roleTarget: TestIdentity;
  let inactive: TestIdentity;
  let orphan: TestIdentity;

  async function createIdentity(role: Role): Promise<TestIdentity> {
    const suffix = randomUUID();
    const identity: Omit<TestIdentity, "id"> = {
      email: `qa_rc_sprint15-${role}-${suffix}@example.com`,
      password: `Tmp-${randomUUID()}-A9!`,
      role,
    };

    const { data, error } = await service.auth.admin.createUser({
      email: identity.email,
      password: identity.password,
      email_confirm: true,
      user_metadata: {
        nome: `QA_RC_${role}_${suffix}`,
        perfil: role,
        created_by: adminId,
      },
    });

    if (error || !data.user) {
      throw new Error(`Falha ao criar identidade ficticia ${role}: ${error?.code}`);
    }

    const result = { ...identity, id: data.user.id };
    createdUsers.push(result);
    return result;
  }

  async function signedIn(identity: Pick<TestIdentity, "email" | "password">) {
    const client = userClient(url, anonKey);
    const { error } = await client.auth.signInWithPassword(identity);
    expect(error).toBeNull();
    return client;
  }

  beforeAll(async () => {
    if (process.env.SUPABASE_TEST_HOMOLOGATION !== REQUIRED_MARKER) {
      throw new Error(
        "Homologacao nao confirmada. Configure SUPABASE_TEST_HOMOLOGATION no arquivo .env.test.local."
      );
    }

    url = requiredEnv("SUPABASE_TEST_URL");
    anonKey = requiredEnv("SUPABASE_TEST_ANON_KEY");
    serviceKey = requiredEnv("SUPABASE_TEST_SERVICE_ROLE_KEY");
    service = createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const qaAdmin = await createQaAdmin(service, url, anonKey);
    adminSession = qaAdmin.session;
    adminId = qaAdmin.identity.id;
    createdUsers.push(qaAdmin.identity);

    const { data: adminProfile, error: profileError } = await adminSession
      .from("usuarios")
      .select("perfil, status")
      .eq("id", adminId)
      .single();
    if (
      profileError ||
      adminProfile?.perfil !== "administrador" ||
      adminProfile.status !== "ativo"
    ) {
      throw new Error("A conta de teste precisa ser um administrador ativo.");
    }

    disposableAdmin = await createIdentity("administrador");
    dentist = await createIdentity("dentista");
    reception = await createIdentity("recepcao");
    roleTarget = await createIdentity("recepcao");
    inactive = await createIdentity("recepcao");
    orphan = await createIdentity("recepcao");

    const { error: inactiveError } = await adminSession.rpc("update_user_access", {
      p_usuario_id: inactive.id,
      p_perfil: null,
      p_status: "inativo",
    });
    if (inactiveError) throw new Error(`Falha ao preparar inativo: ${inactiveError.code}`);

    const { error: orphanError } = await service
      .from("usuarios")
      .delete()
      .eq("id", orphan.id);
    if (orphanError) throw new Error(`Falha ao preparar sem perfil: ${orphanError.code}`);
  });

  afterAll(async () => {
    if (!service) return;

    const createdIds = createdUsers.map((identity) => identity.id);
    if (createdIds.length > 0) {
      await service.from("auditoria").delete().in("entidade_id", createdIds);
      await service.from("auditoria").delete().in("usuario_id", createdIds);
    }

    for (const identity of [...createdUsers].reverse()) {
      await service.from("profissionais").delete().eq("usuario_id", identity.id);
      await service.from("usuarios").delete().eq("id", identity.id);
      await service.auth.admin.deleteUser(identity.id);
    }
  });

  it("administrador ativo enxerga usuarios e pode alterar acesso", async () => {
    const { data: rows, error } = await adminSession
      .from("usuarios")
      .select("id")
      .in("id", [dentist.id, reception.id]);
    expect(error).toBeNull();
    expect(rows).toHaveLength(2);

    const { error: updateError } = await adminSession.rpc("update_user_access", {
      p_usuario_id: roleTarget.id,
      p_perfil: "dentista",
      p_status: null,
    });
    expect(updateError).toBeNull();

    const { data: professional } = await service
      .from("profissionais")
      .select("status")
      .eq("usuario_id", roleTarget.id)
      .single();
    expect(professional?.status).toBe("ativo");
  });

  it.each([
    ["dentista", () => dentist],
    ["recepcao", () => reception],
  ])("%s le apenas o proprio perfil e nao altera acesso", async (_label, getIdentity) => {
    const identity = getIdentity();
    const client = await signedIn(identity);
    const { data: rows, error } = await client.from("usuarios").select("id");
    expect(error).toBeNull();
    expect(rows).toEqual([{ id: identity.id }]);

    const { error: updateError } = await client.rpc("update_user_access", {
      p_usuario_id: dentist.id,
      p_perfil: "administrador",
      p_status: null,
    });
    expect(updateError).not.toBeNull();
  });

  it("usuario inativo perde as policies dependentes de usuario ativo", async () => {
    const client = await signedIn(inactive);
    const { data: active, error: activeError } = await client.rpc("is_active_user");
    expect(activeError).toBeNull();
    expect(active).toBe(false);

    const { data: professionals, error } = await client
      .from("profissionais")
      .select("id");
    expect(error).toBeNull();
    expect(professionals).toEqual([]);
  });

  it("usuario autenticado sem perfil fica em fail-closed", async () => {
    const client = await signedIn(orphan);
    const { data: active, error: activeError } = await client.rpc("is_active_user");
    expect(activeError).toBeNull();
    expect(active).toBe(false);

    const { data: profile, error } = await client.from("usuarios").select("id");
    expect(error).toBeNull();
    expect(profile).toEqual([]);
  });

  it("impede autodesativacao ou autodowngrade de administrador", async () => {
    const client = await signedIn(disposableAdmin);
    const { error } = await client.rpc("update_user_access", {
      p_usuario_id: disposableAdmin.id,
      p_perfil: "recepcao",
      p_status: "inativo",
    });
    expect(error).not.toBeNull();
  });

  it("somente administrador consulta auditoria", async () => {
    const { error: adminError } = await adminSession
      .from("auditoria")
      .select("id")
      .limit(1);
    expect(adminError).toBeNull();

    const client = await signedIn(dentist);
    const { data, error } = await client.from("auditoria").select("id").limit(1);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });
});
