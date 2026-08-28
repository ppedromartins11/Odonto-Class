import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createQaAdmin } from "./helpers";

type Role = "administrador" | "dentista" | "recepcao";
type Identity = { id: string; email: string; password: string; role: Role };

const REQUIRED_MARKER = "I_ACKNOWLEDGE_FAKE_DATA_ONLY";
const users: Identity[] = [];
const patientIds: string[] = [];
const appointmentIds: string[] = [];
const attendanceIds: string[] = [];
const procedureIds: string[] = [];

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} nao configurada em .env.test.local.`);
  return value;
}

function userClient(url: string, anonKey: string) {
  return createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
}

function localDateTime(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Cuiaba",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const item = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${item.year}-${item.month}-${item.day}T${item.hour}:${item.minute}`;
}

describe("bloco clinico: agenda, atendimento, procedimentos e autorizacao", () => {
  let url: string;
  let anonKey: string;
  let service: SupabaseClient;
  let admin: SupabaseClient;
  let reception: SupabaseClient;
  let dentistA: SupabaseClient;
  let dentistB: SupabaseClient;
  let adminId: string;
  let receptionIdentity: Identity;
  let dentistAIdentity: Identity;
  let dentistBIdentity: Identity;
  let inactiveIdentity: Identity;
  let orphanIdentity: Identity;
  let professionalA: string;
  let professionalB: string;
  let patientId: string;
  let appointmentId: string;
  let attendanceId: string;
  let futureStart: string;
  let futureEnd: string;

  async function createIdentity(role: Role) {
    const suffix = randomUUID();
    const identity = {
      email: `qa_rc_clinical-${role}-${suffix}@example.com`,
      password: `Tmp-${randomUUID()}-A9!`,
      role,
    };
    const { data, error } = await service.auth.admin.createUser({
      email: identity.email,
      password: identity.password,
      email_confirm: true,
      user_metadata: { nome: `QA_RC_Usuario_clinico_${suffix}`, perfil: role, created_by: adminId },
    });
    if (error || !data.user) throw new Error(`Falha ao criar identidade: ${error?.code}`);
    const result = { ...identity, id: data.user.id };
    users.push(result);
    return result;
  }

  async function signedIn(identity: Pick<Identity, "email" | "password">) {
    const client = userClient(url, anonKey);
    const { error } = await client.auth.signInWithPassword(identity);
    expect(error).toBeNull();
    return client;
  }

  beforeAll(async () => {
    if (process.env.SUPABASE_TEST_HOMOLOGATION !== REQUIRED_MARKER) {
      throw new Error("Homologacao ficticia nao confirmada em .env.test.local.");
    }
    url = requiredEnv("SUPABASE_TEST_URL");
    anonKey = requiredEnv("SUPABASE_TEST_ANON_KEY");
    service = createClient(url, requiredEnv("SUPABASE_TEST_SERVICE_ROLE_KEY"), {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const qaAdmin = await createQaAdmin(service, url, anonKey);
    admin = qaAdmin.session;
    adminId = qaAdmin.identity.id;
    users.push(qaAdmin.identity);

    receptionIdentity = await createIdentity("recepcao");
    dentistAIdentity = await createIdentity("dentista");
    dentistBIdentity = await createIdentity("dentista");
    inactiveIdentity = await createIdentity("recepcao");
    orphanIdentity = await createIdentity("recepcao");
    reception = await signedIn(receptionIdentity);
    dentistA = await signedIn(dentistAIdentity);
    dentistB = await signedIn(dentistBIdentity);

    const { error: inactiveError } = await admin.rpc("update_user_access", {
      p_usuario_id: inactiveIdentity.id,
      p_perfil: null,
      p_status: "inativo",
    });
    if (inactiveError) throw inactiveError;
    const { error: orphanError } = await service.from("usuarios").delete().eq("id", orphanIdentity.id);
    if (orphanError) throw orphanError;

    const { data: professionals, error: professionalError } = await service
      .from("profissionais")
      .select("id, usuario_id")
      .in("usuario_id", [dentistAIdentity.id, dentistBIdentity.id]);
    if (professionalError) throw professionalError;
    professionalA = professionals?.find((item) => item.usuario_id === dentistAIdentity.id)?.id ?? "";
    professionalB = professionals?.find((item) => item.usuario_id === dentistBIdentity.id)?.id ?? "";
    if (!professionalA || !professionalB) throw new Error("Vinculos profissionais ficticios ausentes.");

    const { data: patient, error: patientError } = await reception.rpc("create_patient", {
      p_nome: `QA_RC_Paciente_clinico_${randomUUID()}`,
      p_data_nascimento: "1990-01-15",
      p_telefone_contato: "+00 00000-0000",
      p_documento_identificacao: null,
      p_alergias: null,
      p_intolerancias: null,
      p_medicamentos_em_uso: null,
    });
    if (patientError || !patient) throw patientError ?? new Error("Paciente nao criado.");
    patientId = (patient as { id: string }).id;
    patientIds.push(patientId);

    const base = new Date(Date.now() + 48 * 60 * 60 * 1000);
    futureStart = localDateTime(base);
    futureEnd = localDateTime(new Date(base.getTime() + 60 * 60 * 1000));
  });

  afterAll(async () => {
    if (!service) return;
    const entityIds = [...appointmentIds, ...attendanceIds, ...procedureIds, ...patientIds, ...users.map((user) => user.id)];
    if (entityIds.length) await service.from("auditoria").delete().in("entidade_id", entityIds);
    if (users.length) await service.from("auditoria").delete().in("usuario_id", users.map((user) => user.id));
    if (procedureIds.length) await service.from("procedimentos").delete().in("id", procedureIds);
    if (attendanceIds.length) await service.from("atendimentos").delete().in("id", attendanceIds);
    if (appointmentIds.length) await service.from("agendamentos").delete().in("id", appointmentIds);
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

  it("recepcao cria e administrador visualiza agenda; dentista ve somente a propria", async () => {
    const { data, error } = await reception.rpc("create_appointment", {
      p_paciente_id: patientId,
      p_profissional_id: professionalA,
      p_inicio_local: futureStart,
      p_fim_local: futureEnd,
      p_observacoes_administrativas: "QA_RC_Observacao_operacional",
    });
    expect(error).toBeNull();
    appointmentId = (data as { id: string }).id;
    appointmentIds.push(appointmentId);

    const startDate = futureStart.slice(0, 10);
    const end = new Date(`${startDate}T00:00:00Z`);
    end.setUTCDate(end.getUTCDate() + 1);
    for (const client of [admin, reception, dentistA]) {
      const { data: agenda, error: agendaError } = await client.rpc("list_agenda", {
        p_data_inicio: startDate,
        p_data_fim: end.toISOString().slice(0, 10),
        p_profissional_id: null,
      });
      expect(agendaError).toBeNull();
      expect((agenda as Array<{ id: string }>).some((item) => item.id === appointmentId)).toBe(true);
    }
    const { data: otherAgenda } = await dentistB.from("agendamentos").select("id").eq("id", appointmentId);
    expect(otherAgenda).toEqual([]);
    const { error: dentistCreateError } = await dentistA.rpc("create_appointment", {
      p_paciente_id: patientId,
      p_profissional_id: professionalA,
      p_inicio_local: futureStart,
      p_fim_local: futureEnd,
      p_observacoes_administrativas: null,
    });
    expect(dentistCreateError).not.toBeNull();
  });

  it("bloqueia conflito no banco inclusive contra chamadas concorrentes", async () => {
    const overlappingStart = localDateTime(new Date(Date.now() + 96 * 60 * 60 * 1000));
    const overlappingEnd = localDateTime(new Date(Date.now() + 97 * 60 * 60 * 1000));
    const [first, second] = await Promise.all([
      admin.rpc("create_appointment", {
        p_paciente_id: patientId,
        p_profissional_id: professionalB,
        p_inicio_local: overlappingStart,
        p_fim_local: overlappingEnd,
        p_observacoes_administrativas: null,
      }),
      reception.rpc("create_appointment", {
        p_paciente_id: patientId,
        p_profissional_id: professionalB,
        p_inicio_local: overlappingStart,
        p_fim_local: overlappingEnd,
        p_observacoes_administrativas: null,
      }),
    ]);
    const successes = [first, second].filter((result) => !result.error);
    const failures = [first, second].filter((result) => result.error);
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    appointmentIds.push((successes[0].data as { id: string }).id);
  });

  it("confirma e remarca, voltando para agendado", async () => {
    const { error: confirmError } = await reception.rpc("set_appointment_status", {
      p_agendamento_id: appointmentId,
      p_status: "confirmado",
    });
    expect(confirmError).toBeNull();
    const movedStart = localDateTime(new Date(new Date(`${futureStart}:00-04:00`).getTime() + 2 * 60 * 60 * 1000));
    const movedEnd = localDateTime(new Date(new Date(`${futureEnd}:00-04:00`).getTime() + 2 * 60 * 60 * 1000));
    const { data, error } = await admin.rpc("update_appointment", {
      p_agendamento_id: appointmentId,
      p_paciente_id: patientId,
      p_profissional_id: professionalA,
      p_inicio_local: movedStart,
      p_fim_local: movedEnd,
      p_observacoes_administrativas: "QA_RC_Remarcado",
    });
    expect(error).toBeNull();
    expect((data as { status: string }).status).toBe("agendado");
  });

  it("registra cancelamento e falta com estados terminais preservados", async () => {
    const start = localDateTime(new Date(Date.now() + 72 * 60 * 60 * 1000));
    const end = localDateTime(new Date(Date.now() + 73 * 60 * 60 * 1000));
    const { data: cancelAppointment } = await admin.rpc("create_appointment", {
      p_paciente_id: patientId, p_profissional_id: professionalB,
      p_inicio_local: start, p_fim_local: end, p_observacoes_administrativas: null,
    });
    const cancelId = (cancelAppointment as { id: string }).id;
    appointmentIds.push(cancelId);
    expect((await reception.rpc("set_appointment_status", { p_agendamento_id: cancelId, p_status: "cancelado" })).error).toBeNull();

    const missStart = localDateTime(new Date(Date.now() - 5 * 60 * 1000));
    const missEnd = localDateTime(new Date(Date.now() + 25 * 60 * 1000));
    const { data: missAppointment, error: missCreateError } = await admin.rpc("create_appointment", {
      p_paciente_id: patientId, p_profissional_id: professionalB,
      p_inicio_local: missStart, p_fim_local: missEnd, p_observacoes_administrativas: null,
    });
    expect(missCreateError).toBeNull();
    const missId = (missAppointment as { id: string }).id;
    appointmentIds.push(missId);
    expect((await reception.rpc("set_appointment_status", { p_agendamento_id: missId, p_status: "faltou" })).error).toBeNull();
  });

  it("dentista responsavel inicia, evolui, registra procedimentos e finaliza atomicamente", async () => {
    const { data: started, error: startError } = await dentistA.rpc("start_attendance", { p_agendamento_id: appointmentId });
    expect(startError).toBeNull();
    attendanceId = (started as { id: string }).id;
    attendanceIds.push(attendanceId);

    for (const client of [admin, reception, dentistB]) {
      const { data, error } = await client.from("atendimentos").select("id, evolucao").eq("id", attendanceId);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    }
    expect((await dentistB.rpc("update_attendance", { p_atendimento_id: attendanceId, p_evolucao: "QA_RC_negado" })).error).not.toBeNull();

    const evolution = "QA_RC_Evolucao_clinica_confidencial";
    expect((await dentistA.rpc("update_attendance", { p_atendimento_id: attendanceId, p_evolucao: evolution })).error).toBeNull();
    const procedures = [
      { p_atendimento_id: attendanceId, p_descricao: "QA_RC_Profilaxia", p_dente: null, p_material_utilizado: null, p_cor_resina: null, p_detalhes: null },
      { p_atendimento_id: attendanceId, p_descricao: "QA_RC_Restauracao", p_dente: "11", p_material_utilizado: "QA_RC_Resina", p_cor_resina: "A2", p_detalhes: "QA_RC_Detalhe_clinico" },
    ];
    for (const payload of procedures) {
      const { data, error } = await dentistA.rpc("create_procedure", payload);
      expect(error).toBeNull();
      procedureIds.push((data as { id: string }).id);
    }
    expect((await dentistA.rpc("finalize_attendance", { p_atendimento_id: attendanceId, p_evolucao: evolution })).error).toBeNull();
    const { data: appointment } = await dentistA.from("agendamentos").select("status").eq("id", appointmentId).single();
    expect(appointment?.status).toBe("atendido");
    expect((await dentistA.rpc("update_attendance", { p_atendimento_id: attendanceId, p_evolucao: "QA_RC_alteracao_tardia" })).error).not.toBeNull();
  });

  it("permite atendimento direto e isola o registro entre dentistas", async () => {
    const { data, error } = await dentistB.rpc("create_direct_attendance", { p_paciente_id: patientId });
    expect(error).toBeNull();
    const directId = (data as { id: string }).id;
    attendanceIds.push(directId);
    const { data: visibleToOwner } = await dentistB.from("atendimentos").select("id").eq("id", directId);
    expect(visibleToOwner).toHaveLength(1);
    const { data: hiddenFromOther } = await dentistA.from("atendimentos").select("id, evolucao").eq("id", directId);
    expect(hiddenFromOther).toEqual([]);
  });

  it("nega escrita direta, DELETE, usuario inativo e usuario sem perfil", async () => {
    expect((await reception.from("agendamentos").update({ status: "confirmado" }).eq("id", appointmentId)).error).not.toBeNull();
    expect((await admin.from("agendamentos").delete().eq("id", appointmentId)).error).not.toBeNull();
    expect((await dentistA.from("atendimentos").delete().eq("id", attendanceId)).error).not.toBeNull();
    expect((await dentistA.from("procedimentos").delete().in("id", procedureIds)).error).not.toBeNull();
    for (const identity of [inactiveIdentity, orphanIdentity]) {
      const client = await signedIn(identity);
      const { data } = await client.from("agendamentos").select("id");
      expect(data).toEqual([]);
      const nextDate = new Date(`${futureStart.slice(0, 10)}T00:00:00Z`);
      nextDate.setUTCDate(nextDate.getUTCDate() + 1);
      expect((await client.rpc("list_agenda", { p_data_inicio: futureStart.slice(0, 10), p_data_fim: nextDate.toISOString().slice(0, 10), p_profissional_id: null })).error).not.toBeNull();
    }
  });

  it("audita operacao sem copiar evolucao ou detalhes clinicos", async () => {
    const ids = [...appointmentIds, ...attendanceIds, ...procedureIds];
    const { data, error } = await admin.from("auditoria").select("evento, dados").in("entidade_id", ids);
    expect(error).toBeNull();
    const events = new Set(data?.map((item) => item.evento));
    expect(events.has("agendamento_criado")).toBe(true);
    expect(events.has("agendamento_remarcado")).toBe(true);
    expect(events.has("atendimento_finalizado")).toBe(true);
    expect(events.has("procedimento_criado")).toBe(true);
    const serialized = JSON.stringify(data);
    expect(serialized).not.toContain("QA_RC_Evolucao_clinica_confidencial");
    expect(serialized).not.toContain("QA_RC_Resina");
    expect(serialized).not.toContain("QA_RC_Detalhe_clinico");
  });
});
