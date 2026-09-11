import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createQaAdmin } from "./helpers";

const ACK = "I_ACKNOWLEDGE_FAKE_DATA_ONLY";
const PREFIX = "QA_TRAT_";
type Role = "administrador" | "dentista" | "recepcao";
type Identity = { id: string; email: string; password: string; role: Role };

let service: SupabaseClient, admin: SupabaseClient, reception: SupabaseClient, dentistA: SupabaseClient, dentistB: SupabaseClient;
let inactive: Identity, orphan: Identity, patientId: string, professionalA: string, professionalB: string;
let url: string, anon: string, adminId: string;
const users: Identity[] = [], patientIds: string[] = [], budgetIds: string[] = [], planIds: string[] = [], itemIds: string[] = [], attendanceIds: string[] = [], procedureIds: string[] = [];

function required(name: string) { const value = process.env[name]; if (!value) throw new Error(`${name} nao configurada em .env.test.local.`); return value; }
function freshClient() { return createClient(url, anon, { auth: { autoRefreshToken: false, persistSession: false } }); }
async function login(identity: Pick<Identity, "email" | "password">) { const client = freshClient(); expect((await client.auth.signInWithPassword(identity)).error).toBeNull(); return client; }
async function createIdentity(role: Role) {
  const suffix = randomUUID();
  const identity = { email: `qa_trat_${role}_${suffix}@example.com`, password: `Tmp-${randomUUID()}-A9!`, role };
  const { data, error } = await service.auth.admin.createUser({ email: identity.email, password: identity.password, email_confirm: true, user_metadata: { nome: `${PREFIX}${role}_${suffix}`, perfil: role, created_by: adminId } });
  if (error || !data.user) throw error ?? new Error("Usuario QA_TRAT nao criado.");
  const result = { ...identity, id: data.user.id }; users.push(result); return result;
}
async function createApprovedBudget(itemCount = 3, itemQuantity = 1) {
  const { data, error } = await admin.rpc("create_budget", { p_paciente_id: patientId, p_profissional_id: professionalA, p_validade_em: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10), p_observacao_administrativa: `${PREFIX}Observacao sensivel` });
  if (error || !data) throw error ?? new Error("Orcamento QA_TRAT nao criado.");
  const id = (data as { id: string }).id; budgetIds.push(id);
  for (let index = 1; index <= itemCount; index++) {
    expect((await admin.rpc("add_budget_item", { p_orcamento_id: id, p_descricao: `${PREFIX}Item ${index}`, p_quantidade: itemQuantity, p_valor_unitario_centavos: 1_000 * index })).error).toBeNull();
  }
  expect((await admin.rpc("set_budget_status", { p_orcamento_id: id, p_status: "enviado" })).error).toBeNull();
  expect((await admin.rpc("set_budget_status", { p_orcamento_id: id, p_status: "aprovado" })).error).toBeNull();
  return id;
}
async function convert(client: SupabaseClient, budgetId: string) { return client.rpc("convert_budget_to_treatment_plan", { p_orcamento_id: budgetId }); }
async function directAttendance(forPatientId = patientId) {
  const { data, error } = await dentistA.rpc("create_direct_attendance", { p_paciente_id: forPatientId });
  if (error || !data) throw error ?? new Error("Atendimento QA_TRAT nao criado.");
  const id = (data as { id: string }).id; attendanceIds.push(id); return id;
}
async function manualProcedure(attendanceId: string) {
  const { data, error } = await dentistA.rpc("create_procedure", { p_atendimento_id: attendanceId, p_descricao: `${PREFIX}Procedimento`, p_dente: null, p_material_utilizado: null, p_cor_resina: null, p_detalhes: `${PREFIX}Detalhe clinico` });
  if (error || !data) throw error ?? new Error("Procedimento QA_TRAT nao criado.");
  const id = (data as { id: string }).id; procedureIds.push(id); return id;
}

async function createQaPatient() {
  const { data, error } = await admin.rpc("create_patient", { p_nome: `${PREFIX}Paciente_${randomUUID()}`, p_data_nascimento: null, p_telefone_contato: null, p_documento_identificacao: null, p_alergias: null, p_intolerancias: null, p_medicamentos_em_uso: null });
  if (error || !data) throw error ?? new Error("Paciente QA_TRAT ausente.");
  const id = (data as { id: string }).id; patientIds.push(id); return id;
}

describe("Sprint 21: orcamento para tratamento", () => {
  beforeAll(async () => {
    if (process.env.SUPABASE_TEST_HOMOLOGATION !== ACK) throw new Error("Homologacao ficticia nao confirmada.");
    url = required("SUPABASE_TEST_URL"); anon = required("SUPABASE_TEST_ANON_KEY"); service = createClient(url, required("SUPABASE_TEST_SERVICE_ROLE_KEY"), { auth: { autoRefreshToken: false, persistSession: false } });
    const qaAdmin = await createQaAdmin(service, url, anon); admin = qaAdmin.session; adminId = qaAdmin.identity.id; users.push(qaAdmin.identity);
    const receptionIdentity = await createIdentity("recepcao"); const dentistAIdentity = await createIdentity("dentista"); const dentistBIdentity = await createIdentity("dentista"); inactive = await createIdentity("recepcao"); orphan = await createIdentity("recepcao");
    reception = await login(receptionIdentity); dentistA = await login(dentistAIdentity); dentistB = await login(dentistBIdentity);
    expect((await admin.rpc("update_user_access", { p_usuario_id: inactive.id, p_perfil: null, p_status: "inativo" })).error).toBeNull();
    expect((await service.from("usuarios").delete().eq("id", orphan.id)).error).toBeNull();
    const { data: professionals, error: professionalsError } = await service.from("profissionais").select("id,usuario_id").in("usuario_id", [dentistAIdentity.id, dentistBIdentity.id]);
    if (professionalsError) throw professionalsError;
    professionalA = professionals?.find((row) => row.usuario_id === dentistAIdentity.id)?.id ?? "";
    professionalB = professionals?.find((row) => row.usuario_id === dentistBIdentity.id)?.id ?? "";
    if (!professionalA || !professionalB) throw new Error("Profissionais QA_TRAT ausentes.");
    const { data: patient, error: patientError } = await admin.rpc("create_patient", { p_nome: `${PREFIX}Paciente_${randomUUID()}`, p_data_nascimento: null, p_telefone_contato: null, p_documento_identificacao: null, p_alergias: null, p_intolerancias: null, p_medicamentos_em_uso: null });
    if (patientError || !patient) throw patientError ?? new Error("Paciente QA_TRAT ausente.");
    patientId = (patient as { id: string }).id; patientIds.push(patientId);
  });

  afterAll(async () => {
    if (!service) return;
    const entityIds = [...budgetIds, ...planIds, ...itemIds, ...attendanceIds, ...procedureIds, ...patientIds];
    if (entityIds.length) await service.from("auditoria").delete().in("entidade_id", entityIds);
    if (users.length) await service.from("auditoria").delete().in("usuario_id", users.map((user) => user.id));
    if (procedureIds.length) await service.from("procedimento_dentes").delete().in("procedimento_id", procedureIds);
    if (procedureIds.length) await service.from("procedimento_materiais_consumo").delete().in("procedimento_id", procedureIds);
    if (procedureIds.length) await service.from("procedimentos").delete().in("id", procedureIds);
    if (attendanceIds.length) await service.from("atendimentos").delete().in("id", attendanceIds);
    if (itemIds.length) await service.from("plano_tratamento_itens").delete().in("id", itemIds);
    if (planIds.length) await service.from("planos_tratamento").delete().in("id", planIds);
    if (budgetIds.length) { const { data: budgetItems } = await service.from("orcamento_itens").select("id").in("orcamento_id", budgetIds); const ids = (budgetItems ?? []).map((item) => item.id); if (ids.length) await service.from("auditoria").delete().in("entidade_id", ids); await service.from("orcamento_itens").delete().in("orcamento_id", budgetIds); await service.from("orcamentos").delete().in("id", budgetIds); }
    if (patientIds.length) { await service.from("paciente_alertas_clinicos").delete().in("paciente_id", patientIds); await service.from("pacientes").delete().in("id", patientIds); }
    for (const user of [...users].reverse()) { await service.from("profissionais").delete().eq("usuario_id", user.id); await service.from("usuarios").delete().eq("id", user.id); await service.auth.admin.deleteUser(user.id); }
  });

  it("converte atomicamente, cria snapshots e nao cria procedimento ou recebivel", async () => {
    const budgetId = await createApprovedBudget(3);
    const beforeReceivables = await service.from("financeiro_recebiveis").select("id", { count: "exact", head: true }).eq("orcamento_id", budgetId);
    const beforePayments = await service.from("pagamentos").select("id", { count: "exact", head: true }).eq("orcamento_id", budgetId);
    const converted = await convert(admin, budgetId);
    expect(converted.error).toBeNull(); const planId = (converted.data as { id: string }).id; planIds.push(planId);
    const { data: items } = await service.from("plano_tratamento_itens").select("id,status,descricao_snapshot,quantidade_planejada").eq("plano_tratamento_id", planId).order("ordem");
    const ids = (items ?? []).map((item) => item.id); itemIds.push(...ids);
    expect(items).toHaveLength(3); expect(items?.every((item) => item.status === "planejado")).toBe(true);
    expect((await service.from("orcamentos").select("status").eq("id", budgetId).single()).data?.status).toBe("convertido");
    expect((await service.from("procedimentos").select("id").in("plano_tratamento_item_id", ids)).data).toEqual([]);
    const afterReceivables = await service.from("financeiro_recebiveis").select("id", { count: "exact", head: true }).eq("orcamento_id", budgetId);
    const afterPayments = await service.from("pagamentos").select("id", { count: "exact", head: true }).eq("orcamento_id", budgetId);
    expect(afterReceivables.count).toBe(beforeReceivables.count);
    expect(afterPayments.count).toBe(beforePayments.count);
    const audit = await admin.from("auditoria").select("evento,dados").in("entidade_id", [budgetId, planId]);
    expect(audit.data?.map((row) => row.evento)).toEqual(expect.arrayContaining(["orcamento_convertido_tratamento", "plano_tratamento_criado"]));
    expect(JSON.stringify(audit.data)).not.toContain(`${PREFIX}Observacao sensivel`);
    expect(JSON.stringify(audit.data)).not.toContain(`${PREFIX}Item`);
  });

  it("bloqueia dupla conversao, recepcao, outro dentista, inativo e sem perfil", async () => {
    const budgetId = budgetIds[0]!;
    expect((await convert(admin, budgetId)).error).not.toBeNull();
    expect((await convert(reception, budgetId)).error).not.toBeNull();
    expect((await convert(dentistB, budgetId)).error).not.toBeNull();
    for (const identity of [inactive, orphan]) { expect((await convert(await login(identity), budgetId)).error).not.toBeNull(); }
    expect((await service.from("planos_tratamento").select("id").eq("orcamento_id", budgetId)).data).toHaveLength(1);
  });

  it("serializa conversoes concorrentes sem plano ou item duplicado", async () => {
    const budgetId = await createApprovedBudget(2);
    const results = await Promise.all([convert(admin, budgetId), convert(dentistA, budgetId)]);
    const successful = results.filter((result) => result.error === null);
    expect(successful).toHaveLength(1);
    const planId = (successful[0]?.data as { id: string }).id; planIds.push(planId);
    expect((await service.from("planos_tratamento").select("id").eq("orcamento_id", budgetId)).data).toHaveLength(1);
    const { data: rowsItems } = await service.from("plano_tratamento_itens").select("id").eq("plano_tratamento_id", planId);
    expect(rowsItems).toHaveLength(2); itemIds.push(...(rowsItems ?? []).map((item) => item.id));
  });

  it("separa resumo administrativo de itens clinicos e bloqueia DML direto", async () => {
    const planId = planIds[0]!;
    expect((await reception.from("planos_tratamento").select("id,paciente_id,orcamento_id,status").eq("id", planId)).data).toHaveLength(1);
    expect((await reception.from("plano_tratamento_itens").select("id,descricao_snapshot").eq("plano_tratamento_id", planId)).data).toEqual([]);
    expect((await admin.from("plano_tratamento_itens").select("id,descricao_snapshot").eq("plano_tratamento_id", planId)).data).toEqual([]);
    expect((await dentistA.from("plano_tratamento_itens").select("id").eq("plano_tratamento_id", planId)).data).toHaveLength(3);
    expect((await dentistB.from("plano_tratamento_itens").select("id").eq("plano_tratamento_id", planId)).data).toEqual([]);
    expect((await reception.from("planos_tratamento").update({ status: "cancelado" }).eq("id", planId)).error).not.toBeNull();
    expect((await reception.from("plano_tratamento_itens").delete().eq("plano_tratamento_id", planId)).error).not.toBeNull();
    expect((await reception.from("planos_tratamento").insert({ paciente_id: patientId, orcamento_id: budgetIds[0], profissional_id: professionalA, created_by: adminId, updated_by: adminId })).error).not.toBeNull();
  });

  it("vincula somente procedimento proprio, atualiza estado e limita quantidade planejada", async () => {
    const planId = planIds[0]!;
    const firstItem = itemIds[0]!;
    const attendance = await directAttendance(); const procedure = await manualProcedure(attendance);
    expect((await admin.rpc("link_procedure_to_treatment_plan_item", { p_procedimento_id: procedure, p_plano_tratamento_item_id: firstItem })).error).not.toBeNull();
    expect((await reception.rpc("link_procedure_to_treatment_plan_item", { p_procedimento_id: procedure, p_plano_tratamento_item_id: firstItem })).error).not.toBeNull();
    expect((await (await login(inactive)).rpc("link_procedure_to_treatment_plan_item", { p_procedimento_id: procedure, p_plano_tratamento_item_id: firstItem })).error).not.toBeNull();
    expect((await (await login(orphan)).rpc("link_procedure_to_treatment_plan_item", { p_procedimento_id: procedure, p_plano_tratamento_item_id: firstItem })).error).not.toBeNull();
    expect((await dentistB.rpc("link_procedure_to_treatment_plan_item", { p_procedimento_id: procedure, p_plano_tratamento_item_id: firstItem })).error).not.toBeNull();
    expect((await dentistA.rpc("link_procedure_to_treatment_plan_item", { p_procedimento_id: procedure, p_plano_tratamento_item_id: firstItem })).error).toBeNull();
    expect((await service.from("planos_tratamento").select("status").eq("id", planId).single()).data?.status).toBe("em_andamento");
    expect((await service.from("plano_tratamento_itens").select("status").eq("id", firstItem).single()).data?.status).toBe("em_andamento");
    const anotherAttendance = await directAttendance(); const excessProcedure = await manualProcedure(anotherAttendance);
    expect((await dentistA.rpc("link_procedure_to_treatment_plan_item", { p_procedimento_id: excessProcedure, p_plano_tratamento_item_id: firstItem })).error).not.toBeNull();
    expect((await dentistA.rpc("finalize_attendance", { p_atendimento_id: attendance, p_evolucao: `${PREFIX}Evolucao` })).error).toBeNull();
    expect((await service.from("plano_tratamento_itens").select("status").eq("id", firstItem).single()).data?.status).toBe("realizado");
  });

  it("conclui o plano somente quando todos os itens possuem evidencia finalizada", async () => {
    const planId = planIds[0]!;
    for (const itemId of itemIds.slice(1)) {
      const attendance = await directAttendance(); const procedure = await manualProcedure(attendance);
      expect((await dentistA.rpc("link_procedure_to_treatment_plan_item", { p_procedimento_id: procedure, p_plano_tratamento_item_id: itemId })).error).toBeNull();
      expect((await dentistA.rpc("finalize_attendance", { p_atendimento_id: attendance, p_evolucao: `${PREFIX}Finalizacao` })).error).toBeNull();
    }
    expect((await service.from("planos_tratamento").select("status").eq("id", planId).single()).data?.status).toBe("concluido");
    const concludedAttendance = await directAttendance(); const concludedProcedure = await manualProcedure(concludedAttendance);
    expect((await dentistA.rpc("link_procedure_to_treatment_plan_item", { p_procedimento_id: concludedProcedure, p_plano_tratamento_item_id: itemIds[0] })).error).not.toBeNull();
  });

  it("permite tres vinculos sequenciais no mesmo item em plano em andamento, sem exceder quantidade", async () => {
    const budgetId = await createApprovedBudget(1, 3); const converted = await convert(admin, budgetId);
    expect(converted.error).toBeNull(); const planId = (converted.data as { id: string }).id; planIds.push(planId);
    const { data: rows } = await service.from("plano_tratamento_itens").select("id").eq("plano_tratamento_id", planId);
    const itemId = rows?.[0]?.id ?? ""; itemIds.push(itemId);
    for (let index = 1; index <= 3; index++) {
      const attendance = await directAttendance(); const procedure = await manualProcedure(attendance);
      expect((await dentistA.rpc("link_procedure_to_treatment_plan_item", { p_procedimento_id: procedure, p_plano_tratamento_item_id: itemId })).error).toBeNull();
      expect((await service.from("planos_tratamento").select("status").eq("id", planId).single()).data?.status).toBe("em_andamento");
    }
    const fourthAttendance = await directAttendance(); const fourthProcedure = await manualProcedure(fourthAttendance);
    expect((await dentistA.rpc("link_procedure_to_treatment_plan_item", { p_procedimento_id: fourthProcedure, p_plano_tratamento_item_id: itemId })).error).not.toBeNull();
    const otherPatientId = await createQaPatient(); const otherAttendance = await directAttendance(otherPatientId); const otherProcedure = await manualProcedure(otherAttendance);
    expect((await dentistA.rpc("link_procedure_to_treatment_plan_item", { p_procedimento_id: otherProcedure, p_plano_tratamento_item_id: itemId })).error).not.toBeNull();
  });

  it("permite cancelamento administrativo apenas antes de qualquer execucao", async () => {
    const cancellableBudget = await createApprovedBudget(1); const converted = await convert(admin, cancellableBudget);
    expect(converted.error).toBeNull(); const planId = (converted.data as { id: string }).id; planIds.push(planId);
    const { data: planItems } = await service.from("plano_tratamento_itens").select("id").eq("plano_tratamento_id", planId); itemIds.push(...(planItems ?? []).map((item) => item.id));
    expect((await dentistA.rpc("cancel_treatment_plan", { p_plano_tratamento_id: planId })).error).not.toBeNull();
    expect((await reception.rpc("cancel_treatment_plan", { p_plano_tratamento_id: planId })).error).not.toBeNull();
    expect((await admin.rpc("cancel_treatment_plan", { p_plano_tratamento_id: planId })).error).toBeNull();
    expect((await service.from("planos_tratamento").select("status,cancelado_em").eq("id", planId).single()).data).toMatchObject({ status: "cancelado" });
    const cancelledAttendance = await directAttendance(); const cancelledProcedure = await manualProcedure(cancelledAttendance);
    expect((await dentistA.rpc("link_procedure_to_treatment_plan_item", { p_procedimento_id: cancelledProcedure, p_plano_tratamento_item_id: planItems?.[0]?.id })).error).not.toBeNull();
    expect((await admin.rpc("cancel_treatment_plan", { p_plano_tratamento_id: planIds[0] })).error).not.toBeNull();
  });

  it("nao reinterpreta um legado convertido sem plano", async () => {
    const legacyBudget = await createApprovedBudget(1);
    expect((await admin.rpc("set_budget_status", { p_orcamento_id: legacyBudget, p_status: "convertido" })).error).toBeNull();
    expect((await service.from("planos_tratamento").select("id").eq("orcamento_id", legacyBudget)).data).toEqual([]);
  });
});
