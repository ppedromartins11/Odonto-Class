import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createQaAdmin } from "./helpers";

const ACK = "I_ACKNOWLEDGE_FAKE_DATA_ONLY";
const PREFIX = "QA_SVC_";
type Role = "administrador" | "dentista" | "recepcao";
type Identity = { id: string; email: string; password: string; role: Role };

let service: SupabaseClient;
let admin: SupabaseClient;
let reception: SupabaseClient;
let dentistA: SupabaseClient;
let dentistB: SupabaseClient;
let inactive: Identity;
let orphan: Identity;
let url: string;
let anonKey: string;
let adminId: string;
const users: Identity[] = [];
const patientIds: string[] = [];
const attendanceIds: string[] = [];
const procedureIds: string[] = [];
const serviceIds: string[] = [];
const materialIds: string[] = [];

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} nao configurada em .env.test.local.`);
  return value;
}

function client() {
  return createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function login(identity: Pick<Identity, "email" | "password">) {
  const signed = client();
  expect((await signed.auth.signInWithPassword(identity)).error).toBeNull();
  return signed;
}

async function createIdentity(role: Role) {
  const suffix = randomUUID();
  const candidate = { email: `qa_svc_${role}_${suffix}@example.com`, password: `Tmp-${randomUUID()}-A9!`, role };
  const { data, error } = await service.auth.admin.createUser({
    email: candidate.email,
    password: candidate.password,
    email_confirm: true,
    user_metadata: { nome: `${PREFIX}${role}_${suffix}`, perfil: role, created_by: adminId },
  });
  if (error || !data.user) throw error ?? new Error("Usuario QA_SVC ausente.");
  const identity = { ...candidate, id: data.user.id };
  users.push(identity);
  return identity;
}

async function createPatient() {
  const { data, error } = await admin.rpc("create_patient", {
    p_nome: `${PREFIX}Paciente_${randomUUID()}`,
    p_data_nascimento: "1990-01-15",
    p_telefone_contato: "+00 00000-0000",
    p_documento_identificacao: null,
    p_alergias: null,
    p_intolerancias: null,
    p_medicamentos_em_uso: null,
  });
  if (error || !data) throw error ?? new Error("Paciente QA_SVC ausente.");
  const id = (data as { id: string }).id;
  patientIds.push(id);
  return id;
}

async function directAttendance(dentist: SupabaseClient, patientId: string) {
  const { data, error } = await dentist.rpc("create_direct_attendance", { p_paciente_id: patientId });
  if (error || !data) throw error ?? new Error("Atendimento QA_SVC ausente.");
  const id = (data as { id: string }).id;
  attendanceIds.push(id);
  return id;
}

async function createMaterial(quantity: number) {
  const { data, error } = await admin.rpc("create_stock_material", {
    p_nome: `${PREFIX}Material_${randomUUID()}`,
    p_categoria: "QA_SVC",
    p_unidade: "unidade",
    p_quantidade_inicial: quantity,
    p_estoque_minimo: 0,
    p_validade: null,
    p_fornecedor: null,
    p_ativo: true,
  });
  if (error || !data) throw error ?? new Error("Material QA_SVC ausente.");
  const id = (data as { id: string }).id;
  materialIds.push(id);
  return id;
}

async function createService(value = 1000) {
  const { data, error } = await admin.rpc("create_service", {
    p_nome: `${PREFIX}Servico_${randomUUID()}`,
    p_descricao: "Fixture descartavel",
    p_categoria: "QA_SVC",
    p_valor_padrao_centavos: value,
  });
  if (error || !data) throw error ?? new Error("Servico QA_SVC ausente.");
  const id = (data as { id: string }).id;
  serviceIds.push(id);
  return id;
}

async function configure(serviceId: string, materialId: string, quantity: number) {
  const { error } = await admin.rpc("configure_service_material", {
    p_servico_id: serviceId,
    p_material_id: materialId,
    p_quantidade_padrao: quantity,
    p_ativo: true,
  });
  expect(error).toBeNull();
}

async function addServiceProcedure(dentist: SupabaseClient, attendanceId: string, serviceId: string, quantity = 1, value: number | null = null) {
  const { data, error } = await dentist.rpc("create_service_procedure", {
    p_atendimento_id: attendanceId,
    p_servico_id: serviceId,
    p_quantidade: quantity,
    p_valor_aplicado_centavos: value,
    p_detalhes: `${PREFIX}Detalhe`,
  });
  if (error || !data) throw error ?? new Error("Procedimento QA_SVC ausente.");
  const id = (data as { id: string }).id;
  procedureIds.push(id);
  return id;
}

async function getQuantity(materialId: string) {
  const { data, error } = await service.from("materiais_estoque").select("quantidade_atual").eq("id", materialId).single();
  expect(error).toBeNull();
  return data?.quantidade_atual;
}

describe("Sprint 13: servicos, consumo de estoque e finalizacao atomica", () => {
  beforeAll(async () => {
    if (process.env.SUPABASE_TEST_HOMOLOGATION !== ACK) throw new Error("Homologacao ficticia nao confirmada.");
    url = required("SUPABASE_TEST_URL");
    anonKey = required("SUPABASE_TEST_ANON_KEY");
    service = createClient(url, required("SUPABASE_TEST_SERVICE_ROLE_KEY"), { auth: { autoRefreshToken: false, persistSession: false } });
    const qaAdmin = await createQaAdmin(service, url, anonKey);
    admin = qaAdmin.session;
    adminId = qaAdmin.identity.id;
    users.push(qaAdmin.identity);
    const receptionIdentity = await createIdentity("recepcao");
    const dentistAIdentity = await createIdentity("dentista");
    const dentistBIdentity = await createIdentity("dentista");
    inactive = await createIdentity("recepcao");
    orphan = await createIdentity("recepcao");
    reception = await login(receptionIdentity);
    dentistA = await login(dentistAIdentity);
    dentistB = await login(dentistBIdentity);
    expect((await admin.rpc("update_user_access", { p_usuario_id: inactive.id, p_perfil: null, p_status: "inativo" })).error).toBeNull();
    expect((await service.from("usuarios").delete().eq("id", orphan.id)).error).toBeNull();
  });

  afterAll(async () => {
    if (!service) return;
    const userIds = users.map((item) => item.id);
    if (materialIds.length) await service.from("movimentacoes_estoque").delete().in("material_id", materialIds);
    if (procedureIds.length) await service.from("procedimento_materiais_consumo").delete().in("procedimento_id", procedureIds);
    if (userIds.length) await service.from("auditoria").delete().in("usuario_id", userIds);
    if (procedureIds.length) await service.from("procedimentos").delete().in("id", procedureIds);
    if (attendanceIds.length) await service.from("atendimentos").delete().in("id", attendanceIds);
    if (serviceIds.length) await service.from("servico_materiais").delete().in("servico_id", serviceIds);
    if (serviceIds.length) await service.from("servicos").delete().in("id", serviceIds);
    if (materialIds.length) await service.from("materiais_estoque").delete().in("id", materialIds);
    if (patientIds.length) {
      await service.from("paciente_alertas_clinicos").delete().in("paciente_id", patientIds);
      await service.from("pacientes").delete().in("id", patientIds);
    }
    for (const identity of [...users].reverse()) {
      await service.from("profissionais").delete().eq("usuario_id", identity.id);
      await service.from("usuarios").delete().eq("id", identity.id);
      await service.auth.admin.deleteUser(identity.id);
    }
  });

  it("administra o catalogo, isola a recepcao e mantem servicos inativos fora da lista do dentista", async () => {
    const serviceId = await createService(1250);
    expect((await admin.rpc("update_service", { p_servico_id: serviceId, p_nome: `${PREFIX}Servico editado`, p_descricao: null, p_categoria: "QA_SVC", p_valor_padrao_centavos: 1500 })).error).toBeNull();
    expect((await dentistA.rpc("list_services", { p_query: null, p_status: "ativo", p_page: 1, p_page_size: 100 })).error).toBeNull();
    expect((await reception.rpc("list_services", { p_query: null, p_status: "ativo", p_page: 1, p_page_size: 100 })).error).not.toBeNull();
    expect((await admin.rpc("set_service_active", { p_servico_id: serviceId, p_ativo: false })).error).toBeNull();
    const dentistList = await dentistA.rpc("list_services", { p_query: null, p_status: "todos", p_page: 1, p_page_size: 100 });
    expect((dentistList.data as Array<{ id: string }>).some((row) => row.id === serviceId)).toBe(false);
    expect((await admin.rpc("set_service_active", { p_servico_id: serviceId, p_ativo: true })).error).toBeNull();
    expect((await reception.from("servicos").insert({ nome: `${PREFIX}DML`, valor_padrao_centavos: 0, created_by: adminId, updated_by: adminId })).error).not.toBeNull();
    expect((await reception.from("servico_materiais").delete().eq("servico_id", serviceId)).error).not.toBeNull();
  });

  it("congela composicao e valor historico, calcula quantidade e finaliza com saldo suficiente", async () => {
    const materialId = await createMaterial(10);
    const serviceId = await createService(1234);
    await configure(serviceId, materialId, 2);
    const attendanceId = await directAttendance(dentistA, await createPatient());
    const procedureId = await addServiceProcedure(dentistA, attendanceId, serviceId, 3);
    const { data: snapshot, error: snapshotError } = await service.from("procedimento_materiais_consumo").select("quantidade_por_servico,quantidade_total").eq("procedimento_id", procedureId).single();
    expect(snapshotError).toBeNull();
    expect(snapshot).toMatchObject({ quantidade_por_servico: 2, quantidade_total: 6 });
    await configure(serviceId, materialId, 5);
    expect((await service.from("procedimento_materiais_consumo").select("quantidade_por_servico,quantidade_total").eq("procedimento_id", procedureId).single()).data).toMatchObject({ quantidade_por_servico: 2, quantidade_total: 6 });
    expect((await admin.rpc("update_service", { p_servico_id: serviceId, p_nome: `${PREFIX}Servico novo valor`, p_descricao: null, p_categoria: "QA_SVC", p_valor_padrao_centavos: 9999 })).error).toBeNull();
    const beforeUpdate = await service.from("procedimentos").select("valor_aplicado_centavos").eq("id", procedureId).single();
    expect(beforeUpdate.data?.valor_aplicado_centavos).toBe(1234);
    expect((await dentistA.rpc("update_service_procedure", { p_procedimento_id: procedureId, p_quantidade: 3, p_valor_aplicado_centavos: 1500, p_detalhes: `${PREFIX}Atualizado` })).error).toBeNull();
    const preview = await dentistA.rpc("preview_attendance_finalization", { p_atendimento_id: attendanceId });
    expect(preview.error).toBeNull();
    expect(preview.data).toEqual(expect.arrayContaining([expect.objectContaining({ material_id: materialId, necessario: 6, disponivel: 10, saldo_apos: 4, suficiente: true })]));
    expect(await getQuantity(materialId)).toBe(10);
    expect((await dentistA.rpc("finalize_attendance", { p_atendimento_id: attendanceId, p_evolucao: `${PREFIX}Evolucao` })).error).toBeNull();
    expect(await getQuantity(materialId)).toBe(4);
    const movements = await service.from("movimentacoes_estoque").select("id,referencia,atendimento_id,procedimento_id").eq("atendimento_id", attendanceId);
    expect(movements.data).toHaveLength(1);
    expect(movements.data?.[0]).toMatchObject({ referencia: "Consumo automatico por atendimento", atendimento_id: attendanceId, procedimento_id: procedureId });
    const consumption = await service.from("procedimento_materiais_consumo").select("id").eq("procedimento_id", procedureId).single();
    expect(consumption.error).toBeNull();
    const audit = await admin.from("auditoria").select("evento,dados").in("entidade_id", [serviceId, procedureId, consumption.data?.id ?? ""]);
    expect(audit.error).toBeNull();
    const auditEvents = new Set(audit.data?.map((row) => row.evento));
    expect(auditEvents.has("servico_criado")).toBe(true);
    expect(auditEvents.has("servico_realizado")).toBe(true);
    expect(auditEvents.has("estoque_consumido_atendimento")).toBe(true);
    expect(JSON.stringify(audit.data)).not.toContain(`${PREFIX}Detalhe`);
    expect(JSON.stringify(audit.data)).not.toContain(`${PREFIX}Atualizado`);
    expect((await dentistA.rpc("finalize_attendance", { p_atendimento_id: attendanceId, p_evolucao: `${PREFIX}Duplicada` })).error).not.toBeNull();
    expect((await service.from("movimentacoes_estoque").select("id").eq("atendimento_id", attendanceId)).data).toHaveLength(1);
  });

  it("finaliza servico sem material sem criar movimentacao", async () => {
    const serviceId = await createService();
    const attendanceId = await directAttendance(dentistA, await createPatient());
    await addServiceProcedure(dentistA, attendanceId, serviceId);
    const preview = await dentistA.rpc("preview_attendance_finalization", { p_atendimento_id: attendanceId });
    expect(preview.error).toBeNull();
    expect(preview.data).toEqual([]);
    expect((await dentistA.rpc("finalize_attendance", { p_atendimento_id: attendanceId, p_evolucao: `${PREFIX}Sem material` })).error).toBeNull();
    expect((await service.from("movimentacoes_estoque").select("id").eq("atendimento_id", attendanceId)).data).toEqual([]);
  });

  it("aceita saldo exato e rejeita estoque insuficiente ou material inativo sem baixa parcial", async () => {
    const exactMaterial = await createMaterial(2);
    const exactService = await createService();
    await configure(exactService, exactMaterial, 1);
    const exactAttendance = await directAttendance(dentistA, await createPatient());
    await addServiceProcedure(dentistA, exactAttendance, exactService, 2);
    expect((await dentistA.rpc("finalize_attendance", { p_atendimento_id: exactAttendance, p_evolucao: `${PREFIX}Saldo exato` })).error).toBeNull();
    expect(await getQuantity(exactMaterial)).toBe(0);

    const insufficientMaterial = await createMaterial(1);
    const insufficientService = await createService();
    await configure(insufficientService, insufficientMaterial, 2);
    const insufficientAttendance = await directAttendance(dentistA, await createPatient());
    await addServiceProcedure(dentistA, insufficientAttendance, insufficientService);
    expect((await dentistA.rpc("finalize_attendance", { p_atendimento_id: insufficientAttendance, p_evolucao: `${PREFIX}Insuficiente` })).error).not.toBeNull();
    expect(await getQuantity(insufficientMaterial)).toBe(1);
    expect((await service.from("atendimentos").select("status").eq("id", insufficientAttendance).single()).data?.status).toBe("em_andamento");
    expect((await service.from("movimentacoes_estoque").select("id").eq("atendimento_id", insufficientAttendance)).data).toEqual([]);

    const inactiveMaterial = await createMaterial(2);
    const inactiveService = await createService();
    await configure(inactiveService, inactiveMaterial, 1);
    const inactiveAttendance = await directAttendance(dentistA, await createPatient());
    await addServiceProcedure(dentistA, inactiveAttendance, inactiveService);
    expect((await admin.rpc("set_stock_material_active", { p_material_id: inactiveMaterial, p_ativo: false })).error).toBeNull();
    expect((await dentistA.rpc("finalize_attendance", { p_atendimento_id: inactiveAttendance, p_evolucao: `${PREFIX}Inativo` })).error).not.toBeNull();
    expect(await getQuantity(inactiveMaterial)).toBe(2);
    expect((await service.from("movimentacoes_estoque").select("id").eq("atendimento_id", inactiveAttendance)).data).toEqual([]);
  });

  it("consome multiplos materiais atomicamente e nao baixa nenhum quando um saldo falha", async () => {
    const enoughA = await createMaterial(4);
    const enoughB = await createMaterial(2);
    const enoughService = await createService();
    await configure(enoughService, enoughA, 2);
    await configure(enoughService, enoughB, 1);
    const enoughAttendance = await directAttendance(dentistA, await createPatient());
    await addServiceProcedure(dentistA, enoughAttendance, enoughService);
    expect((await dentistA.rpc("finalize_attendance", { p_atendimento_id: enoughAttendance, p_evolucao: `${PREFIX}Multiplos` })).error).toBeNull();
    expect(await getQuantity(enoughA)).toBe(2);
    expect(await getQuantity(enoughB)).toBe(1);

    const rollbackA = await createMaterial(2);
    const rollbackB = await createMaterial(0);
    const rollbackService = await createService();
    await configure(rollbackService, rollbackA, 2);
    await configure(rollbackService, rollbackB, 1);
    const rollbackAttendance = await directAttendance(dentistA, await createPatient());
    await addServiceProcedure(dentistA, rollbackAttendance, rollbackService);
    expect((await dentistA.rpc("finalize_attendance", { p_atendimento_id: rollbackAttendance, p_evolucao: `${PREFIX}Rollback` })).error).not.toBeNull();
    expect(await getQuantity(rollbackA)).toBe(2);
    expect(await getQuantity(rollbackB)).toBe(0);
    expect((await service.from("movimentacoes_estoque").select("id").eq("atendimento_id", rollbackAttendance)).data).toEqual([]);
  });

  it("serializa finalizacoes concorrentes sem saldo negativo", async () => {
    const materialId = await createMaterial(1);
    const serviceId = await createService();
    await configure(serviceId, materialId, 1);
    const attendanceA = await directAttendance(dentistA, await createPatient());
    const attendanceB = await directAttendance(dentistB, await createPatient());
    await addServiceProcedure(dentistA, attendanceA, serviceId);
    await addServiceProcedure(dentistB, attendanceB, serviceId);
    const [first, second] = await Promise.all([
      dentistA.rpc("finalize_attendance", { p_atendimento_id: attendanceA, p_evolucao: `${PREFIX}Concorrencia A` }),
      dentistB.rpc("finalize_attendance", { p_atendimento_id: attendanceB, p_evolucao: `${PREFIX}Concorrencia B` }),
    ]);
    expect([first, second].filter((result) => !result.error)).toHaveLength(1);
    expect([first, second].filter((result) => result.error)).toHaveLength(1);
    expect(await getQuantity(materialId)).toBe(0);
    expect((await service.from("movimentacoes_estoque").select("id").eq("material_id", materialId).not("atendimento_id", "is", null)).data).toHaveLength(1);
  });

  it("nega acesso clinico cruzado, DML direto e usuarios inativo ou sem perfil", async () => {
    const serviceId = await createService();
    const attendanceId = await directAttendance(dentistA, await createPatient());
    const procedureId = await addServiceProcedure(dentistA, attendanceId, serviceId);
    expect((await dentistB.from("atendimentos").select("id,evolucao").eq("id", attendanceId)).data).toEqual([]);
    expect((await dentistB.rpc("update_service_procedure", { p_procedimento_id: procedureId, p_quantidade: 1, p_valor_aplicado_centavos: 1000, p_detalhes: null })).error).not.toBeNull();
    expect((await dentistB.rpc("preview_attendance_finalization", { p_atendimento_id: attendanceId })).error).not.toBeNull();
    expect((await dentistB.rpc("finalize_attendance", { p_atendimento_id: attendanceId, p_evolucao: `${PREFIX}Negado` })).error).not.toBeNull();
    expect((await reception.rpc("create_service_procedure", { p_atendimento_id: attendanceId, p_servico_id: serviceId, p_quantidade: 1, p_valor_aplicado_centavos: 1000, p_detalhes: null })).error).not.toBeNull();
    expect((await reception.from("procedimento_materiais_consumo").insert({ procedimento_id: procedureId, servico_material_id: randomUUID(), material_id: randomUUID(), quantidade_por_servico: 1, quantidade_total: 1, created_by: adminId })).error).not.toBeNull();
    for (const identity of [inactive, orphan]) {
      const blocked = await login(identity);
      expect((await blocked.rpc("list_services", { p_query: null, p_status: "ativo", p_page: 1, p_page_size: 20 })).error).not.toBeNull();
      expect((await blocked.from("servicos").select("id")).data).toEqual([]);
    }
  });
});
