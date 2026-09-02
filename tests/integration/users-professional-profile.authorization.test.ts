import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createQaAdmin } from "./helpers";

const ACK = "I_ACKNOWLEDGE_FAKE_DATA_ONLY";
type Role = "administrador" | "recepcao" | "dentista";
type Identity = { id: string; email: string; password: string; role: Role };
const users: Identity[] = [];
let service: SupabaseClient, admin: SupabaseClient, reception: SupabaseClient, dentist: SupabaseClient;
let adminId: string, dentistId: string, secondDentistId: string, inactive: Identity, orphan: Identity;

function required(name: string) { const value = process.env[name]; if (!value) throw new Error(`${name} nao configurada em .env.test.local.`); return value; }
function fresh(url: string, anon: string) { return createClient(url, anon, { auth: { autoRefreshToken: false, persistSession: false } }); }
async function login(url: string, anon: string, identity: Pick<Identity, "email" | "password">) { const client = fresh(url, anon); expect((await client.auth.signInWithPassword(identity)).error).toBeNull(); return client; }
async function createIdentity(role: Role) {
  const suffix = randomUUID();
  const email = `qa_usr_${role}_${suffix}@example.com`; const password = `Tmp-${randomUUID()}-A9!`;
  const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { nome: `QA_USR_${role}_${suffix}`, perfil: role, created_by: adminId } });
  if (error || !data.user) throw error ?? new Error("QA_USR usuario ausente.");
  const identity = { id: data.user.id, email, password, role }; users.push(identity); return identity;
}

describe("QA_USR_: edicao administrativa de usuario e CRO", () => {
  beforeAll(async () => {
    expect(process.env.SUPABASE_TEST_HOMOLOGATION).toBe(ACK);
    const url = required("SUPABASE_TEST_URL"), anon = required("SUPABASE_TEST_ANON_KEY");
    service = createClient(url, required("SUPABASE_TEST_SERVICE_ROLE_KEY"), { auth: { autoRefreshToken: false, persistSession: false } });
    const qaAdmin = await createQaAdmin(service, url, anon); admin = qaAdmin.session; adminId = qaAdmin.identity.id; users.push(qaAdmin.identity);
    const receptionIdentity = await createIdentity("recepcao"); const dentistIdentity = await createIdentity("dentista"); const secondDentistIdentity = await createIdentity("dentista"); inactive = await createIdentity("recepcao"); orphan = await createIdentity("recepcao");
    reception = await login(url, anon, receptionIdentity); dentist = await login(url, anon, dentistIdentity); dentistId = dentistIdentity.id; secondDentistId = secondDentistIdentity.id;
    expect((await admin.rpc("update_user_access", { p_usuario_id: inactive.id, p_perfil: null, p_status: "inativo" })).error).toBeNull();
    expect((await service.from("usuarios").delete().eq("id", orphan.id)).error).toBeNull();
  });

  afterAll(async () => {
    if (!service) return;
    const ids = users.map((user) => user.id);
    if (ids.length) await service.from("auditoria").delete().in("usuario_id", ids);
    if (ids.length) await service.from("profissionais").delete().in("usuario_id", ids);
    if (ids.length) await service.from("usuarios").delete().in("id", ids);
    for (const user of users.reverse()) await service.auth.admin.deleteUser(user.id);
  });

  it("permite ao administrador alterar nome e CRO, inclusive limpar CRO", async () => {
    const first = await admin.rpc("update_user_profile", { p_usuario_id: dentistId, p_nome: "QA_USR Dentista Atualizado", p_registro_profissional: "  CRO-MS 12345  " });
    expect(first.error).toBeNull();
    const professional = await service.from("profissionais").select("registro_profissional").eq("usuario_id", dentistId).single();
    expect(professional.data?.registro_profissional).toBe("CRO-MS 12345");
    expect((await admin.rpc("update_user_profile", { p_usuario_id: dentistId, p_nome: "QA_USR Dentista Atualizado", p_registro_profissional: "" })).error).toBeNull();
    expect((await service.from("profissionais").select("registro_profissional").eq("usuario_id", dentistId).single()).data?.registro_profissional).toBeNull();
    const { data: audit } = await service.from("auditoria").select("dados").eq("usuario_id", adminId).eq("entidade_id", dentistId).eq("evento", "usuario_dados_atualizados");
    expect(JSON.stringify(audit)).toContain("campos_alterados");
    expect(JSON.stringify(audit)).not.toContain("CRO-MS 12345");
  });

  it("rejeita CRO duplicado atomicamente e nao deixa alteracao parcial", async () => {
    expect((await admin.rpc("update_user_profile", { p_usuario_id: dentistId, p_nome: "QA_USR Primeiro", p_registro_profissional: "CRO-MS 12345" })).error).toBeNull();
    const duplicate = await admin.rpc("update_user_profile", { p_usuario_id: secondDentistId, p_nome: "QA_USR Nao Deve Salvar", p_registro_profissional: "cro-ms 12345" });
    expect(duplicate.error).not.toBeNull();
    expect((await service.from("usuarios").select("nome").eq("id", secondDentistId).single()).data?.nome).not.toBe("QA_USR Nao Deve Salvar");
  });

  it("permite ao administrador editar um dentista inativo existente", async () => {
    expect((await admin.rpc("update_user_access", { p_usuario_id: secondDentistId, p_perfil: null, p_status: "inativo" })).error).toBeNull();
    expect((await admin.rpc("update_user_profile", { p_usuario_id: secondDentistId, p_nome: "QA_USR Dentista Inativo", p_registro_profissional: "CRO-MS 54321" })).error).toBeNull();
    expect((await service.from("profissionais").select("registro_profissional").eq("usuario_id", secondDentistId).single()).data?.registro_profissional).toBe("CRO-MS 54321");
  });

  it("nega recepcao, dentista, inativo, sem perfil e DML direto", async () => {
    expect((await reception.rpc("update_user_profile", { p_usuario_id: dentistId, p_nome: "QA_USR Bloqueado", p_registro_profissional: null })).error).not.toBeNull();
    expect((await dentist.rpc("update_user_profile", { p_usuario_id: dentistId, p_nome: "QA_USR Bloqueado", p_registro_profissional: "CRO-MS 9" })).error).not.toBeNull();
    const url = required("SUPABASE_TEST_URL"), anon = required("SUPABASE_TEST_ANON_KEY");
    for (const identity of [inactive, orphan]) { const client = await login(url, anon, identity); expect((await client.rpc("update_user_profile", { p_usuario_id: dentistId, p_nome: "QA_USR Bloqueado", p_registro_profissional: null })).error).not.toBeNull(); }
    expect((await admin.from("usuarios").update({ nome: "QA_USR Direto" }).eq("id", dentistId)).error).not.toBeNull();
    expect((await admin.from("profissionais").update({ registro_profissional: "CRO-MS 99" }).eq("usuario_id", dentistId)).error).not.toBeNull();
  });

  it("falha sem profissional e preserva o nome sem criar linha artificial", async () => {
    const inconsistent = await createIdentity("dentista");
    expect((await service.from("profissionais").delete().eq("usuario_id", inconsistent.id)).error).toBeNull();
    const before = await service.from("usuarios").select("nome").eq("id", inconsistent.id).single();
    expect((await admin.rpc("update_user_profile", { p_usuario_id: inconsistent.id, p_nome: "QA_USR Inconsistente", p_registro_profissional: "CRO-MS 999" })).error).not.toBeNull();
    expect((await service.from("usuarios").select("nome").eq("id", inconsistent.id).single()).data?.nome).toBe(before.data?.nome);
    expect((await service.from("profissionais").select("id").eq("usuario_id", inconsistent.id)).data).toEqual([]);
  });
});
