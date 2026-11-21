import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Client } from "pg";
import { createQaAdmin, createQaUser } from "./helpers";

type Identity = { id: string; email: string; password: string; role: "administrador" | "recepcao" | "dentista" };
const users: Identity[] = [];
const appointmentIds: string[] = [];
const returnIds: string[] = [];
const attendanceIds: string[] = [];
const patientIds: string[] = [];
let service: SupabaseClient, admin: SupabaseClient, reception: SupabaseClient, dentist: SupabaseClient;
let url: string, anon: string, adminId: string, patientId: string, otherPatientId: string, professionalId: string;
const dbUrl = process.env.SUPABASE_TEST_DB_URL ?? "";
const isLocal = (value: string) => { try { return ["localhost", "127.0.0.1", "[::1]"].includes(new URL(value).hostname); } catch { return false; } };
const localOnly = isLocal(process.env.SUPABASE_TEST_URL ?? "") && isLocal(dbUrl);

function localDateTime(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Cuiaba", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(date);
  const item = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${item.year}-${item.month}-${item.day}T${item.hour}:${item.minute}`;
}
function slot(index: number) {
  const start = new Date(Date.now() + (96 + index * 2) * 60 * 60 * 1000);
  return { start: localDateTime(start), end: localDateTime(new Date(start.getTime() + 60 * 60 * 1000)) };
}
function args(index: number, requestId = randomUUID(), returnId: string | null = null, patient = patientId) {
  const time = slot(index);
  return { p_request_id: requestId, p_retorno_id: returnId, p_paciente_id: patient, p_profissional_id: professionalId, p_inicio_local: time.start, p_fim_local: time.end, p_observacoes_administrativas: null };
}
async function createReturn() {
  const attendance = await dentist.rpc("create_direct_attendance", { p_paciente_id: patientId });
  expect(attendance.error).toBeNull();
  const attendanceId = (attendance.data as { id: string }).id;
  attendanceIds.push(attendanceId);
  const result = await dentist.rpc("create_return", { p_atendimento_id: attendanceId, p_data_prevista: slot(1).start.slice(0, 10), p_observacao_administrativa: null });
  expect(result.error).toBeNull();
  const returnId = (result.data as { id: string }).id;
  returnIds.push(returnId);
  return returnId;
}
async function countRequest(requestId: string) {
  const result = await service.from("agendamentos").select("id", { count: "exact", head: true }).eq("request_id", requestId);
  expect(result.error).toBeNull();
  return result.count;
}

describe.skipIf(!localOnly)("A1: criação atômica e repetível de consulta e retorno no laboratório local", () => {
  beforeAll(async () => {
    if (process.env.SUPABASE_TEST_ENVIRONMENT !== "local" || process.env.SUPABASE_TEST_HOMOLOGATION !== "I_ACKNOWLEDGE_FAKE_DATA_ONLY") {
      throw new Error("A1 exige laboratório Supabase local fictício.");
    }
    url = process.env.SUPABASE_TEST_URL ?? "";
    anon = process.env.SUPABASE_TEST_ANON_KEY ?? "";
    const hostname = new URL(url).hostname;
    if (!["localhost", "127.0.0.1", "::1"].includes(hostname)) throw new Error("A1 exige backend local isolado.");
    const serviceKey = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY;
    if (!anon || !serviceKey) throw new Error("Chaves do laboratório local ausentes.");
    service = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const qaAdmin = await createQaAdmin(service, url, anon);
    admin = qaAdmin.session;
    adminId = qaAdmin.identity.id;
    users.push(qaAdmin.identity);
    async function identity(role: "recepcao" | "dentista") {
      const candidate = { email: `qa_a1_${role}_${randomUUID()}@example.com`, password: `Tmp-${randomUUID()}-A9!`, role };
      const { data, error } = await createQaUser(service, { email: candidate.email, password: candidate.password, email_confirm: true, user_metadata: { nome: `QA_A1_${role}`, perfil: role, created_by: adminId } });
      if (error || !data.user) throw error ?? new Error("Ator fictício ausente.");
      const result = { ...candidate, id: data.user.id };
      users.push(result);
      const client = createClient(url, anon, { auth: { autoRefreshToken: false, persistSession: false } });
      expect((await client.auth.signInWithPassword(candidate)).error).toBeNull();
      return client;
    }
    reception = await identity("recepcao");
    dentist = await identity("dentista");
    const { data: professional, error: professionalError } = await service.from("profissionais").select("id").eq("usuario_id", users[2].id).single();
    expect(professionalError).toBeNull();
    professionalId = professional?.id ?? "";
    for (const name of ["Paciente A1 fictício", "Outro paciente A1 fictício"]) {
      const { data, error } = await reception.rpc("create_patient", { p_nome: `${name} ${randomUUID()}`, p_data_nascimento: "1990-01-15", p_telefone_contato: null, p_documento_identificacao: null, p_alergias: null, p_intolerancias: null, p_medicamentos_em_uso: null });
      expect(error).toBeNull();
      patientIds.push((data as { id: string }).id);
    }
    [patientId, otherPatientId] = patientIds;
  });

  afterAll(async () => {
    if (!service) return;
    const entityIds = [...appointmentIds, ...returnIds, ...attendanceIds, ...patientIds];
    if (entityIds.length) await service.from("auditoria").delete().in("entidade_id", entityIds);
    if (returnIds.length) await service.from("retornos").delete().in("id", returnIds);
    if (attendanceIds.length) await service.from("atendimentos").delete().in("id", attendanceIds);
    if (appointmentIds.length) await service.from("agendamentos").delete().in("id", appointmentIds);
    if (patientIds.length) {
      await service.from("paciente_alertas_clinicos").delete().in("paciente_id", patientIds);
      await service.from("pacientes").delete().in("id", patientIds);
    }
    if (users.length) await service.from("auditoria").delete().in("usuario_id", users.map((user) => user.id));
    for (const user of [...users].reverse()) {
      await service.from("profissionais").delete().eq("usuario_id", user.id);
      await service.from("usuarios").delete().eq("id", user.id);
      await service.auth.admin.deleteUser(user.id);
    }
  });

  it("cria consulta comum uma vez e reutiliza o resultado após resposta perdida", async () => {
    const input = args(1);
    const first = await reception.rpc("create_appointment_consistent", input);
    expect(first.error).toBeNull();
    const appointmentId = (first.data as { id: string }).id;
    appointmentIds.push(appointmentId);
    const retry = await reception.rpc("create_appointment_consistent", input);
    expect(retry.error).toBeNull();
    expect((retry.data as { id: string }).id).toBe(appointmentId);
    expect(await countRequest(input.p_request_id)).toBe(1);
    expect((await service.from("agendamentos").select("created_by").eq("id", appointmentId).single()).data?.created_by).toBe(users[1].id);
    const audit = await service.from("auditoria").select("id", { count: "exact", head: true }).eq("entidade_id", appointmentId).eq("evento", "agendamento_criado");
    expect(audit.count).toBe(1);
  });

  it("vincula retorno atomicamente, sem criar consulta quando o vínculo é inválido", async () => {
    const returnId = await createReturn();
    const invalid = args(2, randomUUID(), returnId, otherPatientId);
    const failed = await reception.rpc("create_appointment_consistent", invalid);
    expect(failed.error).not.toBeNull();
    expect(await countRequest(invalid.p_request_id)).toBe(0);
    const before = await reception.from("retornos").select("status,agendamento_id").eq("id", returnId).single();
    expect(before.data).toMatchObject({ status: "pendente", agendamento_id: null });
    const input = args(2, randomUUID(), returnId);
    const created = await reception.rpc("create_appointment_consistent", input);
    expect(created.error).toBeNull();
    const appointmentId = (created.data as { id: string }).id;
    appointmentIds.push(appointmentId);
    const linked = await reception.from("retornos").select("status,agendamento_id").eq("id", returnId).single();
    expect(linked.data).toMatchObject({ status: "agendado", agendamento_id: appointmentId });
    expect(await countRequest(input.p_request_id)).toBe(1);
    const repeat = await reception.rpc("create_appointment_consistent", input);
    expect(repeat.error).toBeNull();
    expect((repeat.data as { id: string }).id).toBe(appointmentId);
  });

  it("reverte agendamento e auditoria quando a associação falha depois do insert", async () => {
    const returnId = await createReturn();
    const triggerName = `qa_a1_fail_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    const sql = new Client({ connectionString: dbUrl });
    await sql.connect();
    try {
      const before = await sql.query("select count(*)::int as total from public.auditoria where evento='agendamento_criado' and dados->>'paciente_id'=$1", [patientId]);
      await sql.query(`create function public.${triggerName}() returns trigger language plpgsql as $$ begin if new.id = '${returnId}'::uuid and new.agendamento_id is not null then raise exception 'QA_A1_FORCED_LINK_FAILURE' using errcode='23514'; end if; return new; end; $$`);
      await sql.query(`create trigger ${triggerName} before update of agendamento_id on public.retornos for each row execute function public.${triggerName}()`);
      const input = args(11, randomUUID(), returnId);
      const failed = await reception.rpc("create_appointment_consistent", input);
      expect(failed.error).not.toBeNull();
      expect(await countRequest(input.p_request_id)).toBe(0);
      expect((await reception.from("retornos").select("status,agendamento_id").eq("id", returnId).single()).data).toMatchObject({ status: "pendente", agendamento_id: null });
      const after = await sql.query("select count(*)::int as total from public.auditoria where evento='agendamento_criado' and dados->>'paciente_id'=$1", [patientId]);
      expect(after.rows[0].total).toBe(before.rows[0].total);
    } finally {
      await sql.query(`drop trigger if exists ${triggerName} on public.retornos`);
      await sql.query(`drop function if exists public.${triggerName}()`);
      await sql.end();
    }
  });

  it("serializa duas tentativas com a mesma chave sem duplicar consulta", async () => {
    const returnId = await createReturn();
    const input = args(12, randomUUID(), returnId);
    const [first, second] = await Promise.all([
      reception.rpc("create_appointment_consistent", input),
      reception.rpc("create_appointment_consistent", input),
    ]);
    expect(first.error).toBeNull();
    expect(second.error).toBeNull();
    const id = (first.data as { id: string }).id;
    appointmentIds.push(id);
    expect((second.data as { id: string }).id).toBe(id);
    expect(await countRequest(input.p_request_id)).toBe(1);
  });

  it("serializa duas solicitações para o mesmo retorno e rejeita troca de vínculo", async () => {
    const returnId = await createReturn();
    const first = args(3, randomUUID(), returnId);
    const second = args(4, randomUUID(), returnId);
    const results = await Promise.all([admin.rpc("create_appointment_consistent", first), reception.rpc("create_appointment_consistent", second)]);
    expect(results.filter((result) => !result.error)).toHaveLength(1);
    expect(results.filter((result) => result.error)).toHaveLength(1);
    const appointmentId = (results.find((result) => !result.error)?.data as { id: string }).id;
    appointmentIds.push(appointmentId);
    expect((await reception.from("retornos").select("agendamento_id").eq("id", returnId).single()).data?.agendamento_id).toBe(appointmentId);
    expect((await reception.rpc("link_return_appointment", { p_retorno_id: returnId, p_agendamento_id: appointmentIds[0] })).error).not.toBeNull();
    expect((await reception.rpc("create_appointment_consistent", args(5, randomUUID(), returnId))).error).not.toBeNull();
  });

  it("mantém conflito, paciente/profissional e autorização no banco", async () => {
    const input = args(6);
    const created = await admin.rpc("create_appointment_consistent", input);
    expect(created.error).toBeNull();
    appointmentIds.push((created.data as { id: string }).id);
    const conflict = await reception.rpc("create_appointment_consistent", { ...input, p_request_id: randomUUID() });
    expect(conflict.error?.code).toBe("23P01");
    expect((await dentist.rpc("create_appointment_consistent", args(7))).error?.code).toBe("42501");
    expect((await reception.rpc("create_appointment_consistent", args(8, randomUUID(), null, randomUUID()))).error).not.toBeNull();
    expect((await reception.rpc("create_appointment_consistent", { ...args(9), p_profissional_id: randomUUID() })).error).not.toBeNull();
  });

  it("libera retorno ao cancelar e impede troca de paciente de consulta vinculada", async () => {
    const returnId = await createReturn();
    const input = args(10, randomUUID(), returnId);
    const created = await reception.rpc("create_appointment_consistent", input);
    expect(created.error).toBeNull();
    const appointmentId = (created.data as { id: string }).id;
    appointmentIds.push(appointmentId);
    const changed = await reception.rpc("update_appointment", { p_agendamento_id: appointmentId, p_paciente_id: otherPatientId, p_profissional_id: professionalId, p_inicio_local: input.p_inicio_local, p_fim_local: input.p_fim_local, p_observacoes_administrativas: null });
    expect(changed.error).not.toBeNull();
    expect((await reception.rpc("set_appointment_status", { p_agendamento_id: appointmentId, p_status: "cancelado" })).error).toBeNull();
    expect((await reception.from("retornos").select("status,agendamento_id").eq("id", returnId).single()).data).toMatchObject({ status: "pendente", agendamento_id: null });
    expect((await reception.rpc("link_return_appointment", { p_retorno_id: returnId, p_agendamento_id: appointmentId })).error).not.toBeNull();
  });

  it("não confirma retry após retorno concluído/cancelado e mantém o vínculo histórico", async () => {
    const returnId = await createReturn();
    const input = args(13, randomUUID(), returnId);
    const created = await reception.rpc("create_appointment_consistent", input);
    expect(created.error).toBeNull();
    const appointmentId = (created.data as { id: string }).id;
    appointmentIds.push(appointmentId);
    expect((await reception.rpc("set_return_status", { p_retorno_id: returnId, p_status: "cancelado", p_observacao_administrativa: null })).error).toBeNull();
    const retry = await reception.rpc("create_appointment_consistent", input);
    expect(retry.error?.message).toContain("RETURN_NOT_PENDING");
    expect(await countRequest(input.p_request_id)).toBe(1);
    expect((await reception.from("retornos").select("status,agendamento_id").eq("id", returnId).single()).data).toMatchObject({ status: "cancelado", agendamento_id: appointmentId });
    expect((await reception.rpc("update_appointment", { p_agendamento_id: appointmentId, p_paciente_id: otherPatientId, p_profissional_id: professionalId, p_inicio_local: input.p_inicio_local, p_fim_local: input.p_fim_local, p_observacoes_administrativas: null })).error).not.toBeNull();
  });

  it("preserva vínculo na remarcação e libera retorno após falta", async () => {
    const returnId = await createReturn();
    const start = localDateTime(new Date(Date.now() - 5 * 60 * 1000));
    const end = localDateTime(new Date(Date.now() + 25 * 60 * 1000));
    const input = { ...args(14, randomUUID(), returnId), p_inicio_local: start, p_fim_local: end };
    const created = await reception.rpc("create_appointment_consistent", input);
    expect(created.error).toBeNull();
    const appointmentId = (created.data as { id: string }).id;
    appointmentIds.push(appointmentId);
    const moved = slot(15);
    const rescheduled = await reception.rpc("update_appointment", { p_agendamento_id: appointmentId, p_paciente_id: patientId, p_profissional_id: professionalId, p_inicio_local: moved.start, p_fim_local: moved.end, p_observacoes_administrativas: null });
    expect(rescheduled.error).toBeNull();
    expect((await reception.from("retornos").select("status,agendamento_id").eq("id", returnId).single()).data).toMatchObject({ status: "agendado", agendamento_id: appointmentId });
    // A falta exige início já ocorrido: remarcação de volta ao intervalo atual é negada.
    // Usar outra consulta iniciada para exercitar a transição válida.
    const secondReturn = await createReturn();
    const secondInput = { ...args(16, randomUUID(), secondReturn), p_inicio_local: localDateTime(new Date(Date.now() - 4 * 60 * 1000)), p_fim_local: localDateTime(new Date(Date.now() + 26 * 60 * 1000)) };
    const second = await reception.rpc("create_appointment_consistent", secondInput);
    expect(second.error).toBeNull();
    const secondAppointmentId = (second.data as { id: string }).id;
    appointmentIds.push(secondAppointmentId);
    expect((await reception.rpc("set_appointment_status", { p_agendamento_id: secondAppointmentId, p_status: "faltou" })).error).toBeNull();
    expect((await reception.from("retornos").select("status,agendamento_id").eq("id", secondReturn).single()).data).toMatchObject({ status: "pendente", agendamento_id: null });
  });
});
