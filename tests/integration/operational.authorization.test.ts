import { createHash, randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { MAX_UPLOAD_BYTES, safeUpload } from "../../lib/operational/validation";
import { createQaUser, createQaAdmin } from "./helpers";

type Role = "administrador" | "dentista" | "recepcao";
type Identity = { id: string; email: string; password: string; role: Role };
const REQUIRED_MARKER = "I_ACKNOWLEDGE_FAKE_DATA_ONLY";
const users: Identity[] = [], paths: string[] = [], proofHashes: string[] = [], auditIds: string[] = [];
let url: string, anon: string, service: SupabaseClient, admin: SupabaseClient, reception: SupabaseClient, dentistA: SupabaseClient, dentistB: SupabaseClient;
let adminId: string, patientId: string, professionalA: string, receptionIdentity: Identity, dentistAIdentity: Identity, dentistBIdentity: Identity, inactiveIdentity: Identity, orphanIdentity: Identity;
let returnId: string, appointmentId: string, taskId: string, clinicalFileId: string, documentId: string;

function required(name: string) { const value = process.env[name]; if (!value) throw new Error(`${name} nao configurada em .env.test.local.`); return value; }
function client() { return createClient(url, anon, { auth: { autoRefreshToken: false, persistSession: false } }); }
async function signed(identity: Pick<Identity, "email" | "password">) { const result = client(); expect((await result.auth.signInWithPassword(identity)).error).toBeNull(); return result; }
async function identity(role: Role) { const suffix = randomUUID(); const candidate = { email: `qa_rc_operacional-${role}-${suffix}@example.com`, password: `Tmp-${randomUUID()}-A9!`, role }; const { data, error } = await createQaUser(service, { email: candidate.email, password: candidate.password, email_confirm: true, user_metadata: { nome: `QA_RC_Usuario_operacional_${suffix}`, perfil: role, created_by: adminId } }); if (error || !data.user) throw error ?? new Error("Usuario ficticio ausente."); const result = { ...candidate, id: data.user.id }; users.push(result); return result; }
function slot(hours: number) { const start = new Date(Date.now() + hours * 60 * 60 * 1000); const value = (date: Date) => date.toISOString().slice(0, 16); return { start: value(start), end: value(new Date(start.getTime() + 60 * 60 * 1000)) }; }
function pathFor(patient: string, document = false) { const path = document ? `${patient}/documentos/${randomUUID()}.pdf` : `${patient}/${randomUUID()}.pdf`; paths.push(path); return path; }
const pdfBytes = new Uint8Array([37, 80, 68, 70, 45]);
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
async function attemptProof(actorId: string, purpose: string, path: string, bytes: Uint8Array, overrides: Record<string, unknown> = {}, caller = service) {
  const token = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(token).digest("hex"); proofHashes.push(tokenHash);
  const result = await caller.rpc("prepare_upload_attestation", {
    p_actor_id: actorId, p_paciente_id: patientId, p_purpose: purpose,
    p_bucket_id: "arquivos-paciente", p_storage_path: path,
    p_sha256: digest(bytes), p_tamanho_bytes: bytes.length, p_mime_type: "application/pdf",
    p_token_hash: tokenHash, ...overrides,
  });
  return { token, result };
}
async function prepareProof(actorId: string, purpose: string, path: string, bytes: Uint8Array) {
  const { token, result } = await attemptProof(actorId, purpose, path, bytes);
  expect(result.error).toBeNull(); return token;
}

describe("bloco operacional: RLS, Storage, documentos, retornos e tarefas", () => {
  beforeAll(async () => {
    if (process.env.SUPABASE_TEST_HOMOLOGATION !== REQUIRED_MARKER) throw new Error("Homologacao ficticia nao confirmada em .env.test.local.");
    url = required("SUPABASE_TEST_URL"); anon = required("SUPABASE_TEST_ANON_KEY"); service = createClient(url, required("SUPABASE_TEST_SERVICE_ROLE_KEY"), { auth: { autoRefreshToken: false, persistSession: false } });
    const qaAdmin = await createQaAdmin(service, url, anon); admin = qaAdmin.session; adminId = qaAdmin.identity.id; users.push(qaAdmin.identity);
    [receptionIdentity, dentistAIdentity, dentistBIdentity, inactiveIdentity, orphanIdentity] = await Promise.all([identity("recepcao"), identity("dentista"), identity("dentista"), identity("recepcao"), identity("recepcao")]);
    reception = await signed(receptionIdentity); dentistA = await signed(dentistAIdentity); dentistB = await signed(dentistBIdentity);
    expect((await admin.rpc("update_user_access", { p_usuario_id: inactiveIdentity.id, p_perfil: null, p_status: "inativo" })).error).toBeNull();
    expect((await service.from("usuarios").delete().eq("id", orphanIdentity.id)).error).toBeNull();
    const { data: professional } = await service.from("profissionais").select("id").eq("usuario_id", dentistAIdentity.id).single(); professionalA = professional?.id ?? ""; if (!professionalA) throw new Error("Profissional ficticio ausente.");
    expect((await service.from("profissionais").update({ registro_profissional: "CRO-MT 54321" }).eq("id", professionalA)).error).toBeNull();
    const { data: patient, error } = await reception.rpc("create_patient", { p_nome: `QA_RC_Paciente_operacional_${randomUUID()}`, p_data_nascimento: "1990-01-15", p_telefone_contato: "+00 00000-0000", p_documento_identificacao: null, p_alergias: null, p_intolerancias: null, p_medicamentos_em_uso: null }); if (error || !patient) throw error ?? new Error("Paciente nao criado."); patientId = (patient as { id: string }).id;
  });

  afterAll(async () => {
    if (!service) return;
    for (const tokenHash of proofHashes) expect((await service.rpc("cancel_upload_attestation", { p_token_hash: tokenHash })).error).toBeNull();
    if (paths.length) await service.storage.from("arquivos-paciente").remove(paths);
    if (auditIds.length) await service.from("auditoria").delete().in("entidade_id", auditIds);
    if (taskId) await service.from("tarefas").delete().eq("id", taskId);
    if (patientId) { await service.from("arquivos_paciente").delete().eq("paciente_id", patientId); await service.from("documentos").delete().eq("paciente_id", patientId); await service.from("retornos").delete().eq("paciente_id", patientId); await service.from("tarefas").delete().eq("paciente_id", patientId); await service.from("atendimentos").delete().eq("paciente_id", patientId); await service.from("agendamentos").delete().eq("paciente_id", patientId); await service.from("paciente_alertas_clinicos").delete().eq("paciente_id", patientId); await service.from("pacientes").delete().eq("id", patientId); }
    if (users.length) await service.from("auditoria").delete().in("usuario_id", users.map((u) => u.id));
    await Promise.all([...users].reverse().map(async (user) => {
      await service.from("profissionais").delete().eq("usuario_id", user.id);
      await service.from("usuarios").delete().eq("id", user.id);
      await service.auth.admin.deleteUser(user.id);
    }));
  });

  it("mantem bucket privado, bloqueia Storage direto e valida upload no servidor", async () => {
    const { data: bucket, error } = await service.storage.getBucket("arquivos-paciente"); expect(error).toBeNull(); expect(bucket?.public).toBe(false); expect(bucket?.file_size_limit).toBe(10 * 1024 * 1024);
    const knownPath = `${patientId}/${randomUUID()}.pdf`; paths.push(knownPath); const bytes = new Uint8Array([37, 80, 68, 70, 45]);
    expect((await reception.storage.from("arquivos-paciente").upload(knownPath, bytes, { contentType: "application/pdf", upsert: false })).error).not.toBeNull();
    expect((await reception.storage.from("arquivos-paciente").download(knownPath)).error).not.toBeNull();
    expect(safeUpload({ name: "falso.png", type: "application/pdf", size: 5 }, bytes, "administrativo").ok).toBe(false);
    expect(safeUpload({ name: "falso.pdf", type: "application/pdf", size: 5 }, new Uint8Array([1, 2, 3, 4, 5]), "administrativo").ok).toBe(false);
    expect(safeUpload({ name: "grande.pdf", type: "application/pdf", size: MAX_UPLOAD_BYTES + 1 }, bytes, "administrativo").ok).toBe(false);
  });

  it("aplica RLS clinico por metadado e impede bypass por UUID/path", async () => {
    const { data: created, error } = await reception.rpc("create_appointment", { p_paciente_id: patientId, p_profissional_id: professionalA, p_inicio_local: slot(48).start, p_fim_local: slot(49).end, p_observacoes_administrativas: null }); expect(error).toBeNull(); appointmentId = (created as { id: string }).id; auditIds.push(appointmentId);
    const administrativePath = pathFor(patientId); const clinicalPath = pathFor(patientId); const bytes = pdfBytes;
    expect((await service.storage.from("arquivos-paciente").upload(administrativePath, bytes, { contentType: "application/pdf", upsert: false })).error).toBeNull();
    const administrativeToken = await prepareProof(receptionIdentity.id, "file:administrativo", administrativePath, bytes);
    const administrative = await reception.rpc("create_patient_file_metadata_verified", { p_paciente_id: patientId, p_storage_path: administrativePath, p_nome_original: "QA_RC_administrativo.pdf", p_mime_type: "application/pdf", p_tamanho_bytes: bytes.length, p_categoria: "administrativo", p_sha256: digest(bytes), p_upload_token: administrativeToken }); expect(administrative.error).toBeNull(); auditIds.push((administrative.data as { id: string }).id);
    expect((await service.storage.from("arquivos-paciente").upload(clinicalPath, bytes, { contentType: "application/pdf", upsert: false })).error).toBeNull();
    const clinicalToken = await prepareProof(dentistAIdentity.id, "file:clinico", clinicalPath, bytes);
    const clinical = await dentistA.rpc("create_patient_file_metadata_verified", { p_paciente_id: patientId, p_storage_path: clinicalPath, p_nome_original: "QA_RC_clinico.pdf", p_mime_type: "application/pdf", p_tamanho_bytes: bytes.length, p_categoria: "clinico", p_sha256: digest(bytes), p_upload_token: clinicalToken }); expect(clinical.error).toBeNull(); clinicalFileId = (clinical.data as { id: string }).id; auditIds.push(clinicalFileId);
    expect((clinical.data as { sha256: string }).sha256).toBe(digest(bytes));
    expect((await reception.rpc("create_patient_file_metadata", { p_paciente_id: patientId, p_storage_path: administrativePath, p_nome_original: "QA_RC_legado.pdf", p_mime_type: "application/pdf", p_tamanho_bytes: bytes.length, p_categoria: "administrativo" })).error).not.toBeNull();
    expect((await dentistA.storage.from("arquivos-paciente").upload(clinicalPath, bytes, { contentType: "application/pdf", upsert: false })).error).not.toBeNull();
    expect((await reception.from("arquivos_paciente").select("id").eq("id", clinicalFileId)).data).toEqual([]);
    expect((await admin.from("arquivos_paciente").select("id").eq("id", clinicalFileId)).data).toEqual([]);
    expect((await dentistB.from("arquivos_paciente").select("id").eq("id", clinicalFileId)).data).toEqual([]);
    expect((await dentistA.from("arquivos_paciente").select("id,storage_path").eq("id", clinicalFileId)).data).toHaveLength(1);
    expect((await reception.from("arquivos_paciente").insert({ paciente_id: patientId })).error).not.toBeNull();
    expect((await reception.from("arquivos_paciente").delete().eq("id", clinicalFileId)).error).not.toBeNull();
    const signed = await service.storage.from("arquivos-paciente").createSignedUrl(clinicalPath, 300); expect(signed.error).toBeNull(); expect(signed.data?.signedUrl).toContain("token=");
    const { data: metadata } = await service.from("arquivos_paciente").select("*").eq("id", clinicalFileId).single(); expect(JSON.stringify(metadata)).not.toContain("token=");
  });

  it("S1 rejeita namespace, objeto, MIME, digest e tamanho inconsistentes sem metadata parcial", async () => {
    const foreignPath = pathFor(randomUUID());
    expect((await service.storage.from("arquivos-paciente").upload(foreignPath, pdfBytes, { contentType: "application/pdf", upsert: false })).error).toBeNull();
    expect((await attemptProof(receptionIdentity.id, "file:administrativo", foreignPath, pdfBytes)).result.error).not.toBeNull();
    expect((await service.from("arquivos_paciente").select("id").eq("storage_path", foreignPath)).data).toEqual([]);

    const absentPath = pathFor(patientId);
    expect((await attemptProof(receptionIdentity.id, "file:administrativo", absentPath, pdfBytes)).result.error).not.toBeNull();
    const mimePath = pathFor(patientId);
    expect((await service.storage.from("arquivos-paciente").upload(mimePath, pdfBytes, { contentType: "application/pdf", upsert: false })).error).toBeNull();
    expect((await attemptProof(receptionIdentity.id, "file:administrativo", mimePath, pdfBytes, { p_mime_type: "image/jpeg" })).result.error).not.toBeNull();

    const path = pathFor(patientId);
    expect((await service.storage.from("arquivos-paciente").upload(path, pdfBytes, { contentType: "application/pdf", upsert: false })).error).toBeNull();
    const token = await prepareProof(receptionIdentity.id, "file:administrativo", path, pdfBytes);
    const args = { p_paciente_id: patientId, p_storage_path: path, p_nome_original: "QA_RC_verificado.pdf", p_mime_type: "application/pdf", p_tamanho_bytes: pdfBytes.length, p_categoria: "administrativo", p_sha256: digest(pdfBytes), p_upload_token: token };
    const before = await service.from("auditoria").select("id", { count: "exact", head: true }).eq("evento", "arquivo_enviado").eq("usuario_id", receptionIdentity.id);
    expect((await reception.rpc("create_patient_file_metadata_verified", { ...args, p_sha256: "f".repeat(64) })).error).not.toBeNull();
    expect((await reception.rpc("create_patient_file_metadata_verified", { ...args, p_tamanho_bytes: pdfBytes.length + 1 })).error).not.toBeNull();
    expect((await reception.rpc("create_patient_file_metadata_verified", { ...args, p_nome_original: "" })).error).not.toBeNull();
    expect((await service.from("arquivos_paciente").select("id").eq("storage_path", path)).data).toEqual([]);
    const after = await service.from("auditoria").select("id", { count: "exact", head: true }).eq("evento", "arquivo_enviado").eq("usuario_id", receptionIdentity.id);
    expect(after.count).toBe(before.count);
    const valid = await reception.rpc("create_patient_file_metadata_verified", args);
    expect(valid.error).toBeNull(); auditIds.push((valid.data as { id: string }).id);
    expect((valid.data as { sha256: string }).sha256).toBe(digest(pdfBytes));
  });

  it("S1 vincula prova ao ator e categoria e bloqueia replay mesmo após remover a metadata", async () => {
    const path = pathFor(patientId);
    expect((await service.storage.from("arquivos-paciente").upload(path, pdfBytes, { contentType: "application/pdf", upsert: false })).error).toBeNull();
    const token = await prepareProof(receptionIdentity.id, "file:administrativo", path, pdfBytes);
    const args = { p_paciente_id: patientId, p_storage_path: path, p_nome_original: "QA_RC_ator.pdf", p_mime_type: "application/pdf", p_tamanho_bytes: pdfBytes.length, p_categoria: "administrativo", p_sha256: digest(pdfBytes), p_upload_token: token };
    expect((await admin.rpc("create_patient_file_metadata_verified", args)).error).not.toBeNull();
    const accepted = await reception.rpc("create_patient_file_metadata_verified", args);
    expect(accepted.error).toBeNull(); const fileId = (accepted.data as { id: string }).id; auditIds.push(fileId);
    expect((await service.from("arquivos_paciente").delete().eq("id", fileId)).error).toBeNull();
    expect((await reception.rpc("create_patient_file_metadata_verified", args)).error).not.toBeNull();
    expect((await service.from("arquivos_paciente").select("id").eq("storage_path", path)).data).toEqual([]);

    const purposePath = pathFor(patientId);
    expect((await service.storage.from("arquivos-paciente").upload(purposePath, pdfBytes, { contentType: "application/pdf", upsert: false })).error).toBeNull();
    const { token: wrongPurposeToken, result } = await attemptProof(receptionIdentity.id, "file:clinico", purposePath, pdfBytes);
    expect(result.error).toBeNull();
    expect((await reception.rpc("create_patient_file_metadata_verified", { ...args, p_storage_path: purposePath, p_upload_token: wrongPurposeToken })).error).not.toBeNull();
    expect((await service.from("arquivos_paciente").select("id").eq("storage_path", purposePath)).data).toEqual([]);
  });

  it("gera documento oficial privado, bloqueia RPC legada e nao audita conteudo", async () => {
    const documentPath = pathFor(patientId, true); const bytes = pdfBytes; expect((await service.storage.from("arquivos-paciente").upload(documentPath, bytes, { contentType: "application/pdf", upsert: false })).error).toBeNull();
    const attendance = await dentistA.rpc("create_direct_attendance", { p_paciente_id: patientId }); expect(attendance.error).toBeNull(); const documentAttendanceId = (attendance.data as { id: string }).id; auditIds.push(documentAttendanceId);
    const documentToken = await prepareProof(dentistAIdentity.id, "document:atestado", documentPath, bytes);
    const created = await dentistA.rpc("create_official_document_verified", { p_paciente_id: patientId, p_atendimento_id: documentAttendanceId, p_profissional_autor_id: professionalA, p_tipo: "atestado", p_emitido_em: new Date().toISOString().slice(0, 10), p_finalidade: "QA_RC_justificativa", p_comparecimento_inicio: null, p_comparecimento_fim: null, p_afastamento_quantidade: null, p_afastamento_unidade: null, p_acompanhante_nome: null, p_acompanhante_identificacao: null, p_acompanhante_relacao: null, p_texto_adicional: "QA_RC_conteudo_clinico_nao_auditavel", p_cid_codigo: null, p_cid_autorizado: false, p_cid_autorizador_tipo: null, p_storage_path: documentPath, p_nome_arquivo: "QA_RC_atestado.pdf", p_tamanho_bytes: bytes.length, p_layout_version: 2, p_pdf_sha256: digest(bytes), p_upload_token: documentToken }); expect(created.error).toBeNull(); documentId = (created.data as { id: string }).id; auditIds.push(documentId);
    expect((await admin.rpc("create_document_metadata", { p_paciente_id: patientId, p_profissional_id: professionalA, p_tipo: "atestado", p_emitido_em: new Date().toISOString().slice(0, 10), p_periodo_inicio: null, p_periodo_fim: null, p_texto_adicional: null, p_storage_path: `${patientId}/documentos/${randomUUID()}.pdf`, p_nome_arquivo: "QA_RC_legado.pdf", p_tamanho_bytes: 5 })).error).not.toBeNull();
    expect((await dentistA.from("documentos").select("id").eq("id", documentId)).data).toHaveLength(1); expect((await dentistB.from("documentos").select("id").eq("id", documentId)).data).toEqual([]);
    const { data: audit } = await admin.from("auditoria").select("dados").eq("entidade_id", documentId); expect(JSON.stringify(audit)).not.toContain("QA_RC_conteudo_clinico_nao_auditavel");
  });

  it("vincula retorno ao agendamento e o conclui ao atendimento", async () => {
    const direct = await dentistA.rpc("create_direct_attendance", { p_paciente_id: patientId }); expect(direct.error).toBeNull(); const attendanceId = (direct.data as { id: string }).id; auditIds.push(attendanceId);
    const returned = await dentistA.rpc("create_return", { p_atendimento_id: attendanceId, p_data_prevista: new Date(Date.now() + 86400000).toISOString().slice(0, 10), p_observacao_administrativa: "QA_RC_retorno" }); expect(returned.error).toBeNull(); returnId = (returned.data as { id: string }).id; auditIds.push(returnId);
    expect((await reception.rpc("link_return_appointment", { p_retorno_id: returnId, p_agendamento_id: appointmentId })).error).toBeNull();
    const started = await dentistA.rpc("start_attendance", { p_agendamento_id: appointmentId }); expect(started.error).toBeNull(); const linkedAttendance = (started.data as { id: string }).id; auditIds.push(linkedAttendance);
    expect((await dentistA.rpc("finalize_attendance", { p_atendimento_id: linkedAttendance, p_evolucao: "QA_RC_evolucao" })).error).toBeNull(); const status = await reception.from("retornos").select("status,agendamento_id").eq("id", returnId).single(); expect(status.data).toMatchObject({ status: "concluido", agendamento_id: appointmentId });
  });

  it("mantem regras de tarefa na RPC e auditoria sem valores sensiveis", async () => {
    const legacy = await admin.rpc("create_task", { p_titulo: "QA_RC_Tarefa_legada", p_descricao: null, p_prazo: null, p_responsavel_id: receptionIdentity.id, p_paciente_id: patientId, p_agendamento_id: null });
    expect(legacy.error).toBeNull();
    const legacyTaskId = (legacy.data as { id: string }).id;
    auditIds.push(legacyTaskId);
    const legacyTask = await service.from("tarefas").select("prioridade").eq("id", legacyTaskId).single();
    expect(legacyTask.data?.prioridade).toBe("media");

    const created = await admin.rpc("create_task", { p_titulo: "QA_RC_Tarefa_operacional", p_descricao: "QA_RC_conteudo_sensivel", p_prazo: null, p_responsavel_id: receptionIdentity.id, p_prioridade: "urgente", p_paciente_id: patientId, p_agendamento_id: null }); expect(created.error).toBeNull(); taskId = (created.data as { id: string }).id; auditIds.push(taskId);
    expect((await service.from("tarefas").select("prioridade").eq("id", taskId).single()).data?.prioridade).toBe("urgente");
    for (const priority of ["alta", "media", "baixa"] as const) {
      expect((await reception.rpc("update_task", { p_tarefa_id: taskId, p_titulo: "QA_RC_Tarefa_editada", p_descricao: "QA_RC_conteudo_alterado", p_prazo: null, p_responsavel_id: receptionIdentity.id, p_prioridade: priority, p_paciente_id: null, p_agendamento_id: null })).error).toBeNull();
      expect((await service.from("tarefas").select("prioridade").eq("id", taskId).single()).data?.prioridade).toBe(priority);
    }
    expect((await reception.rpc("update_task", { p_tarefa_id: taskId, p_titulo: "QA_RC_Tarefa_invalida", p_descricao: null, p_prazo: null, p_responsavel_id: receptionIdentity.id, p_prioridade: "invalida", p_paciente_id: null, p_agendamento_id: null })).error).not.toBeNull();
    expect((await dentistB.rpc("update_task", { p_tarefa_id: taskId, p_titulo: "QA_RC_negado", p_descricao: null, p_prazo: null, p_responsavel_id: dentistBIdentity.id, p_prioridade: "media", p_paciente_id: null, p_agendamento_id: null })).error).not.toBeNull();
    expect((await admin.rpc("update_task", { p_tarefa_id: taskId, p_titulo: "QA_RC_invalida", p_descricao: null, p_prazo: null, p_responsavel_id: inactiveIdentity.id, p_prioridade: "media", p_paciente_id: null, p_agendamento_id: null })).error).not.toBeNull();
    // A ordenacao do Kanban e calculada no banco a partir de vizinhos, sem DML direto.
    expect((await reception.rpc("move_task_kanban", { p_tarefa_id: taskId, p_status: "pendente", p_before_id: null, p_after_id: legacyTaskId })).error).toBeNull();
    const reordered = await service.from("tarefas").select("status,ordem_kanban").eq("id", taskId).single();
    const legacyOrder = await service.from("tarefas").select("ordem_kanban").eq("id", legacyTaskId).single();
    expect(reordered.data?.status).toBe("pendente");
    expect(Number(reordered.data?.ordem_kanban)).toBeLessThan(Number(legacyOrder.data?.ordem_kanban));
    expect((await dentistB.rpc("move_task_kanban", { p_tarefa_id: taskId, p_status: "em_andamento", p_before_id: null, p_after_id: null })).error).not.toBeNull();
    expect((await reception.rpc("move_task_kanban", { p_tarefa_id: taskId, p_status: "em_andamento", p_before_id: null, p_after_id: null })).error).toBeNull();
    expect((await reception.rpc("move_task_kanban", { p_tarefa_id: taskId, p_status: "aguardando", p_before_id: null, p_after_id: null })).error).toBeNull();
    expect((await reception.rpc("move_task_kanban", { p_tarefa_id: taskId, p_status: "concluida", p_before_id: null, p_after_id: null })).error).toBeNull();
    expect((await admin.rpc("update_task", { p_tarefa_id: taskId, p_titulo: "QA_RC_tardia", p_descricao: null, p_prazo: null, p_responsavel_id: receptionIdentity.id, p_prioridade: "media", p_paciente_id: null, p_agendamento_id: null })).error).not.toBeNull();
    expect((await reception.from("tarefas").update({ titulo: "direto" }).eq("id", taskId)).error).not.toBeNull(); expect((await reception.from("tarefas").delete().eq("id", taskId)).error).not.toBeNull();
    expect((await dentistB.rpc("soft_delete_task", { p_tarefa_id: taskId })).error).not.toBeNull();
    for (const target of [inactiveIdentity, orphanIdentity]) { const blocked = await signed(target); expect((await blocked.rpc("soft_delete_task", { p_tarefa_id: taskId })).error).not.toBeNull(); }
    expect((await reception.rpc("soft_delete_task", { p_tarefa_id: taskId })).error).toBeNull();
    expect((await reception.from("tarefas").select("id").eq("id", taskId)).data).toEqual([]);
    const removedTask = await service.from("tarefas").select("prioridade,removida_em,removida_por").eq("id", taskId).single(); expect(removedTask.data?.prioridade).toBe("baixa"); expect(removedTask.data?.removida_em).not.toBeNull(); expect(removedTask.data?.removida_por).toBe(receptionIdentity.id);
    expect((await reception.rpc("update_task", { p_tarefa_id: taskId, p_titulo: "QA_RC_removida", p_descricao: null, p_prazo: null, p_responsavel_id: receptionIdentity.id, p_prioridade: "media", p_paciente_id: null, p_agendamento_id: null })).error).not.toBeNull();
    expect((await reception.rpc("set_task_status", { p_tarefa_id: taskId, p_status: "concluida" })).error).not.toBeNull();
    expect((await reception.rpc("soft_delete_task", { p_tarefa_id: taskId })).error).not.toBeNull();
    for (const target of [inactiveIdentity, orphanIdentity]) { const blocked = await signed(target); expect((await blocked.from("arquivos_paciente").select("id")).data).toEqual([]); expect((await blocked.rpc("create_task", { p_titulo: "QA_RC_negada", p_descricao: null, p_prazo: null, p_responsavel_id: receptionIdentity.id, p_prioridade: "media", p_paciente_id: null, p_agendamento_id: null })).error).not.toBeNull(); expect((await blocked.rpc("move_task_kanban", { p_tarefa_id: legacyTaskId, p_status: "em_andamento", p_before_id: null, p_after_id: null })).error).not.toBeNull(); }
    const { data: audit } = await admin.from("auditoria").select("dados").eq("entidade_id", taskId); expect(JSON.stringify(audit)).not.toContain("QA_RC_conteudo_sensivel"); expect(JSON.stringify(audit)).not.toContain("QA_RC_conteudo_alterado"); expect(JSON.stringify(audit)).toContain("ordem_kanban");
  });
});
