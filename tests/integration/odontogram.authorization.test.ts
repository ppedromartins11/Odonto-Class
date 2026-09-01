import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createQaAdmin } from "./helpers";

const ACK = "I_ACKNOWLEDGE_FAKE_DATA_ONLY";
const PREFIX = "QA_ODO_";
type Role = "administrador" | "dentista" | "recepcao";
type Identity = { id: string; email: string; password: string; role: Role };

let service: SupabaseClient;
let admin: SupabaseClient;
let reception: SupabaseClient;
let dentistA: SupabaseClient;
let dentistB: SupabaseClient;
let inactiveDentist: SupabaseClient;
let profileless: SupabaseClient;
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

function anonymousClient() {
  return createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function login(identity: Pick<Identity, "email" | "password">) {
  const session = anonymousClient();
  expect((await session.auth.signInWithPassword(identity)).error).toBeNull();
  return session;
}

async function createIdentity(role: Role) {
  const suffix = randomUUID();
  const candidate = { email: `qa_odo_${role}_${suffix}@example.com`, password: `Tmp-${randomUUID()}-A9!`, role };
  const { data, error } = await service.auth.admin.createUser({
    email: candidate.email,
    password: candidate.password,
    email_confirm: true,
    user_metadata: { nome: `${PREFIX}${role}_${suffix}`, perfil: role, created_by: adminId },
  });
  if (error || !data.user) throw error ?? new Error("Usuario QA_ODO ausente.");
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
  if (error || !data) throw error ?? new Error("Paciente QA_ODO ausente.");
  const id = (data as { id: string }).id;
  patientIds.push(id);
  return id;
}

async function createAttendance(dentist: SupabaseClient) {
  const { data, error } = await dentist.rpc("create_direct_attendance", { p_paciente_id: await createPatient() });
  if (error || !data) throw error ?? new Error("Atendimento QA_ODO ausente.");
  const id = (data as { id: string }).id;
  attendanceIds.push(id);
  return id;
}

async function createManualProcedure(dentist: SupabaseClient, attendanceId: string) {
  const { data, error } = await dentist.rpc("create_procedure", {
    p_atendimento_id: attendanceId,
    p_descricao: `${PREFIX}Procedimento_${randomUUID()}`,
    p_dente: "Regiao legada preservada",
    p_material_utilizado: null,
    p_cor_resina: null,
    p_detalhes: null,
  });
  if (error || !data) throw error ?? new Error("Procedimento QA_ODO ausente.");
  const id = (data as { id: string }).id;
  procedureIds.push(id);
  return id;
}

async function setTeeth(client: SupabaseClient, procedureId: string, teeth: number[]) {
  return client.rpc("set_procedure_teeth", { p_procedimento_id: procedureId, p_dentes: teeth });
}

async function visibleTeeth(client: SupabaseClient, procedureId: string) {
  const result = await client.from("procedimento_dentes").select("dente_fdi").eq("procedimento_id", procedureId).order("dente_fdi");
  return { ...result, teeth: (result.data ?? []).map((row) => row.dente_fdi) };
}

describe("Sprint 14: odontograma FDI, RLS e imutabilidade", () => {
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
    const inactiveIdentity = await createIdentity("dentista");
    const profilelessIdentity = await createIdentity("recepcao");
    reception = await login(receptionIdentity);
    dentistA = await login(dentistAIdentity);
    dentistB = await login(dentistBIdentity);
    inactiveDentist = await login(inactiveIdentity);
    profileless = await login(profilelessIdentity);
    expect((await admin.rpc("update_user_access", { p_usuario_id: inactiveIdentity.id, p_perfil: null, p_status: "inativo" })).error).toBeNull();
    expect((await service.from("usuarios").delete().eq("id", profilelessIdentity.id)).error).toBeNull();
  });

  afterAll(async () => {
    if (!service) return;
    const userIds = users.map((item) => item.id);
    if (materialIds.length) await service.from("movimentacoes_estoque").delete().in("material_id", materialIds);
    if (procedureIds.length) await service.from("procedimento_dentes").delete().in("procedimento_id", procedureIds);
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

  it("associa, deduplica, substitui e remove dentes do procedimento proprio", async () => {
    const procedureId = await createManualProcedure(dentistA, await createAttendance(dentistA));
    expect((await setTeeth(dentistA, procedureId, [16])).error).toBeNull();
    expect((await visibleTeeth(dentistA, procedureId)).teeth).toEqual([16]);
    const multiple = await setTeeth(dentistA, procedureId, [18, 16, 16, 17]);
    expect(multiple.error).toBeNull();
    expect(multiple.data).toEqual([16, 17, 18]);
    expect((await visibleTeeth(dentistA, procedureId)).teeth).toEqual([16, 17, 18]);
    expect((await setTeeth(dentistA, procedureId, [26, 27])).error).toBeNull();
    expect((await visibleTeeth(dentistA, procedureId)).teeth).toEqual([26, 27]);
    expect((await service.from("procedimentos").select("dente").eq("id", procedureId).single()).data?.dente).toBe("Regiao legada preservada");
    expect((await setTeeth(dentistA, procedureId, [])).error).toBeNull();
    expect((await visibleTeeth(dentistA, procedureId)).teeth).toEqual([]);
  });

  it("confirma colunas, FKs, CHECK FDI e UNIQUE no schema remoto", async () => {
    const procedureId = await createManualProcedure(dentistA, await createAttendance(dentistA));
    expect((await setTeeth(dentistA, procedureId, [16])).error).toBeNull();
    const row = await service.from("procedimento_dentes").select("id,procedimento_id,dente_fdi,created_at,created_by").eq("procedimento_id", procedureId).single();
    expect(row.error).toBeNull();
    expect(row.data).toMatchObject({ procedimento_id: procedureId, dente_fdi: 16 });
    expect(typeof row.data?.id).toBe("string");
    expect(typeof row.data?.created_at).toBe("string");
    expect(typeof row.data?.created_by).toBe("string");
    expect((await service.from("procedimento_dentes").insert({ procedimento_id: randomUUID(), dente_fdi: 17, created_by: adminId })).error).not.toBeNull();
    expect((await service.from("procedimento_dentes").insert({ procedimento_id: procedureId, dente_fdi: 17, created_by: randomUUID() })).error).not.toBeNull();
    expect((await service.from("procedimento_dentes").insert({ procedimento_id: procedureId, dente_fdi: 99, created_by: adminId })).error).not.toBeNull();
    expect((await service.from("procedimento_dentes").insert({ procedimento_id: procedureId, dente_fdi: 16, created_by: adminId })).error).not.toBeNull();
    expect((await visibleTeeth(dentistA, procedureId)).teeth).toEqual([16]);
  });

  it("rejeita integralmente todos os codigos FDI invalidos", async () => {
    const procedureId = await createManualProcedure(dentistA, await createAttendance(dentistA));
    expect((await setTeeth(dentistA, procedureId, [16, 17])).error).toBeNull();
    for (const invalid of [10, 19, 20, 29, 30, 39, 40, 49, 99]) {
      expect((await setTeeth(dentistA, procedureId, [16, invalid])).error).not.toBeNull();
      expect((await visibleTeeth(dentistA, procedureId)).teeth).toEqual([16, 17]);
    }
  });

  it("isola outro dentista, recepcao, admin puro, inativo e sem perfil", async () => {
    const procedureId = await createManualProcedure(dentistA, await createAttendance(dentistA));
    expect((await setTeeth(dentistA, procedureId, [11, 12])).error).toBeNull();
    for (const unauthorized of [dentistB, reception, admin, inactiveDentist, profileless]) {
      const read = await visibleTeeth(unauthorized, procedureId);
      expect(read.error).toBeNull();
      expect(read.teeth).toEqual([]);
      expect((await setTeeth(unauthorized, procedureId, [18])).error).not.toBeNull();
    }
    expect((await visibleTeeth(dentistA, procedureId)).teeth).toEqual([11, 12]);
  });

  it("nega INSERT, UPDATE e DELETE diretos para authenticated", async () => {
    const procedureId = await createManualProcedure(dentistA, await createAttendance(dentistA));
    expect((await dentistA.from("procedimento_dentes").insert({ procedimento_id: procedureId, dente_fdi: 16, created_by: adminId })).error).not.toBeNull();
    expect((await setTeeth(dentistA, procedureId, [16])).error).toBeNull();
    expect((await dentistA.from("procedimento_dentes").update({ dente_fdi: 17 }).eq("procedimento_id", procedureId)).error).not.toBeNull();
    expect((await dentistA.from("procedimento_dentes").delete().eq("procedimento_id", procedureId)).error).not.toBeNull();
  });

  it("preserva o procedimento quando o vinculo falha e permite retry somente dos dentes", async () => {
    const procedureId = await createManualProcedure(dentistA, await createAttendance(dentistA));
    expect((await setTeeth(dentistB, procedureId, [16, 17])).error).not.toBeNull();
    expect((await service.from("procedimentos").select("id").eq("id", procedureId).single()).data?.id).toBe(procedureId);
    expect((await service.from("procedimento_dentes").select("id").eq("procedimento_id", procedureId)).data).toEqual([]);
    expect((await setTeeth(dentistA, procedureId, [16, 17])).error).toBeNull();
    expect((await visibleTeeth(dentistA, procedureId)).teeth).toEqual([16, 17]);
  });

  it("torna 16 e 17 imutaveis ao finalizar e nega substituicao por 18", async () => {
    const attendanceId = await createAttendance(dentistA);
    const procedureId = await createManualProcedure(dentistA, attendanceId);
    expect((await setTeeth(dentistA, procedureId, [16, 17])).error).toBeNull();
    expect((await dentistA.rpc("finalize_attendance", { p_atendimento_id: attendanceId, p_evolucao: `${PREFIX}Imutabilidade` })).error).toBeNull();
    expect((await setTeeth(dentistA, procedureId, [18])).error).not.toBeNull();
    expect((await visibleTeeth(dentistA, procedureId)).teeth).toEqual([16, 17]);
  });

  it("preserva dentes apos finalizacao e nao multiplica valor, quantidade ou estoque", async () => {
    const material = await admin.rpc("create_stock_material", {
      p_nome: `${PREFIX}Material_${randomUUID()}`,
      p_categoria: "QA_ODO",
      p_unidade: "unidade",
      p_quantidade_inicial: 10,
      p_estoque_minimo: 0,
      p_validade: null,
      p_fornecedor: null,
      p_ativo: true,
    });
    expect(material.error).toBeNull();
    const materialId = (material.data as { id: string }).id;
    materialIds.push(materialId);
    const catalog = await admin.rpc("create_service", { p_nome: `${PREFIX}Servico_${randomUUID()}`, p_descricao: null, p_categoria: "QA_ODO", p_valor_padrao_centavos: 2500 });
    expect(catalog.error).toBeNull();
    const serviceId = (catalog.data as { id: string }).id;
    serviceIds.push(serviceId);
    expect((await admin.rpc("configure_service_material", { p_servico_id: serviceId, p_material_id: materialId, p_quantidade_padrao: 2, p_ativo: true })).error).toBeNull();
    const attendanceId = await createAttendance(dentistA);
    const created = await dentistA.rpc("create_service_procedure", { p_atendimento_id: attendanceId, p_servico_id: serviceId, p_quantidade: 1, p_valor_aplicado_centavos: 2500, p_detalhes: null });
    expect(created.error).toBeNull();
    const procedureId = (created.data as { id: string }).id;
    procedureIds.push(procedureId);
    expect((await setTeeth(dentistA, procedureId, [16, 17, 18])).error).toBeNull();
    expect((await dentistA.rpc("update_service_procedure", { p_procedimento_id: procedureId, p_quantidade: 1, p_valor_aplicado_centavos: 2600, p_detalhes: `${PREFIX}Detalhes editados` })).error).toBeNull();
    const snapshot = await service.from("procedimento_materiais_consumo").select("quantidade_total").eq("procedimento_id", procedureId).single();
    expect(snapshot.data?.quantidade_total).toBe(2);
    const procedure = await service.from("procedimentos").select("quantidade,valor_aplicado_centavos,dente,detalhes").eq("id", procedureId).single();
    expect(procedure.data).toMatchObject({ quantidade: 1, valor_aplicado_centavos: 2600, dente: null, detalhes: `${PREFIX}Detalhes editados` });
    expect((await dentistA.rpc("finalize_attendance", { p_atendimento_id: attendanceId, p_evolucao: `${PREFIX}Evolucao` })).error).toBeNull();
    expect((await service.from("materiais_estoque").select("quantidade_atual").eq("id", materialId).single()).data?.quantidade_atual).toBe(8);
    expect((await setTeeth(dentistA, procedureId, [18])).error).not.toBeNull();
    expect((await visibleTeeth(dentistA, procedureId)).teeth).toEqual([16, 17, 18]);
    const audits = await service.from("auditoria").select("dados").eq("evento", "procedimento_dentes_atualizados").eq("entidade_id", procedureId);
    expect(audits.error).toBeNull();
    expect(audits.data?.every((row) => Object.keys(row.dados as object).sort().join(",") === "atendimento_id,procedimento_id,quantidade_dentes")).toBe(true);
  });
});
