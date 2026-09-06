import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createQaAdmin } from "./helpers";

const ACK = "I_ACKNOWLEDGE_FAKE_DATA_ONLY";
type Role = "administrador" | "recepcao" | "dentista";
type Identity = { id: string; email: string; password: string; role: Role };
const users: Identity[] = [];
const patientIds: string[] = [];
const attendanceIds: string[] = [];
const receivableIds: string[] = [];
const installmentIds: string[] = [];
const paymentIds: string[] = [];
let url: string, anon: string, service: SupabaseClient, admin: SupabaseClient, reception: SupabaseClient, dentist: SupabaseClient;
let adminId: string, dentistId: string, patientA: string, patientB: string, attendanceA: string;
let inactive: Identity, orphan: Identity;

function required(name: string) { const value = process.env[name]; if (!value) throw new Error(`${name} não configurada.`); return value; }
function client() { return createClient(url, anon, { auth: { autoRefreshToken: false, persistSession: false } }); }
async function login(identity: Pick<Identity, "email" | "password">) { const result = client(); expect((await result.auth.signInWithPassword(identity)).error).toBeNull(); return result; }
async function createIdentity(role: Role) { const suffix = randomUUID(); const candidate = { email: `qa_fin20_${role}_${suffix}@example.com`, password: `Tmp-${randomUUID()}-A9!`, role }; const { data, error } = await service.auth.admin.createUser({ email: candidate.email, password: candidate.password, email_confirm: true, user_metadata: { nome: `QA_FIN20_${role}_${suffix}`, perfil: role, created_by: adminId } }); if (error || !data.user) throw error ?? new Error("Usuário QA_FIN20 ausente."); const identity = { ...candidate, id: data.user.id }; users.push(identity); return identity; }
async function createPatient(name: string) { const { data, error } = await reception.rpc("create_patient", { p_nome: name, p_data_nascimento: null, p_telefone_contato: null, p_documento_identificacao: null, p_alergias: null, p_intolerancias: null, p_medicamentos_em_uso: null }); if (error || !data) throw error ?? new Error("Paciente QA_FIN20 ausente."); const id = (data as { id: string }).id; patientIds.push(id); return id; }
async function createReceivable(clientForRole: SupabaseClient, values: { patientId?: string; attendanceId?: string | null; cents?: number; installments?: number } = {}) {
  const result = await clientForRole.rpc("create_financial_receivable", { p_paciente_id: values.patientId ?? patientA, p_atendimento_id: values.attendanceId ?? null, p_orcamento_id: null, p_valor_total_centavos: values.cents ?? 10_000, p_primeiro_vencimento: "2026-09-05", p_numero_parcelas: values.installments ?? 3, p_intervalo_meses: 1, p_observacao_administrativa: "QA_FIN20_observacao" });
  if (!result.error && result.data) receivableIds.push((result.data as { id: string }).id);
  return result;
}

describe("financeiro v2: recebíveis, parcelas e RLS", () => {
  beforeAll(async () => {
    if (process.env.SUPABASE_TEST_HOMOLOGATION !== ACK) throw new Error("Homologação fictícia não confirmada.");
    url = required("SUPABASE_TEST_URL"); anon = required("SUPABASE_TEST_ANON_KEY"); service = createClient(url, required("SUPABASE_TEST_SERVICE_ROLE_KEY"), { auth: { autoRefreshToken: false, persistSession: false } });
    const qaAdmin = await createQaAdmin(service, url, anon); admin = qaAdmin.session; adminId = qaAdmin.identity.id; users.push(qaAdmin.identity);
    const receptionIdentity = await createIdentity("recepcao"); const dentistIdentity = await createIdentity("dentista"); inactive = await createIdentity("recepcao"); orphan = await createIdentity("recepcao");
    reception = await login(receptionIdentity); dentist = await login(dentistIdentity); dentistId = dentistIdentity.id;
    expect((await admin.rpc("update_user_access", { p_usuario_id: inactive.id, p_perfil: null, p_status: "inativo" })).error).toBeNull();
    expect((await service.from("usuarios").delete().eq("id", orphan.id)).error).toBeNull();
    patientA = await createPatient(`QA_FIN20_Paciente_A_${randomUUID()}`); patientB = await createPatient(`QA_FIN20_Paciente_B_${randomUUID()}`);
    const attendance = await dentist.rpc("create_direct_attendance", { p_paciente_id: patientA }); if (attendance.error || !attendance.data) throw attendance.error ?? new Error("Atendimento QA_FIN20 ausente."); attendanceA = (attendance.data as { id: string }).id; attendanceIds.push(attendanceA);
  });

  afterAll(async () => {
    if (!service) return;
    const entityIds = [...paymentIds, ...installmentIds, ...receivableIds, ...attendanceIds, ...patientIds];
    if (entityIds.length) await service.from("auditoria").delete().in("entidade_id", entityIds);
    if (paymentIds.length) await service.from("pagamentos").delete().in("id", paymentIds);
    if (receivableIds.length) await service.from("financeiro_recebiveis").delete().in("id", receivableIds);
    if (attendanceIds.length) await service.from("atendimentos").delete().in("id", attendanceIds);
    if (patientIds.length) { await service.from("paciente_alertas_clinicos").delete().in("paciente_id", patientIds); await service.from("pacientes").delete().in("id", patientIds); }
    if (users.length) await service.from("auditoria").delete().in("usuario_id", users.map((item) => item.id));
    for (const user of users.reverse()) { await service.from("profissionais").delete().eq("usuario_id", user.id); await service.from("usuarios").delete().eq("id", user.id); await service.auth.admin.deleteUser(user.id); }
  });

  it("cria parcelamento com centavos exatos, vínculos válidos e DML direto negado", async () => {
    const created = await createReceivable(reception); expect(created.error).toBeNull(); const id = (created.data as { id: string }).id;
    const { data: installments, error } = await admin.rpc("list_financial_installments", { p_recebivel_id: id }); expect(error).toBeNull(); const rows = installments as Array<{ id: string; valor_centavos: number; vencimento: string }>;
    installmentIds.push(...rows.map((row) => row.id)); expect(rows.map((row) => row.valor_centavos)).toEqual([3334, 3333, 3333]); expect(rows.reduce((sum, row) => sum + row.valor_centavos, 0)).toBe(10_000); expect(rows.map((row) => row.vencimento)).toEqual(["2026-09-05", "2026-10-05", "2026-11-05"]);
    const other = await createReceivable(admin, { patientId: patientB, cents: 2_500, installments: 1 }); expect(other.error).toBeNull();
    const otherId = (other.data as { id: string }).id;
    const otherRows = (await admin.rpc("list_financial_installments", { p_recebivel_id: otherId })).data as Array<{ id: string; valor_centavos: number }>;
    expect(otherRows).toHaveLength(1); expect(otherRows[0].valor_centavos).toBe(2_500);
    expect(rows.some((row) => row.id === otherRows[0].id)).toBe(false);
    expect((await reception.from("financeiro_recebiveis").insert({ paciente_id: patientA })).error).not.toBeNull();
    expect((await reception.from("financeiro_parcelas").update({ valor_centavos: 1 }).eq("id", rows[0].id)).error).not.toBeNull();
    expect((await reception.from("financeiro_parcelas").delete().eq("id", rows[0].id)).error).not.toBeNull();
    expect((await createReceivable(admin, { patientId: patientB, attendanceId: attendanceA })).error).not.toBeNull();
  });

  it("quita somente uma vez, atualiza status e estorno restaura parcela", async () => {
    const id = receivableIds[0]; const rows = (await admin.rpc("list_financial_installments", { p_recebivel_id: id })).data as Array<{ id: string }>;
    const first = rows[0]; const second = rows[1];
    const firstPayment = await reception.rpc("register_installment_payment", { p_parcela_id: first.id, p_forma: "pix", p_data_pagamento: "2026-09-05", p_observacao_administrativa: null }); expect(firstPayment.error).toBeNull(); paymentIds.push((firstPayment.data as { id: string }).id);
    const concurrent = await Promise.all([reception.rpc("register_installment_payment", { p_parcela_id: second.id, p_forma: "dinheiro", p_data_pagamento: "2026-10-05", p_observacao_administrativa: null }), admin.rpc("register_installment_payment", { p_parcela_id: second.id, p_forma: "dinheiro", p_data_pagamento: "2026-10-05", p_observacao_administrativa: null })]);
    expect(concurrent.filter((item) => !item.error)).toHaveLength(1); const successful = concurrent.find((item) => !item.error); if (successful?.data) paymentIds.push((successful.data as { id: string }).id);
    const { data: receipt } = await service.from("financeiro_recebiveis").select("status").eq("id", id).single(); expect(receipt?.status).toBe("parcialmente_pago");
    expect((await admin.rpc("set_payment_status", { p_pagamento_id: paymentIds[0], p_status: "estornado" })).error).toBeNull();
    const { data: restored } = await service.from("financeiro_parcelas").select("status").eq("id", first.id).single(); expect(restored?.status).toBe("pendente");
  });

  it("aplica RBAC, cancelamento seguro e auditoria mínima", async () => {
    const receiptId = receivableIds[0];
    expect((await admin.rpc("list_financial_installments", { p_recebivel_id: receiptId })).error).toBeNull();
    expect((await reception.rpc("list_financial_installments", { p_recebivel_id: receiptId })).error).toBeNull();
    expect((await dentist.rpc("list_financial_installments", { p_recebivel_id: receiptId })).error).not.toBeNull();
    expect((await createReceivable(dentist)).error).not.toBeNull();
    for (const identity of [inactive, orphan]) { const blocked = await login(identity); expect((await createReceivable(blocked)).error).not.toBeNull(); expect((await blocked.rpc("list_financial_receivables", { p_page: 1, p_page_size: 20 })).error).not.toBeNull(); expect((await blocked.rpc("list_financial_installments", { p_recebivel_id: receiptId })).error).not.toBeNull(); }
    const cancellable = await createReceivable(admin, { cents: 5000, installments: 1 }); expect(cancellable.error).toBeNull(); const cancellableId = (cancellable.data as { id: string }).id;
    expect((await reception.rpc("cancel_financial_receivable", { p_recebivel_id: cancellableId })).error).not.toBeNull(); expect((await admin.rpc("cancel_financial_receivable", { p_recebivel_id: cancellableId })).error).toBeNull();
    const { data: audit } = await admin.from("auditoria").select("evento,dados").eq("entidade_id", cancellableId); expect(audit?.some((item) => item.evento === "recebivel_cancelado")).toBe(true); expect(JSON.stringify(audit)).not.toContain("QA_FIN20_observacao");
    expect(dentistId).toBeTruthy();
  });

  it("preserva integridade na exclusao administrativa", async () => {
    const unpaid = await createReceivable(admin, { cents: 3_000, installments: 2 });
    expect(unpaid.error).toBeNull();
    const unpaidId = (unpaid.data as { id: string }).id;
    expect((await service.from("financeiro_recebiveis").delete().eq("id", unpaidId)).error).toBeNull();
    expect((await service.from("financeiro_parcelas").select("id").eq("recebivel_id", unpaidId)).data).toEqual([]);
    receivableIds.splice(receivableIds.indexOf(unpaidId), 1);

    const paid = await createReceivable(admin, { cents: 4_000, installments: 1 });
    expect(paid.error).toBeNull();
    const paidId = (paid.data as { id: string }).id;
    const installments = (await admin.rpc("list_financial_installments", { p_recebivel_id: paidId })).data as Array<{ id: string }>;
    const payment = await admin.rpc("register_installment_payment", { p_parcela_id: installments[0].id, p_forma: "pix", p_data_pagamento: "2026-09-05", p_observacao_administrativa: null });
    expect(payment.error).toBeNull();
    paymentIds.push((payment.data as { id: string }).id);
    expect((await service.from("financeiro_recebiveis").delete().eq("id", paidId)).error).not.toBeNull();
  });
});
