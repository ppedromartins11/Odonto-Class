import { createServiceClient, authenticateActor } from "./lib/auth.mjs";
import { newRunState, recordFixture } from "./fixtures.mjs";
import { createRunId } from "./lib/safe.mjs";
import { saveRunState } from "./lib/state.mjs";

function check(result, label) {
  if (result.error) throw new Error(`H02_SETUP_FAILED:${label}`, { cause: result.error });
  return result.data;
}

function localDateTime(date) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Cuiaba", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`;
}

function deniedWithExpectedDatabaseReason(error) {
  return !!error && (error.code === "23514" || error.code === "42501")
    && /ATTENDANCE_ALREADY_STARTED|atendimento iniciado|Acesso.*negado/i.test(error.message ?? "");
}

export async function runH02(env = process.env) {
  const runId = createRunId();
  const state = newRunState(runId);
  await saveRunState(state);
  const dentistA = await authenticateActor("dentistA", env);
  const dentistB = await authenticateActor("dentistB", env);
  const reception = await authenticateActor("reception", env);
  const [userAResult, userBResult, receptionUserResult] = await Promise.all([dentistA.client.auth.getUser(), dentistB.client.auth.getUser(), reception.client.auth.getUser()]);
  if (userAResult.error || userBResult.error || receptionUserResult.error || !userAResult.data.user || !userBResult.data.user || !receptionUserResult.data.user) throw new Error("H02_SETUP_FAILED:authenticated_identity");
  const service = createServiceClient(env);
  const professionalResult = await service.from("profissionais").select("id,usuario_id,status").in("usuario_id", [userAResult.data.user.id, userBResult.data.user.id]);
  const professionals = check(professionalResult, "professional_lookup") ?? [];
  const profA = professionals.find((row) => row.usuario_id === userAResult.data.user.id);
  const profB = professionals.find((row) => row.usuario_id === userBResult.data.user.id);
  if (!profA?.id || profA.status !== "ativo" || !profB?.id || profB.status !== "ativo") throw new Error("ACTION_REQUIRED: active professional profiles are required for both dentists.");

  const patientArgs = (name) => ({ p_nome: `${state.tag}_${name}`, p_data_nascimento: null, p_telefone_contato: null, p_documento_identificacao: null, p_alergias: null, p_intolerancias: null, p_medicamentos_em_uso: null });
  const patientA = check(await reception.client.rpc("create_patient", patientArgs("P1")), "patient_p1");
  await recordFixture(state, "patient", patientA.id, receptionUserResult.data.user.id);
  const patientB = check(await reception.client.rpc("create_patient", patientArgs("P2")), "patient_p2");
  await recordFixture(state, "patient", patientB.id, receptionUserResult.data.user.id);

  const start = localDateTime(new Date(Date.now() + 72 * 60 * 60 * 1000));
  const end = localDateTime(new Date(Date.now() + 73 * 60 * 60 * 1000));
  const appointment = check(await reception.client.rpc("create_appointment", {
    p_paciente_id: patientA.id, p_profissional_id: profA.id, p_inicio_local: start, p_fim_local: end,
    p_observacoes_administrativas: `${state.tag}_H02_APPOINTMENT`,
  }), "appointment_create");
  await recordFixture(state, "appointment", appointment.id, receptionUserResult.data.user.id);

  const beforeAtoB = await reception.client.rpc("update_appointment", { p_agendamento_id: appointment.id, p_paciente_id: patientA.id, p_profissional_id: profB.id, p_inicio_local: start, p_fim_local: end, p_observacoes_administrativas: `${state.tag}_PRESTART_B` });
  const reassignPro = !beforeAtoB.error && beforeAtoB.data?.profissional_id === profB.id;
  const beforeP1toP2 = await reception.client.rpc("update_appointment", { p_agendamento_id: appointment.id, p_paciente_id: patientB.id, p_profissional_id: profB.id, p_inicio_local: start, p_fim_local: end, p_observacoes_administrativas: `${state.tag}_PRESTART_P2` });
  const reassignPatient = !beforeP1toP2.error && beforeP1toP2.data?.paciente_id === patientB.id;
  const restore = await reception.client.rpc("update_appointment", { p_agendamento_id: appointment.id, p_paciente_id: patientA.id, p_profissional_id: profA.id, p_inicio_local: start, p_fim_local: end, p_observacoes_administrativas: `${state.tag}_H02_APPOINTMENT` });
  if (restore.error || restore.data?.paciente_id !== patientA.id || restore.data?.profissional_id !== profA.id) throw new Error("H02_SETUP_FAILED:restore_before_attendance");

  const attendance = check(await dentistA.client.rpc("start_attendance", { p_agendamento_id: appointment.id }), "attendance_start");
  await recordFixture(state, "attendance", attendance.id, userAResult.data.user.id);
  check(await dentistA.client.rpc("update_attendance", { p_atendimento_id: attendance.id, p_evolucao: `${state.tag}_synthetic_evolution_only` }), "synthetic_evolution");

  const afterAtoB = await reception.client.rpc("update_appointment", { p_agendamento_id: appointment.id, p_paciente_id: patientA.id, p_profissional_id: profB.id, p_inicio_local: start, p_fim_local: end, p_observacoes_administrativas: `${state.tag}_FORBIDDEN_A_TO_B` });
  const afterP1toP2 = await reception.client.rpc("update_appointment", { p_agendamento_id: appointment.id, p_paciente_id: patientB.id, p_profissional_id: profA.id, p_inicio_local: start, p_fim_local: end, p_observacoes_administrativas: `${state.tag}_FORBIDDEN_P1_TO_P2` });
  const bStart = await dentistB.client.rpc("start_attendance", { p_agendamento_id: appointment.id });
  const bEdit = await dentistB.client.rpc("update_attendance", { p_atendimento_id: attendance.id, p_evolucao: `${state.tag}_forbidden_edit` });

  const [appointmentCheck, attendanceCheck, duplicateCheck, mismatchCheck] = await Promise.all([
    service.from("agendamentos").select("id,paciente_id,profissional_id,observacoes_administrativas").eq("id", appointment.id).maybeSingle(),
    service.from("atendimentos").select("id,agendamento_id,paciente_id,profissional_id,evolucao").eq("id", attendance.id).maybeSingle(),
    service.from("atendimentos").select("id", { count: "exact", head: true }).eq("agendamento_id", appointment.id),
    service.from("atendimentos").select("id", { count: "exact", head: true }).eq("agendamento_id", appointment.id).or(`paciente_id.neq.${patientA.id},profissional_id.neq.${profA.id}`),
  ]);
  const ag = check(appointmentCheck, "appointment_integrity");
  const at = check(attendanceCheck, "attendance_integrity");
  const duplicateCount = duplicateCheck.count;
  const mismatchCount = mismatchCheck.count;
  const preStartPass = reassignPro && reassignPatient;
  const dentistBDenied = !!bStart.error && !!bEdit.error;
  const integrityPass = ag?.paciente_id === patientA.id && ag?.profissional_id === profA.id
    && ag?.observacoes_administrativas === `${state.tag}_H02_APPOINTMENT`
    && at?.paciente_id === patientA.id && at?.profissional_id === profA.id
    && at?.agendamento_id === appointment.id && at?.evolucao === `${state.tag}_synthetic_evolution_only`
    && duplicateCount === 1 && mismatchCount === 0;
  const scenarios = {
    "H02-A": { status: preStartPass ? "PASS" : "FAIL", evidence: preStartPass ? "prestart_reassignment_and_restore_allowed" : "prestart_reassignment_behavior_mismatch" },
    "H02-B": { status: attendance?.id ? "PASS" : "FAIL", evidence: attendance?.id ? "dentist_a_started_and_recorded_synthetic_evolution" : "attendance_start_missing" },
    "H02-C": { status: deniedWithExpectedDatabaseReason(afterAtoB.error) ? "PASS" : "FAIL", evidence: "professional_change_after_start_checked" },
    "H02-D": { status: deniedWithExpectedDatabaseReason(afterP1toP2.error) ? "PASS" : "FAIL", evidence: "patient_change_after_start_checked" },
    "H02-E": { status: dentistBDenied ? "PASS" : "FAIL", evidence: "other_dentist_cannot_start_or_edit" },
    "H02-F": { status: integrityPass ? "PASS" : "FAIL", evidence: `attendance_count=${duplicateCount ?? "unknown"}; mismatch_count=${mismatchCount ?? "unknown"}` },
  };
  state.scenarios = Object.fromEntries(Object.entries(scenarios).map(([key, value]) => [key, value.status]));
  await saveRunState(state);
  return { runId, state, scenarios, result: Object.values(scenarios).every((item) => item.status === "PASS") ? "PASS" : "FAIL" };
}
