import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createQaAdmin } from "./helpers";

const ACK = "I_ACKNOWLEDGE_FAKE_DATA_ONLY";
type Role = "administrador" | "recepcao" | "dentista";
type Identity = { id: string; email: string; password: string; role: Role };
const users: Identity[] = [], budgetIds: string[] = [], patientIds: string[] = [];
let url: string, anon: string, service: SupabaseClient, admin: SupabaseClient, reception: SupabaseClient, dentistA: SupabaseClient, dentistB: SupabaseClient;
let adminId: string, dentistAId: string, dentistBId: string, professionalA: string, professionalB: string, patientId: string, budgetId: string, inactive: Identity, orphan: Identity;

function required(name: string) { const value = process.env[name]; if (!value) throw new Error(`${name} não configurada em .env.test.local.`); return value; }
function freshClient() { return createClient(url, anon, { auth: { autoRefreshToken: false, persistSession: false } }); }
async function login(identity: Pick<Identity, "email" | "password">) { const client = freshClient(); expect((await client.auth.signInWithPassword(identity)).error).toBeNull(); return client; }
async function createIdentity(role: Role) { const suffix = randomUUID(); const email = `QA_ORC_${role}_${suffix}@example.com`; const password = `Tmp-${randomUUID()}-A9!`; const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { nome: `QA_ORC_${role}_${suffix}`, perfil: role, created_by: adminId } }); if (error || !data.user) throw error ?? new Error("Usuário QA_ORC não criado."); const identity = { id: data.user.id, email, password, role }; users.push(identity); return identity; }

describe("orçamentos: RLS, RPCs e auditoria", () => {
  beforeAll(async () => {
    if (process.env.SUPABASE_TEST_HOMOLOGATION !== ACK) throw new Error("Homologação fictícia não confirmada.");
    url = required("SUPABASE_TEST_URL"); anon = required("SUPABASE_TEST_ANON_KEY"); service = createClient(url, required("SUPABASE_TEST_SERVICE_ROLE_KEY"), { auth: { autoRefreshToken: false, persistSession: false } });
    const qaAdmin = await createQaAdmin(service, url, anon); admin = qaAdmin.session; adminId = qaAdmin.identity.id; users.push(qaAdmin.identity);
    const receptionIdentity = await createIdentity("recepcao"); const dentistAIdentity = await createIdentity("dentista"); const dentistBIdentity = await createIdentity("dentista"); inactive = await createIdentity("recepcao"); orphan = await createIdentity("recepcao"); dentistAId = dentistAIdentity.id; dentistBId = dentistBIdentity.id;
    reception = await login(receptionIdentity); dentistA = await login(dentistAIdentity); dentistB = await login(dentistBIdentity);
    expect((await admin.rpc("update_user_access", { p_usuario_id: inactive.id, p_perfil: null, p_status: "inativo" })).error).toBeNull();
    expect((await service.from("usuarios").delete().eq("id", orphan.id)).error).toBeNull();
    const { data: professionals } = await service.from("profissionais").select("id,usuario_id").in("usuario_id", [dentistAId, dentistBId]);
    professionalA = professionals?.find((item) => item.usuario_id === dentistAId)?.id ?? ""; professionalB = professionals?.find((item) => item.usuario_id === dentistBId)?.id ?? "";
    if (!professionalA || !professionalB) throw new Error("Profissionais QA_ORC ausentes.");
    const patient = await reception.rpc("create_patient", { p_nome: `QA_ORC_Paciente_${randomUUID()}`, p_data_nascimento: null, p_telefone_contato: null, p_documento_identificacao: null, p_alergias: null, p_intolerancias: null, p_medicamentos_em_uso: null });
    if (patient.error || !patient.data) throw patient.error ?? new Error("Paciente QA_ORC ausente."); patientId = (patient.data as { id: string }).id; patientIds.push(patientId);
  });

  afterAll(async () => {
    if (!service) return;
    if (budgetIds.length) { await service.from("auditoria").delete().in("entidade_id", budgetIds); const { data: items } = await service.from("orcamento_itens").select("id").in("orcamento_id", budgetIds); if (items?.length) await service.from("auditoria").delete().in("entidade_id", items.map((item) => item.id)); await service.from("orcamento_itens").delete().in("orcamento_id", budgetIds); await service.from("orcamentos").delete().in("id", budgetIds); }
    if (patientIds.length) { await service.from("auditoria").delete().in("entidade_id", patientIds); await service.from("paciente_alertas_clinicos").delete().in("paciente_id", patientIds); await service.from("pacientes").delete().in("id", patientIds); }
    if (users.length) await service.from("auditoria").delete().in("usuario_id", users.map((user) => user.id));
    for (const user of users.reverse()) { await service.from("profissionais").delete().eq("usuario_id", user.id); await service.from("usuarios").delete().eq("id", user.id); await service.auth.admin.deleteUser(user.id); }
  });

  it("permite criar rascunho, itens e envio somente pelas RPCs", async () => {
    const created = await reception.rpc("create_budget", { p_paciente_id: patientId, p_profissional_id: professionalA, p_validade_em: null, p_observacao_administrativa: "QA_ORC_observação" });
    expect(created.error).toBeNull(); budgetId = (created.data as { id: string }).id; budgetIds.push(budgetId);
    expect((await reception.rpc("add_budget_item", { p_orcamento_id: budgetId, p_descricao: "QA_ORC_Item", p_quantidade: 2, p_valor_unitario_centavos: 12345 })).error).toBeNull();
    expect((await reception.from("orcamentos").update({ status: "aprovado" }).eq("id", budgetId)).error).not.toBeNull();
    expect((await reception.from("orcamento_itens").delete().eq("orcamento_id", budgetId)).error).not.toBeNull();
    expect((await reception.rpc("set_budget_status", { p_orcamento_id: budgetId, p_status: "enviado" })).error).not.toBeNull();
    expect((await reception.rpc("update_budget", { p_orcamento_id: budgetId, p_paciente_id: patientId, p_profissional_id: professionalA, p_validade_em: new Date(Date.now() + 86400000).toISOString().slice(0, 10), p_observacao_administrativa: "QA_ORC_atualizado" })).error).toBeNull();
    expect((await reception.rpc("set_budget_status", { p_orcamento_id: budgetId, p_status: "enviado" })).error).toBeNull();
  });

  it("isola dentista por profissional e respeita aprovação/conversão", async () => {
    expect((await dentistA.from("orcamentos").select("id").eq("id", budgetId)).data).toHaveLength(1);
    expect((await dentistB.from("orcamentos").select("id").eq("id", budgetId)).data).toEqual([]);
    expect((await dentistB.rpc("set_budget_status", { p_orcamento_id: budgetId, p_status: "aprovado" })).error).not.toBeNull();
    expect((await dentistA.rpc("set_budget_status", { p_orcamento_id: budgetId, p_status: "aprovado" })).error).toBeNull();
    expect((await reception.rpc("update_budget", { p_orcamento_id: budgetId, p_paciente_id: patientId, p_profissional_id: professionalA, p_validade_em: null, p_observacao_administrativa: null })).error).not.toBeNull();
    expect((await dentistA.rpc("set_budget_status", { p_orcamento_id: budgetId, p_status: "convertido" })).error).toBeNull();
  });

  it("recusa aprovação de orçamento enviado já expirado", async () => {
    const created = await admin.rpc("create_budget", { p_paciente_id: patientId, p_profissional_id: professionalA, p_validade_em: new Date(Date.now() + 86400000).toISOString().slice(0, 10), p_observacao_administrativa: null });
    expect(created.error).toBeNull(); const expiredBudgetId = (created.data as { id: string }).id; budgetIds.push(expiredBudgetId);
    expect((await admin.rpc("add_budget_item", { p_orcamento_id: expiredBudgetId, p_descricao: "QA_ORC_Item_expirado", p_quantidade: 1, p_valor_unitario_centavos: 100 })).error).toBeNull();
    expect((await admin.rpc("set_budget_status", { p_orcamento_id: expiredBudgetId, p_status: "enviado" })).error).toBeNull();
    const pastDate = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    expect((await service.from("orcamentos").update({ data_orcamento: pastDate, validade_em: pastDate }).eq("id", expiredBudgetId)).error).toBeNull();
    expect((await dentistA.rpc("set_budget_status", { p_orcamento_id: expiredBudgetId, p_status: "aprovado" })).error).not.toBeNull();
    // A tentativa e atomica: a RPC nega a aprovacao e preserva o status
    // gravado. A listagem server-side calcula `expirado` para esse caso.
    expect((await service.from("orcamentos").select("status").eq("id", expiredBudgetId).single()).data?.status).toBe("enviado");
  });

  it("nega usuário inativo/sem perfil e audita somente metadados", async () => {
    for (const identity of [inactive, orphan]) { const blocked = await login(identity); expect((await blocked.from("orcamentos").select("id")).data).toEqual([]); expect((await blocked.rpc("create_budget", { p_paciente_id: patientId, p_profissional_id: professionalA, p_validade_em: null, p_observacao_administrativa: null })).error).not.toBeNull(); }
    expect((await dentistA.rpc("register_budget_pdf_generation", { p_orcamento_id: budgetId })).error).toBeNull();
    const { data: audit } = await admin.from("auditoria").select("evento,dados").eq("entidade_id", budgetId); expect(audit?.some((item) => item.evento === "orcamento_pdf_gerado")).toBe(true); expect(JSON.stringify(audit)).not.toContain("QA_ORC_observação");
  });
});
