import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createQaAdmin } from "./helpers";

const ACK = "I_ACKNOWLEDGE_FAKE_DATA_ONLY";
type Role = "administrador" | "recepcao" | "dentista";
type Identity = { id: string; email: string; password: string; role: Role };
const users: Identity[] = [];
const paymentIds: string[] = [];
const budgetIds: string[] = [];
const attendanceIds: string[] = [];
const patientIds: string[] = [];
let url: string, anon: string, service: SupabaseClient, admin: SupabaseClient, reception: SupabaseClient, dentistA: SupabaseClient, dentistB: SupabaseClient;
let adminId: string, dentistAId: string, dentistBId: string, professionalA: string, professionalB: string, patientA: string, patientB: string, attendanceA: string, approvedBudgetId: string, inactive: Identity, orphan: Identity;

function required(name: string) { const value = process.env[name]; if (!value) throw new Error(`${name} não configurada em .env.test.local.`); return value; }
function freshClient() { return createClient(url, anon, { auth: { autoRefreshToken: false, persistSession: false } }); }
async function login(identity: Pick<Identity, "email" | "password">) { const client = freshClient(); expect((await client.auth.signInWithPassword(identity)).error).toBeNull(); return client; }
async function createIdentity(role: Role) {
  const suffix = randomUUID();
  const candidate = { email: `qa_fin_${role}_${suffix}@example.com`, password: `Tmp-${randomUUID()}-A9!`, role };
  const { data, error } = await service.auth.admin.createUser({ email: candidate.email, password: candidate.password, email_confirm: true, user_metadata: { nome: `QA_FIN_${role}_${suffix}`, perfil: role, created_by: adminId } });
  if (error || !data.user) throw error ?? new Error("Usuário QA_FIN ausente.");
  const identity = { ...candidate, id: data.user.id };
  users.push(identity);
  return identity;
}
async function createPatient(name: string) {
  const result = await reception.rpc("create_patient", { p_nome: name, p_data_nascimento: null, p_telefone_contato: null, p_documento_identificacao: null, p_alergias: null, p_intolerancias: null, p_medicamentos_em_uso: null });
  if (result.error || !result.data) throw result.error ?? new Error("Paciente QA_FIN ausente.");
  const id = (result.data as { id: string }).id;
  patientIds.push(id);
  return id;
}
async function createPayment(client: SupabaseClient, values: { patientId?: string; attendanceId?: string | null; budgetId?: string | null; cents?: number; observation?: string | null } = {}) {
  const result = await client.rpc("create_payment", {
    p_paciente_id: values.patientId ?? patientA,
    p_atendimento_id: values.attendanceId ?? null,
    p_orcamento_id: values.budgetId ?? null,
    p_valor_centavos: values.cents ?? 12345,
    p_forma: "pix",
    p_data_pagamento: new Date().toISOString().slice(0, 10),
    p_observacao_administrativa: values.observation ?? null,
  });
  if (!result.error && result.data) paymentIds.push((result.data as { id: string }).id);
  return result;
}

describe("financeiro: pagamentos, RLS, RPCs e auditoria", () => {
  beforeAll(async () => {
    if (process.env.SUPABASE_TEST_HOMOLOGATION !== ACK) throw new Error("Homologação fictícia não confirmada.");
    url = required("SUPABASE_TEST_URL");
    anon = required("SUPABASE_TEST_ANON_KEY");
    service = createClient(url, required("SUPABASE_TEST_SERVICE_ROLE_KEY"), { auth: { autoRefreshToken: false, persistSession: false } });
    const qaAdmin = await createQaAdmin(service, url, anon);
    admin = qaAdmin.session;
    adminId = qaAdmin.identity.id;
    users.push(qaAdmin.identity);
    const receptionIdentity = await createIdentity("recepcao");
    const dentistAIdentity = await createIdentity("dentista");
    const dentistBIdentity = await createIdentity("dentista");
    inactive = await createIdentity("recepcao");
    orphan = await createIdentity("recepcao");
    dentistAId = dentistAIdentity.id;
    dentistBId = dentistBIdentity.id;
    reception = await login(receptionIdentity);
    dentistA = await login(dentistAIdentity);
    dentistB = await login(dentistBIdentity);
    expect((await admin.rpc("update_user_access", { p_usuario_id: inactive.id, p_perfil: null, p_status: "inativo" })).error).toBeNull();
    expect((await service.from("usuarios").delete().eq("id", orphan.id)).error).toBeNull();
    const { data: professionals } = await service.from("profissionais").select("id,usuario_id").in("usuario_id", [dentistAId, dentistBId]);
    professionalA = professionals?.find((item) => item.usuario_id === dentistAId)?.id ?? "";
    professionalB = professionals?.find((item) => item.usuario_id === dentistBId)?.id ?? "";
    if (!professionalA || !professionalB) throw new Error("Profissionais QA_FIN ausentes.");
    patientA = await createPatient(`QA_FIN_Paciente_A_${randomUUID()}`);
    patientB = await createPatient(`QA_FIN_Paciente_B_${randomUUID()}`);
    const attendance = await dentistA.rpc("create_direct_attendance", { p_paciente_id: patientA });
    if (attendance.error || !attendance.data) throw attendance.error ?? new Error("Atendimento QA_FIN ausente.");
    attendanceA = (attendance.data as { id: string }).id;
    attendanceIds.push(attendanceA);
    const budget = await reception.rpc("create_budget", { p_paciente_id: patientA, p_profissional_id: professionalA, p_validade_em: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10), p_observacao_administrativa: "QA_FIN_orçamento" });
    if (budget.error || !budget.data) throw budget.error ?? new Error("Orçamento QA_FIN ausente.");
    approvedBudgetId = (budget.data as { id: string }).id;
    budgetIds.push(approvedBudgetId);
    expect((await reception.rpc("add_budget_item", { p_orcamento_id: approvedBudgetId, p_descricao: "QA_FIN_Item", p_quantidade: 1, p_valor_unitario_centavos: 34567 })).error).toBeNull();
    expect((await reception.rpc("set_budget_status", { p_orcamento_id: approvedBudgetId, p_status: "enviado" })).error).toBeNull();
    expect((await reception.rpc("set_budget_status", { p_orcamento_id: approvedBudgetId, p_status: "aprovado" })).error).toBeNull();
  });

  afterAll(async () => {
    if (!service) return;
    if (paymentIds.length) { await service.from("auditoria").delete().in("entidade_id", paymentIds); await service.from("pagamentos").delete().in("id", paymentIds); }
    if (budgetIds.length) { const { data: items } = await service.from("orcamento_itens").select("id").in("orcamento_id", budgetIds); if (items?.length) await service.from("auditoria").delete().in("entidade_id", items.map((item) => item.id)); await service.from("auditoria").delete().in("entidade_id", budgetIds); await service.from("orcamento_itens").delete().in("orcamento_id", budgetIds); await service.from("orcamentos").delete().in("id", budgetIds); }
    if (attendanceIds.length) { await service.from("auditoria").delete().in("entidade_id", attendanceIds); await service.from("atendimentos").delete().in("id", attendanceIds); }
    if (patientIds.length) { await service.from("auditoria").delete().in("entidade_id", patientIds); await service.from("paciente_alertas_clinicos").delete().in("paciente_id", patientIds); await service.from("pacientes").delete().in("id", patientIds); }
    if (users.length) await service.from("auditoria").delete().in("usuario_id", users.map((user) => user.id));
    for (const user of users.reverse()) { await service.from("profissionais").delete().eq("usuario_id", user.id); await service.from("usuarios").delete().eq("id", user.id); await service.auth.admin.deleteUser(user.id); }
  });

  it("registra pagamentos apenas por RPC e mantém valores em centavos", async () => {
    const patientOnly = await createPayment(reception, { cents: 12345, observation: "QA_FIN_observação_sensível" });
    expect(patientOnly.error).toBeNull();
    const attendancePayment = await createPayment(admin, { attendanceId: attendanceA, cents: 22222 });
    expect(attendancePayment.error).toBeNull();
    const budgetPayment = await createPayment(reception, { budgetId: approvedBudgetId, cents: 34567 });
    expect(budgetPayment.error).toBeNull();
    const period = new Date().toISOString().slice(0, 10);
    const summary = await admin.rpc("get_payment_summary", { p_data_inicio: period, p_data_fim: period });
    expect(summary.error).toBeNull();
    expect((summary.data as Array<{ recebido_hoje_centavos: number; recebido_periodo_centavos: number; quantidade_pagamentos: number }>)[0]).toMatchObject({ recebido_hoje_centavos: 69134, recebido_periodo_centavos: 69134, quantidade_pagamentos: 3 });
    const paymentId = (patientOnly.data as { id: string }).id;
    const { data } = await service.from("pagamentos").select("valor_centavos,status").eq("id", paymentId).single();
    expect(data).toMatchObject({ valor_centavos: 12345, status: "pago" });
    expect((await reception.from("pagamentos").insert({ paciente_id: patientA })).error).not.toBeNull();
    expect((await reception.from("pagamentos").update({ valor_centavos: 1 }).eq("id", paymentId)).error).not.toBeNull();
    expect((await reception.from("pagamentos").delete().eq("id", paymentId)).error).not.toBeNull();
  });

  it("bloqueia referências inválidas, simultâneas e pagamento duplicado", async () => {
    expect((await createPayment(reception, { patientId: patientB, attendanceId: attendanceA })).error).not.toBeNull();
    const both = await reception.rpc("create_payment", { p_paciente_id: patientA, p_atendimento_id: attendanceA, p_orcamento_id: approvedBudgetId, p_valor_centavos: 100, p_forma: "pix", p_data_pagamento: new Date().toISOString().slice(0, 10), p_observacao_administrativa: null });
    expect(both.error).not.toBeNull();
    expect((await createPayment(reception, { cents: -1 })).error).not.toBeNull();
    expect((await createPayment(admin, { budgetId: approvedBudgetId, cents: 1 })).error).not.toBeNull();
  });

  it("isola leitura por profissional e bloqueia IDOR e resumo para recepção", async () => {
    const attendancePayment = paymentIds[1];
    expect((await dentistA.from("pagamentos").select("id").eq("id", attendancePayment)).data).toHaveLength(1);
    expect((await dentistB.from("pagamentos").select("id").eq("id", attendancePayment)).data).toEqual([]);
    const listA = await dentistA.rpc("list_payments", { p_page: 1, p_page_size: 20 });
    expect(listA.error).toBeNull();
    expect((listA.data as Array<{ id: string }>).some((item) => item.id === attendancePayment)).toBe(true);
    const listB = await dentistB.rpc("list_payments", { p_page: 1, p_page_size: 20 });
    expect(listB.error).toBeNull();
    expect((listB.data as Array<{ id: string }>).some((item) => item.id === attendancePayment)).toBe(false);
    expect((await reception.rpc("get_payment_summary", { p_data_inicio: new Date().toISOString().slice(0, 10), p_data_fim: new Date().toISOString().slice(0, 10) })).error).not.toBeNull();
    expect((await dentistA.rpc("get_payment_summary", { p_data_inicio: new Date().toISOString().slice(0, 10), p_data_fim: new Date().toISOString().slice(0, 10) })).error).not.toBeNull();
  });

  it("permite apenas administrador cancelar ou estornar, com auditoria sem observação", async () => {
    const paymentId = paymentIds[0];
    expect((await reception.rpc("set_payment_status", { p_pagamento_id: paymentId, p_status: "cancelado" })).error).not.toBeNull();
    expect((await admin.rpc("set_payment_status", { p_pagamento_id: paymentId, p_status: "cancelado" })).error).toBeNull();
    expect((await admin.rpc("set_payment_status", { p_pagamento_id: paymentId, p_status: "estornado" })).error).not.toBeNull();
    expect((await reception.rpc("update_payment", { p_pagamento_id: paymentId })).error).not.toBeNull();
    const { data: audit } = await admin.from("auditoria").select("evento,dados").eq("entidade_id", paymentId);
    expect(audit?.some((item) => item.evento === "pagamento_criado")).toBe(true);
    expect(audit?.some((item) => item.evento === "pagamento_cancelado")).toBe(true);
    expect(JSON.stringify(audit)).not.toContain("QA_FIN_observação_sensível");
  });

  it("nega usuário inativo ou sem perfil", async () => {
    for (const identity of [inactive, orphan]) {
      const blocked = await login(identity);
      expect((await blocked.from("pagamentos").select("id")).data).toEqual([]);
      expect((await createPayment(blocked)).error).not.toBeNull();
      expect((await blocked.rpc("list_payments", { p_page: 1, p_page_size: 20 })).error).not.toBeNull();
    }
  });

  it("retorna resumo zerado para administrador quando não há pagamentos no período", async () => {
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const summary = await admin.rpc("get_payment_summary", { p_data_inicio: tomorrow, p_data_fim: tomorrow });
    expect(summary.error).toBeNull();
    expect((summary.data as Array<{ recebido_hoje_centavos: number; recebido_periodo_centavos: number; quantidade_pagamentos: number }>)[0]).toMatchObject({ recebido_periodo_centavos: 0, quantidade_pagamentos: 0 });
  });
});
