import { createHash, randomBytes } from "node:crypto";
import { createAnonClient, createServiceClient, authenticateActor } from "./lib/auth.mjs";
import { newRunState, recordFixture, uploadSyntheticPdf } from "./fixtures.mjs";
import { createRunId } from "./lib/safe.mjs";
import { saveRunState } from "./lib/state.mjs";

function requireNoError(result, label) {
  if (result.error) throw new Error(`H01_SETUP_FAILED:${label}`);
  return result.data;
}

function localDateTime(date) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Cuiaba", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`;
}

const ROUTE_CATEGORIES = new Set([
  "authorized_signed_redirect",
  "authorized_route_did_not_return_signed_redirect",
  "denied_before_signed_redirect",
  "denied_actor_received_route_response",
  "preview_route_unreachable",
]);
export const VERCEL_BYPASS_ACTION_REQUIRED = "ACTION_REQUIRED: configure VERCEL_AUTOMATION_BYPASS_SECRET for protected Vercel Preview.";
export const HTTPS_BYPASS_ACTION_REQUIRED = "ACTION_REQUIRED: use HTTPS HOMOLOGATION_BASE_URL with VERCEL_AUTOMATION_BYPASS_SECRET.";

export function requiresVercelAutomationBypass(baseUrl) {
  try {
    return new URL(baseUrl).hostname.toLowerCase().endsWith(".vercel.app");
  } catch {
    return false;
  }
}

function insecureBypassTarget(baseUrl, bypassSecret) {
  if (!baseUrl || !bypassSecret) return false;
  try {
    return new URL(baseUrl).protocol !== "https:";
  } catch {
    return true;
  }
}

export function evaluateStorageChecks({ bucketResult, anonDownload, aPath, adminPath, receptionPath, bPath, expectedPath }) {
  const bucketReadableByService = bucketResult.error === null && bucketResult.data != null;
  return {
    bucketReadableByService,
    bucketIsPrivate: bucketReadableByService && bucketResult.data.public === false,
    anonymousDownloadDenied: !!anonDownload.error,
    authorPathAllowed: aPath.error === null && aPath.data === expectedPath,
    adminPathDenied: adminPath.error === null && adminPath.data === null,
    receptionPathDenied: receptionPath.error === null && receptionPath.data === null,
    otherDentistPathDenied: bPath.error === null && bPath.data === null,
  };
}

export function formatH01EDiagnostics(storageChecks, routeChecks) {
  const storageLabels = [
    ["bucket_service_access", "bucketReadableByService"],
    ["bucket_private", "bucketIsPrivate"],
    ["anonymous_download_denied", "anonymousDownloadDenied"],
    ["author_path", "authorPathAllowed"],
    ["admin_path_denied", "adminPathDenied"],
    ["reception_path_denied", "receptionPathDenied"],
    ["other_dentist_path_denied", "otherDentistPathDenied"],
  ];
  const lines = ["H01-E storage:", ...storageLabels.map(([label, key]) => `  ${label}: ${storageChecks[key] === true ? "PASS" : "FAIL"}`), "H01-E route:"];
  for (const actor of ["dentistA", "admin", "reception", "dentistB"]) {
    const check = routeChecks[actor];
    const httpStatus = Number.isInteger(check?.httpStatus) && check.httpStatus >= 100 && check.httpStatus <= 599 ? check.httpStatus : "N/A";
    const category = ROUTE_CATEGORIES.has(check?.category) ? check.category : "preview_route_unreachable";
    lines.push(`  ${actor}: ${httpStatus} ${category}`);
  }
  return lines;
}

export function printH01EDiagnostics(storageChecks, routeChecks, writeLine = console.log) {
  for (const line of formatH01EDiagnostics(storageChecks, routeChecks)) writeLine(line);
}

export function evaluateH01E(storageChecks, routeChecks) {
  const storageSafe = Object.values(storageChecks).every(Boolean);
  const routeReady = routeChecks.every((item) => item.status === "PASS");
  const routeBlocked = routeChecks.some((item) => item.status === "BLOCKED");
  const bypassActionRequired = routeChecks.find((item) => item.reason === VERCEL_BYPASS_ACTION_REQUIRED || item.reason === HTTPS_BYPASS_ACTION_REQUIRED)?.reason;
  return {
    status: routeBlocked ? "BLOCKED" : storageSafe && routeReady ? "PASS" : "FAIL",
    evidence: bypassActionRequired ?? (routeBlocked ? "ACTION_REQUIRED: preview_route_configuration" : storageSafe && routeReady ? "private_bucket_authorized_route_only" : `storageSafe=${storageSafe};routeReady=${routeReady}`),
  };
}

export async function routeDecision(baseUrl, documentId, actorSession, expectedAllowed, env = process.env) {
  if (!baseUrl) return { status: "BLOCKED", httpStatus: "N/A", category: "preview_route_unreachable" };
  const bypassSecret = env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim();
  if (requiresVercelAutomationBypass(baseUrl) && !bypassSecret) {
    return { status: "BLOCKED", httpStatus: "N/A", category: "preview_route_unreachable", reason: VERCEL_BYPASS_ACTION_REQUIRED };
  }
  if (insecureBypassTarget(baseUrl, bypassSecret)) {
    return { status: "BLOCKED", httpStatus: "N/A", category: "preview_route_unreachable", reason: HTTPS_BYPASS_ACTION_REQUIRED };
  }
  const headers = { cookie: actorSession.getCookieHeader() };
  if (bypassSecret) headers["x-vercel-protection-bypass"] = bypassSecret;
  const response = await fetch(new URL(`/api/documentos/${documentId}`, baseUrl), {
    method: "GET",
    headers,
    redirect: "manual",
    cache: "no-store",
    signal: AbortSignal.timeout(12000),
  }).catch(() => null);
  if (!response) return { status: "FAIL", httpStatus: "N/A", category: "preview_route_unreachable" };
  const location = response.headers.get("location");
  if (expectedAllowed) {
    let signedStorageRedirect = false;
    try {
      const parsed = new URL(location);
      signedStorageRedirect = /^https?:$/.test(parsed.protocol)
        && parsed.pathname.includes("/storage/v1/object/sign/arquivos-paciente/")
        && parsed.search.length > 0;
    } catch { signedStorageRedirect = false; }
    const authorized = response.status >= 300 && response.status < 400 && signedStorageRedirect;
    return { status: authorized ? "PASS" : "FAIL", httpStatus: response.status, category: authorized ? "authorized_signed_redirect" : "authorized_route_did_not_return_signed_redirect" };
  }
  const denied = response.status === 404 && !location;
  return { status: denied ? "PASS" : "FAIL", httpStatus: response.status, category: denied ? "denied_before_signed_redirect" : "denied_actor_received_route_response" };
}

export async function runH01(env = process.env) {
  if (requiresVercelAutomationBypass(env.HOMOLOGATION_BASE_URL) && !env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim()) {
    throw new Error(VERCEL_BYPASS_ACTION_REQUIRED);
  }
  if (insecureBypassTarget(env.HOMOLOGATION_BASE_URL, env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim())) {
    throw new Error(HTTPS_BYPASS_ACTION_REQUIRED);
  }
  const runId = createRunId();
  const state = newRunState(runId);
  await saveRunState(state);

  const admin = await authenticateActor("admin", env);
  const dentistA = await authenticateActor("dentistA", env);
  const dentistB = await authenticateActor("dentistB", env);
  const reception = await authenticateActor("reception", env);
  const [aUser, bUser, receptionUser] = await Promise.all([
    dentistA.client.auth.getUser(), dentistB.client.auth.getUser(), reception.client.auth.getUser(),
  ]);
  if (aUser.error || bUser.error || receptionUser.error || !aUser.data.user || !bUser.data.user || !receptionUser.data.user) throw new Error("H01_SETUP_FAILED:authenticated_identity");

  const service = createServiceClient(env);
  const profResult = await service.from("profissionais").select("id,registro_profissional,status").eq("usuario_id", aUser.data.user.id).maybeSingle();
  const professional = requireNoError(profResult, "professional_lookup");
  if (!professional?.id || professional.status !== "ativo" || !professional.registro_profissional?.trim()) throw new Error("ACTION_REQUIRED: complete active Dentist A professional registration through the normal admin UI.");

  const patientResult = await reception.client.rpc("create_patient", {
    p_nome: `${state.tag}_H01_PATIENT`, p_data_nascimento: null, p_telefone_contato: null,
    p_documento_identificacao: null, p_alergias: null, p_intolerancias: null, p_medicamentos_em_uso: null,
  });
  const patient = requireNoError(patientResult, "patient_create");
  const patientId = patient.id;
  await recordFixture(state, "patient", patientId, receptionUser.data.user.id);

  const start = localDateTime(new Date(Date.now() + 48 * 60 * 60 * 1000));
  const end = localDateTime(new Date(Date.now() + 49 * 60 * 60 * 1000));
  const appointmentResult = await reception.client.rpc("create_appointment", {
    p_paciente_id: patientId, p_profissional_id: professional.id, p_inicio_local: start, p_fim_local: end,
    p_observacoes_administrativas: `${state.tag}_H01_APPOINTMENT`,
  });
  const appointment = requireNoError(appointmentResult, "appointment_create");
  await recordFixture(state, "appointment", appointment.id, receptionUser.data.user.id);

  const startedResult = await dentistA.client.rpc("start_attendance", { p_agendamento_id: appointment.id });
  const attendance = requireNoError(startedResult, "attendance_start");
  await recordFixture(state, "attendance", attendance.id, aUser.data.user.id);
  const evolutionResult = await dentistA.client.rpc("update_attendance", { p_atendimento_id: attendance.id, p_evolucao: `${state.tag}_synthetic_fixture_only` });
  requireNoError(evolutionResult, "synthetic_evolution");

  const pdf = await uploadSyntheticPdf(service, patientId, state);
  const storage = service.storage.from("arquivos-paciente");
  const [objectInfo, readback] = await Promise.all([
    storage.info(pdf.path), storage.download(pdf.path, {}, { cache: "no-store" }),
  ]);
  if (objectInfo.error || readback.error || !objectInfo.data || !readback.data ||
      objectInfo.data.bucketId !== "arquivos-paciente" || objectInfo.data.name !== pdf.path ||
      objectInfo.data.size !== pdf.size || objectInfo.data.contentType !== "application/pdf" ||
      readback.data.size !== pdf.size || (readback.data.type && readback.data.type !== "application/pdf")) {
    throw new Error("H01_SETUP_FAILED:private_storage_readback");
  }
  const storedBytes = new Uint8Array(await readback.data.arrayBuffer());
  const storedSha256 = createHash("sha256").update(storedBytes).digest("hex");
  if (storedBytes.length !== pdf.size || storedSha256 !== pdf.sha256) {
    throw new Error("H01_SETUP_FAILED:private_storage_integrity");
  }
  const uploadToken = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(uploadToken).digest("hex");
  requireNoError(await service.rpc("prepare_upload_attestation", {
    p_actor_id: aUser.data.user.id,
    p_paciente_id: patientId,
    p_purpose: "document:atestado",
    p_bucket_id: "arquivos-paciente",
    p_storage_path: pdf.path,
    p_sha256: storedSha256,
    p_tamanho_bytes: storedBytes.length,
    p_mime_type: "application/pdf",
    p_token_hash: tokenHash,
  }), "document_upload_attestation");
  const documentResult = await dentistA.client.rpc("create_official_document_verified", {
    p_paciente_id: patientId,
    p_atendimento_id: attendance.id,
    p_profissional_autor_id: professional.id,
    p_tipo: "atestado",
    p_emitido_em: new Date().toISOString().slice(0, 10),
    p_finalidade: "Fixture sintética de autorização da homologação 0030",
    p_comparecimento_inicio: null,
    p_comparecimento_fim: null,
    p_afastamento_quantidade: 1,
    p_afastamento_unidade: "dias",
    p_acompanhante_nome: null,
    p_acompanhante_identificacao: null,
    p_acompanhante_relacao: null,
    p_texto_adicional: null,
    p_cid_codigo: "QATEST0030",
    p_cid_autorizado: true,
    p_cid_autorizador_tipo: "paciente",
    p_storage_path: pdf.path,
    p_nome_arquivo: `${state.tag}.pdf`,
    p_tamanho_bytes: storedBytes.length,
    p_layout_version: 1,
    p_pdf_sha256: storedSha256,
    p_upload_token: uploadToken,
  });
  if (documentResult.error) {
    await service.rpc("cancel_upload_attestation", { p_token_hash: tokenHash });
  }
  const document = requireNoError(documentResult, "official_document_create");
  await recordFixture(state, "document", document.id, aUser.data.user.id);
  state.documentStoragePath = pdf.path;
  await saveRunState(state);

  const [ownCid, adminCid, receptionCid, otherDentistCid] = await Promise.all([
    dentistA.client.from("documento_cid").select("documento_id,codigo,autorizado").eq("documento_id", document.id),
    admin.client.from("documento_cid").select("documento_id").eq("documento_id", document.id),
    reception.client.from("documento_cid").select("documento_id").eq("documento_id", document.id),
    dentistB.client.from("documento_cid").select("documento_id").eq("documento_id", document.id),
  ]);
  const getPath = async (session) => session.client.rpc("get_document_download_path", { p_documento_id: document.id });
  const [aPath, adminPath, receptionPath, bPath, bucketResult, anonDownload] = await Promise.all([
    getPath(dentistA), getPath(admin), getPath(reception), getPath(dentistB), service.storage.getBucket("arquivos-paciente"),
    createAnonClient(env).storage.from("arquivos-paciente").download(pdf.path),
  ]);

  const scenarios = {
    "H01-A": { status: ownCid.error === null && ownCid.data?.length === 1 && ownCid.data[0].autorizado === true ? "PASS" : "FAIL", evidence: "author_cid_visibility_checked" },
    "H01-B": { status: adminCid.error === null && adminCid.data?.length === 0 ? "PASS" : "FAIL", evidence: "admin_cid_denied" },
    "H01-C": { status: receptionCid.error === null && receptionCid.data?.length === 0 ? "PASS" : "FAIL", evidence: "reception_cid_denied" },
    "H01-D": { status: otherDentistCid.error === null && otherDentistCid.data?.length === 0 ? "PASS" : "FAIL", evidence: "other_dentist_cid_denied" },
  };
  const storageChecks = evaluateStorageChecks({ bucketResult, anonDownload, aPath, adminPath, receptionPath, bPath, expectedPath: pdf.path });
  const routeChecks = await Promise.all([
    routeDecision(env.HOMOLOGATION_BASE_URL, document.id, dentistA, true, env),
    routeDecision(env.HOMOLOGATION_BASE_URL, document.id, admin, false, env),
    routeDecision(env.HOMOLOGATION_BASE_URL, document.id, reception, false, env),
    routeDecision(env.HOMOLOGATION_BASE_URL, document.id, dentistB, false, env),
  ]);
  const routesByActor = Object.fromEntries(["dentistA", "admin", "reception", "dentistB"].map((actor, index) => [actor, routeChecks[index]]));
  printH01EDiagnostics(storageChecks, routesByActor);
  scenarios["H01-E"] = evaluateH01E(storageChecks, routeChecks);
  state.scenarios = Object.fromEntries(Object.entries(scenarios).map(([key, value]) => [key, value.status]));
  await saveRunState(state);
  return { runId, state, scenarios, result: Object.values(scenarios).every((item) => item.status === "PASS") ? "PASS" : Object.values(scenarios).some((item) => item.status === "FAIL") ? "FAIL" : "BLOCKED" };
}
