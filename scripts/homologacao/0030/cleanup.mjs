import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { ARTIFACT_ROOT } from "./config.mjs";
import { createServiceClient } from "./lib/auth.mjs";
import { loadRunState, saveRunState } from "./lib/state.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALLOWED_KINDS = new Set(["patient", "appointment", "attendance", "document"]);

async function newestRunId() {
  const directory = join(ARTIFACT_ROOT, "runs");
  const files = await readdir(directory).catch(() => []);
  const candidates = [];
  for (const file of files) {
    const match = /^([0-9]{14}-[0-9a-f-]{36})\.json$/i.exec(file);
    if (!match) continue;
    candidates.push({ runId: match[1], mtime: (await stat(join(directory, file))).mtimeMs });
  }
  candidates.sort((a, b) => b.mtime - a.mtime);
  return candidates[0]?.runId ?? null;
}

async function confirmCleanup(runId) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("Cleanup exige confirmação explícita em terminal interativo.");
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await terminal.question(`Confirma remoção seletiva deste run QA? Digite exatamente DELETE QA_0030 ${runId}: `);
    if (answer !== `DELETE QA_0030 ${runId}`) throw new Error("Cleanup não confirmado; nenhuma exclusão executada.");
  } finally { terminal.close(); }
}

export function selectedIds(state) {
  if (!/^\d{14}-[0-9a-f-]{36}$/i.test(state.runId) || state.tag !== `QA_0030_${state.runId}`) throw new Error("Run state inválido.");
  if (!Array.isArray(state.createdIds) || !Array.isArray(state.storagePaths)) throw new Error("Run state inválido.");
  for (const item of state.createdIds) {
    if (!ALLOWED_KINDS.has(item.kind) || !UUID.test(item.id) || item.runTag !== state.tag) throw new Error("Run state fora do escopo QA esperado.");
  }
  const ids = Object.fromEntries([...ALLOWED_KINDS].map((kind) => [kind, state.createdIds.filter((item) => item.kind === kind).map((item) => item.id)]));
  const patientIds = new Set(ids.patient);
  for (const path of state.storagePaths) {
    const match = /^([0-9a-f-]{36})\/documentos\/([0-9a-f-]{36})\.pdf$/i.exec(path);
    if (!match || !UUID.test(match[1]) || !UUID.test(match[2]) || !patientIds.has(match[1])) throw new Error("Run state contém caminho Storage fora do paciente QA deste run.");
  }
  return ids;
}

async function queryRows(client, table, columns, ids) {
  if (!ids.length) return [];
  const { data, error } = await client.from(table).select(columns).in("id", ids);
  if (error) throw new Error("Não foi possível validar escopo do cleanup.");
  return data ?? [];
}

export function validateCleanupRows(state, patients, appointments, attendances, documents) {
  const patientSet = new Set(patients.filter((row) => row.nome.startsWith(`${state.tag}_`)).map((row) => row.id));
  const appointmentSet = new Set(appointments.filter((row) => row.observacoes_administrativas?.startsWith(state.tag)).map((row) => row.id));
  const attendanceSet = new Set(attendances.filter((row) => appointmentSet.has(row.agendamento_id)).map((row) => row.id));
  const storagePathSet = new Set(state.storagePaths);
  const documentSet = new Set(documents.filter((row) => row.nome_arquivo.startsWith(`${state.tag}.`) && storagePathSet.has(row.storage_path)).map((row) => row.id));
  if (patients.some((row) => !patientSet.has(row.id)) || appointments.some((row) => !appointmentSet.has(row.id))
    || attendances.some((row) => !attendanceSet.has(row.id)) || documents.some((row) => !documentSet.has(row.id))) {
    throw new Error("Cleanup recusado: registro selecionado não possui marcador exato deste run.");
  }
  return { patientSet, appointmentSet, attendanceSet, documentSet };
}

export async function runCleanup(runIdArgument, env = process.env) {
  throw new Error("LEGACY_REMOTE_CLEANUP_DISABLED: audit retention and per-entity ownership manifest required");
  const runId = runIdArgument ?? await newestRunId();
  if (!runId) throw new Error("Nenhum run QA local disponível para cleanup.");
  const state = await loadRunState(runId);
  const ids = selectedIds(state);
  const service = createServiceClient(env);

  const [patients, appointments, attendances, documents] = await Promise.all([
    queryRows(service, "pacientes", "id,nome", ids.patient),
    queryRows(service, "agendamentos", "id,observacoes_administrativas", ids.appointment),
    queryRows(service, "atendimentos", "id,agendamento_id", ids.attendance),
    queryRows(service, "documentos", "id,nome_arquivo,storage_path", ids.document),
  ]);
  const { patientSet, appointmentSet, attendanceSet, documentSet } = validateCleanupRows(state, patients, appointments, attendances, documents);

  const removalCounts = { patients: patientSet.size, appointments: appointmentSet.size, attendances: attendanceSet.size, documents: documentSet.size, storageObjects: state.storagePaths.length };
  console.log(`Escopo conferido para ${state.tag}: ${JSON.stringify(removalCounts)}.`);
  if (Object.values(removalCounts).every((count) => count === 0)) return { runId, removed: { patients: 0, appointments: 0, attendances: 0, documents: 0 }, alreadyClean: true };
  await confirmCleanup(runId);

  const removeStorage = state.storagePaths.length ? await service.storage.from("arquivos-paciente").remove(state.storagePaths) : { error: null };
  if (removeStorage.error) throw new Error("Cleanup Storage falhou; dados clínicos não foram removidos.");
  const idsForDelete = {
    document: [...documentSet], attendance: [...attendanceSet], appointment: [...appointmentSet], patient: [...patientSet],
  };
  const deleteExact = async (table, column, values) => {
    if (!values.length) return;
    const { error } = await service.from(table).delete().in(column, values);
    if (error) throw new Error("Cleanup seletivo falhou; verifique manualmente este run QA.");
  };
  await deleteExact("documento_cid", "documento_id", idsForDelete.document);
  await deleteExact("documentos", "id", idsForDelete.document);
  const allEntityIds = [...idsForDelete.document, ...idsForDelete.attendance, ...idsForDelete.appointment, ...idsForDelete.patient];
  await deleteExact("auditoria", "entidade_id", allEntityIds);
  await deleteExact("atendimentos", "id", idsForDelete.attendance);
  await deleteExact("agendamentos", "id", idsForDelete.appointment);
  await deleteExact("paciente_alertas_clinicos", "paciente_id", idsForDelete.patient);
  await deleteExact("pacientes", "id", idsForDelete.patient);
  state.cleanedAt = new Date().toISOString();
  state.createdIds = [];
  state.storagePaths = [];
  delete state.documentStoragePath;
  await saveRunState(state);
  return { runId, removed: { patients: idsForDelete.patient.length, appointments: idsForDelete.appointment.length, attendances: idsForDelete.attendance.length, documents: idsForDelete.document.length } };
}
