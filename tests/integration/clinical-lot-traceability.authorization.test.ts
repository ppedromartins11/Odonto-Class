import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createQaUser, createQaAdmin } from "./helpers";

const ACK = "I_ACKNOWLEDGE_FAKE_DATA_ONLY";
const PREFIX = "QA_0029_";
type Role = "administrador" | "dentista" | "recepcao";
type Identity = { id: string; email: string; password: string; role: Role };
type Consumption = {
  id: string;
  lote_id: string | null;
  movimentacao_estoque_id: string;
  movimentacao_lote_id: string | null;
  estornado_em: string | null;
  movimentacao_estorno_id?: string | null;
  movimentacao_lote_estorno_id?: string | null;
};

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
let patientId: string;
let controlledMaterialId: string;
let controlledLotA: string;
let controlledLotB: string;
let controlledExpiredLot: string;
let controlledInactiveLot: string;
let foreignLotId: string;
let nonLotMaterialId: string;
let concurrentMaterialId: string;
const users: Identity[] = [];
const materialIds: string[] = [];
const serviceIds: string[] = [];
const attendanceIds: string[] = [];
const procedureIds: string[] = [];

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} nao configurada em .env.test.local.`);
  return value;
}

function client() {
  return createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function login(identity: Pick<Identity, "email" | "password">) {
  const session = client();
  expect((await session.auth.signInWithPassword(identity)).error).toBeNull();
  return session;
}

async function createIdentity(role: Role) {
  const suffix = randomUUID();
  const candidate = { email: `qa_0029_${role}_${suffix}@example.test`, password: `Tmp-${randomUUID()}-A9!`, role };
  const { data, error } = await createQaUser(service, {
    email: candidate.email,
    password: candidate.password,
    email_confirm: true,
    user_metadata: { nome: `${PREFIX}${role}_${suffix}`, perfil: role, created_by: adminId },
  });
  if (error || !data.user) throw error ?? new Error("Identidade QA_0029 ausente.");
  const identity = { ...candidate, id: data.user.id };
  users.push(identity);
  return identity;
}

async function createMaterial(name: string, quantity: number) {
  const { data, error } = await admin.rpc("create_stock_material", {
    p_nome: name,
    p_categoria: "QA_0029",
    p_unidade: "unidade",
    p_quantidade_inicial: quantity,
    p_estoque_minimo: 0,
    p_validade: null,
    p_fornecedor: null,
    p_ativo: true,
  });
  if (error || !data) throw error ?? new Error("Material QA_0029 ausente.");
  const id = (data as { id: string }).id;
  materialIds.push(id);
  return id;
}

async function enableLotControl(materialId: string, code: string, validity: string) {
  const result = await admin.rpc("set_stock_lot_control", {
    p_material_id: materialId,
    p_controla: true,
    p_codigo_lote_inicial: code,
    p_data_validade: validity,
    p_data_fabricacao: null,
    p_fornecedor: null,
  });
  expect(result.error).toBeNull();
  const { data, error } = await service.from("materiais_lotes").select("id").eq("material_id", materialId).eq("codigo_lote", code).single();
  expect(error).toBeNull();
  if (!data) throw new Error("Lote QA_0029 ausente.");
  return data.id as string;
}

async function addLot(materialId: string, code: string, quantity: number, validity: string) {
  const result = await reception.rpc("register_stock_lot_entry", {
    p_material_id: materialId,
    p_codigo_lote: code,
    p_quantidade: quantity,
    p_data_validade: validity,
    p_data_fabricacao: null,
    p_fornecedor: null,
    p_motivo: null,
    p_referencia: null,
  });
  expect(result.error).toBeNull();
  const { data, error } = await service.from("materiais_lotes").select("id").eq("material_id", materialId).eq("codigo_lote", code).single();
  expect(error).toBeNull();
  if (!data) throw new Error("Lote adicional QA_0029 ausente.");
  return data.id as string;
}

async function createService(materialId: string, quantity: number) {
  const suffix = randomUUID();
  const { data, error } = await admin.rpc("create_service", {
    p_nome: `${PREFIX}Servico_${suffix}`,
    p_descricao: "Fixture de rastreabilidade descartavel",
    p_categoria: "QA_0029",
    p_valor_padrao_centavos: 0,
  });
  if (error || !data) throw error ?? new Error("Servico QA_0029 ausente.");
  const id = (data as { id: string }).id;
  serviceIds.push(id);
  expect((await admin.rpc("configure_service_material", {
    p_servico_id: id,
    p_material_id: materialId,
    p_quantidade_padrao: quantity,
    p_ativo: true,
  })).error).toBeNull();
  return id;
}

async function createProcedureWithSnapshot(dentist: SupabaseClient, serviceId: string) {
  const attendance = await dentist.rpc("create_direct_attendance", { p_paciente_id: patientId });
  expect(attendance.error).toBeNull();
  const attendanceId = (attendance.data as { id: string }).id;
  attendanceIds.push(attendanceId);
  const procedure = await dentist.rpc("create_service_procedure", {
    p_atendimento_id: attendanceId,
    p_servico_id: serviceId,
    p_quantidade: 1,
    p_valor_aplicado_centavos: 0,
    p_detalhes: `${PREFIX}Detalhe`,
  });
  expect(procedure.error).toBeNull();
  const procedureId = (procedure.data as { id: string }).id;
  procedureIds.push(procedureId);
  const { data: snapshot, error } = await service.from("procedimento_materiais_consumo").select("id,material_id").eq("procedimento_id", procedureId).single();
  expect(error).toBeNull();
  if (!snapshot) throw new Error("Snapshot QA_0029 ausente.");
  return { attendanceId, procedureId, snapshotId: snapshot.id as string, materialId: snapshot.material_id as string };
}

async function quantity(materialId: string) {
  const { data, error } = await service.from("materiais_estoque").select("quantidade_atual").eq("id", materialId).single();
  expect(error).toBeNull();
  return data?.quantidade_atual;
}

async function lotQuantity(lotId: string) {
  const { data, error } = await service.from("materiais_lotes").select("quantidade_atual").eq("id", lotId).single();
  expect(error).toBeNull();
  return data?.quantidade_atual;
}

async function consume(dentist: SupabaseClient, procedureId: string, materialId: string, lotId: string | null, snapshotId: string, amount: number) {
  return dentist.rpc("record_clinical_material_consumption", {
    p_procedimento_id: procedureId,
    p_material_id: materialId,
    p_lote_id: lotId,
    p_quantidade: amount,
    p_procedimento_material_consumo_id: snapshotId,
  });
}

describe.sequential("Sprint 22.3: rastreabilidade clinica de lote", () => {
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

    const patient = await admin.rpc("create_patient", {
      p_nome: `${PREFIX}Paciente_${randomUUID()}`,
      p_data_nascimento: "1990-01-15",
      p_telefone_contato: null,
      p_documento_identificacao: null,
      p_alergias: null,
      p_intolerancias: null,
      p_medicamentos_em_uso: null,
    });
    expect(patient.error).toBeNull();
    patientId = (patient.data as { id: string }).id;

    controlledMaterialId = await createMaterial(`${PREFIX}Material controlado`, 4);
    controlledLotA = await enableLotControl(controlledMaterialId, `${PREFIX}LOTE_A`, "2099-12-31");
    controlledLotB = await addLot(controlledMaterialId, `${PREFIX}LOTE_B`, 4, "2099-12-31");
    controlledExpiredLot = await addLot(controlledMaterialId, `${PREFIX}LOTE_VENCIDO`, 1, "2000-01-01");
    controlledInactiveLot = await addLot(controlledMaterialId, `${PREFIX}LOTE_INATIVO`, 1, "2099-12-31");
    expect((await reception.rpc("register_stock_lot_exit", {
      p_material_id: controlledMaterialId,
      p_lote_id: controlledInactiveLot,
      p_quantidade: 1,
      p_finalidade: "uso",
      p_motivo: null,
      p_referencia: null,
    })).error).toBeNull();
    expect((await admin.rpc("set_stock_lot_active", { p_lote_id: controlledInactiveLot, p_ativo: false })).error).toBeNull();

    const foreignMaterialId = await createMaterial(`${PREFIX}Material estrangeiro`, 1);
    foreignLotId = await enableLotControl(foreignMaterialId, `${PREFIX}LOTE_ESTRANGEIRO`, "2099-12-31");
    nonLotMaterialId = await createMaterial(`${PREFIX}Material sem lote`, 5);
    concurrentMaterialId = await createMaterial(`${PREFIX}Material concorrente`, 1);
    await enableLotControl(concurrentMaterialId, `${PREFIX}LOTE_CONCORRENTE`, "2099-12-31");
  });

  afterAll(async () => {
    if (!service) return;
    const userIds = users.map((user) => user.id);
    const { data: lots } = materialIds.length ? await service.from("materiais_lotes").select("id").in("material_id", materialIds) : { data: [] };
    const lotIds = (lots ?? []).map((lot) => lot.id as string);
    const { data: movements } = materialIds.length ? await service.from("movimentacoes_estoque").select("id").in("material_id", materialIds) : { data: [] };
    const movementIds = (movements ?? []).map((movement) => movement.id as string);
    if (procedureIds.length) expect((await service.from("consumos_clinicos_materiais").delete().in("procedimento_id", procedureIds)).error).toBeNull();
    if (movementIds.length) expect((await service.from("movimentacoes_lotes").delete().in("movimentacao_id", movementIds)).error).toBeNull();
    if (movementIds.length) expect((await service.from("movimentacoes_estoque").delete().in("id", movementIds)).error).toBeNull();
    if (procedureIds.length) expect((await service.from("procedimento_dentes").delete().in("procedimento_id", procedureIds)).error).toBeNull();
    if (procedureIds.length) expect((await service.from("procedimento_materiais_consumo").delete().in("procedimento_id", procedureIds)).error).toBeNull();
    if (userIds.length) expect((await service.from("auditoria").delete().in("usuario_id", userIds)).error).toBeNull();
    if (procedureIds.length) expect((await service.from("procedimentos").delete().in("id", procedureIds)).error).toBeNull();
    if (attendanceIds.length) expect((await service.from("atendimentos").delete().in("id", attendanceIds)).error).toBeNull();
    if (serviceIds.length) expect((await service.from("servico_materiais").delete().in("servico_id", serviceIds)).error).toBeNull();
    if (serviceIds.length) expect((await service.from("servicos").delete().in("id", serviceIds)).error).toBeNull();
    if (lotIds.length) expect((await service.from("materiais_lotes").delete().in("id", lotIds)).error).toBeNull();
    if (materialIds.length) expect((await service.from("materiais_estoque").delete().in("id", materialIds)).error).toBeNull();
    if (patientId) {
      expect((await service.from("paciente_alertas_clinicos").delete().eq("paciente_id", patientId)).error).toBeNull();
      expect((await service.from("pacientes").delete().eq("id", patientId)).error).toBeNull();
    }
    for (const user of [...users].reverse()) {
      await service.from("profissionais").delete().eq("usuario_id", user.id);
      await service.from("usuarios").delete().eq("id", user.id);
      const deleted = await service.auth.admin.deleteUser(user.id);
      expect(deleted.error?.code === "user_not_found" ? null : deleted.error).toBeNull();
    }
    for (const [table, column] of [["pacientes", "nome"], ["procedimentos", "descricao"], ["servicos", "nome"], ["materiais_estoque", "nome"], ["usuarios", "nome"]] as const) {
      const result = await service.from(table).select("id", { count: "exact", head: true }).ilike(column, "QA\\_0029\\_%");
      expect(result.error).toBeNull();
      expect(result.count, `residuos QA_0029 em ${table}`).toBe(0);
    }
    const authUsers = await service.auth.admin.listUsers({ page: 1, perPage: 1000 });
    expect(authUsers.error).toBeNull();
    expect(authUsers.data.users.filter((user) => user.email?.startsWith("qa_0029_"))).toHaveLength(0);
  });

  it("exige consumo real de lote, permite dois lotes e preserva a cadeia rastreavel", async () => {
    const serviceId = await createService(controlledMaterialId, 2);
    const target = await createProcedureWithSnapshot(dentistA, serviceId);
    expect((await dentistA.rpc("finalize_attendance", { p_atendimento_id: target.attendanceId, p_evolucao: `${PREFIX}Evolucao bloqueada` })).error?.message).toContain("LOT_CONTROLLED_CLINICAL_CONSUMPTION_PENDING");

    const first = await consume(dentistA, target.procedureId, controlledMaterialId, controlledLotA, target.snapshotId, 1);
    const second = await consume(dentistA, target.procedureId, controlledMaterialId, controlledLotB, target.snapshotId, 1);
    expect(first.error).toBeNull();
    expect(second.error).toBeNull();
    const firstConsumption = first.data as Consumption;
    const secondConsumption = second.data as Consumption;
    expect(firstConsumption.lote_id).toBe(controlledLotA);
    expect(secondConsumption.lote_id).toBe(controlledLotB);
    expect(await quantity(controlledMaterialId)).toBe(7);

    const trace = await service.from("consumos_clinicos_materiais")
      .select("id,procedimento_id,material_id,lote_id,movimentacao_estoque_id,movimentacao_lote_id")
      .in("id", [firstConsumption.id, secondConsumption.id]);
    expect(trace.error).toBeNull();
    expect(trace.data).toHaveLength(2);
    for (const row of trace.data ?? []) {
      expect(row.procedimento_id).toBe(target.procedureId);
      expect(row.material_id).toBe(controlledMaterialId);
      expect(row.lote_id).toBeTruthy();
      expect(row.movimentacao_estoque_id).toBeTruthy();
      expect(row.movimentacao_lote_id).toBeTruthy();
    }
    const uiConsumptions = await dentistA
      .from("consumos_clinicos_materiais")
      .select("id,procedimento_id,procedimento_material_consumo_id,material_id,lote_id,quantidade,created_at,estornado_em,movimentacao_estoque_id,movimentacao_lote_id,movimentacao_estorno_id,procedimentos!inner(atendimento_id),materiais_estoque!inner(nome,unidade),lote:materiais_lotes!consumos_clinicos_materiais_lote_id_fkey(codigo_lote,data_validade)")
      .eq("procedimentos.atendimento_id", target.attendanceId);
    expect(uiConsumptions.error).toBeNull();
    expect(uiConsumptions.data).toHaveLength(2);
    expect(uiConsumptions.data?.every((item) => item.lote && item.materiais_estoque)).toBe(true);

    const availableLots = await dentistA
      .from("materiais_lotes")
      .select("id,material_id,codigo_lote,data_validade,quantidade_atual")
      .eq("material_id", controlledMaterialId)
      .eq("ativo", true)
      .gt("quantidade_atual", 0)
      .order("data_validade")
      .order("codigo_lote");
    expect(availableLots.error).toBeNull();
    expect(availableLots.data?.map((lot) => lot.id)).toEqual(expect.arrayContaining([controlledLotA, controlledLotB]));
    expect((await dentistA.rpc("finalize_attendance", { p_atendimento_id: target.attendanceId, p_evolucao: `${PREFIX}Evolucao final` })).error).toBeNull();
    expect(await quantity(controlledMaterialId)).toBe(7);
    expect((await dentistA.rpc("reverse_clinical_material_consumption", { p_consumo_id: firstConsumption.id })).error).not.toBeNull();
  });

  it("rejeita lote ausente, invalido, vencido, inativo e quantidade invalida", async () => {
    const serviceId = await createService(controlledMaterialId, 1);
    const target = await createProcedureWithSnapshot(dentistA, serviceId);
    for (const [lotId, amount] of [[null, 1], [foreignLotId, 1], [controlledExpiredLot, 1], [controlledInactiveLot, 1], [controlledLotA, 0], [controlledLotA, -1], [controlledLotA, 1_000_001]] as Array<[string | null, number]>) {
      expect((await consume(dentistA, target.procedureId, controlledMaterialId, lotId, target.snapshotId, amount)).error).not.toBeNull();
    }
  });

  it("estorna de modo atomico, bloqueia estorno duplo e volta a bloquear finalizacao sem consumo ativo", async () => {
    const serviceId = await createService(controlledMaterialId, 1);
    const target = await createProcedureWithSnapshot(dentistA, serviceId);
    const before = await quantity(controlledMaterialId);
    const beforeLot = await lotQuantity(controlledLotA);
    const consumed = await consume(dentistA, target.procedureId, controlledMaterialId, controlledLotA, target.snapshotId, 1);
    expect(consumed.error).toBeNull();
    const consumption = consumed.data as Consumption;
    expect(await quantity(controlledMaterialId)).toBe((before ?? 0) - 1);
    expect(await lotQuantity(controlledLotA)).toBe((beforeLot ?? 0) - 1);
    const reversed = await dentistA.rpc("reverse_clinical_material_consumption", { p_consumo_id: consumption.id });
    expect(reversed.error).toBeNull();
    expect((reversed.data as Consumption).estornado_em).toBeTruthy();
    expect(await quantity(controlledMaterialId)).toBe(before);
    expect(await lotQuantity(controlledLotA)).toBe(beforeLot);
    const persisted = await service.from("consumos_clinicos_materiais")
      .select("estornado_em,movimentacao_estorno_id,movimentacao_lote_estorno_id")
      .eq("id", consumption.id)
      .single();
    expect(persisted.error).toBeNull();
    expect(persisted.data?.estornado_em).toBeTruthy();
    expect(persisted.data?.movimentacao_estorno_id).toBeTruthy();
    expect(persisted.data?.movimentacao_lote_estorno_id).toBeTruthy();
    expect((await dentistA.rpc("reverse_clinical_material_consumption", { p_consumo_id: consumption.id })).error).not.toBeNull();
    expect((await dentistA.rpc("finalize_attendance", { p_atendimento_id: target.attendanceId, p_evolucao: `${PREFIX}Evolucao estornada` })).error?.message).toContain("LOT_CONTROLLED_CLINICAL_CONSUMPTION_PENDING");
    const audits = await service.from("auditoria").select("evento,dados").eq("entidade_id", consumption.id);
    expect(audits.error).toBeNull();
    expect(audits.data?.map((item) => item.evento)).toEqual(expect.arrayContaining(["material_clinico_consumido", "material_clinico_estornado"]));
    expect(JSON.stringify(audits.data)).not.toContain(`${PREFIX}Evolucao estornada`);
  });

  it("mantem materiais sem lote sem dupla baixa ao combinar consumo manual e finalizacao", async () => {
    const serviceId = await createService(nonLotMaterialId, 4);
    const target = await createProcedureWithSnapshot(dentistA, serviceId);
    const manual = await consume(dentistA, target.procedureId, nonLotMaterialId, null, target.snapshotId, 1);
    expect(manual.error).toBeNull();
    expect(await quantity(nonLotMaterialId)).toBe(4);
    expect((await dentistA.rpc("finalize_attendance", { p_atendimento_id: target.attendanceId, p_evolucao: `${PREFIX}Sem dupla baixa` })).error).toBeNull();
    expect(await quantity(nonLotMaterialId)).toBe(1);
    const movements = await service.from("movimentacoes_estoque").select("quantidade,tipo").eq("procedimento_id", target.procedureId).eq("material_id", nonLotMaterialId);
    expect(movements.error).toBeNull();
    expect((movements.data ?? []).filter((item) => item.tipo === "saida").reduce((sum, item) => sum + item.quantidade, 0)).toBe(4);
  });

  it("aplica RBAC, RLS, DML direto negado e concorrencia real por lote", async () => {
    const protectedService = await createService(controlledMaterialId, 1);
    const protectedTarget = await createProcedureWithSnapshot(dentistA, protectedService);
    expect((await consume(dentistB, protectedTarget.procedureId, controlledMaterialId, controlledLotA, protectedTarget.snapshotId, 1)).error).not.toBeNull();
    expect((await consume(reception, protectedTarget.procedureId, controlledMaterialId, controlledLotA, protectedTarget.snapshotId, 1)).error).not.toBeNull();
    expect((await consume(admin, protectedTarget.procedureId, controlledMaterialId, controlledLotA, protectedTarget.snapshotId, 1)).error).not.toBeNull();
    const inactiveSession = await login(inactive);
    const orphanSession = await login(orphan);
    expect((await consume(inactiveSession, protectedTarget.procedureId, controlledMaterialId, controlledLotA, protectedTarget.snapshotId, 1)).error).not.toBeNull();
    expect((await consume(orphanSession, protectedTarget.procedureId, controlledMaterialId, controlledLotA, protectedTarget.snapshotId, 1)).error).not.toBeNull();
    expect((await client().rpc("record_clinical_material_consumption", { p_procedimento_id: protectedTarget.procedureId, p_material_id: controlledMaterialId, p_lote_id: controlledLotA, p_quantidade: 1, p_procedimento_material_consumo_id: protectedTarget.snapshotId })).error).not.toBeNull();
    const ownerConsumption = await consume(dentistA, protectedTarget.procedureId, controlledMaterialId, controlledLotA, protectedTarget.snapshotId, 1);
    expect(ownerConsumption.error).toBeNull();
    expect((await dentistB.from("consumos_clinicos_materiais").select("id").eq("id", (ownerConsumption.data as Consumption).id)).data).toEqual([]);
    expect((await dentistA.from("consumos_clinicos_materiais").insert({ procedimento_id: protectedTarget.procedureId, material_id: controlledMaterialId, lote_id: controlledLotA, quantidade: 1, movimentacao_estoque_id: randomUUID(), movimentacao_lote_id: randomUUID(), created_by: adminId })).error).not.toBeNull();
    expect((await client().from("consumos_clinicos_materiais").insert({ procedimento_id: protectedTarget.procedureId, material_id: controlledMaterialId, lote_id: controlledLotA, quantidade: 1, movimentacao_estoque_id: randomUUID(), movimentacao_lote_id: randomUUID(), created_by: adminId })).error).not.toBeNull();

    const concurrentService = await createService(concurrentMaterialId, 1);
    const first = await createProcedureWithSnapshot(dentistA, concurrentService);
    const second = await createProcedureWithSnapshot(dentistB, concurrentService);
    const concurrentLot = (await service.from("materiais_lotes").select("id").eq("material_id", concurrentMaterialId).single()).data?.id as string;
    const [left, right] = await Promise.all([
      consume(dentistA, first.procedureId, concurrentMaterialId, concurrentLot, first.snapshotId, 1),
      consume(dentistB, second.procedureId, concurrentMaterialId, concurrentLot, second.snapshotId, 1),
    ]);
    expect([left, right].filter((result) => !result.error)).toHaveLength(1);
    expect([left, right].filter((result) => result.error)).toHaveLength(1);
    expect(await quantity(concurrentMaterialId)).toBe(0);
    const active = await service.from("consumos_clinicos_materiais").select("id", { count: "exact", head: true }).in("procedimento_id", [first.procedureId, second.procedureId]).is("estornado_em", null);
    expect(active.error).toBeNull();
    expect(active.count).toBe(1);
  });
});
