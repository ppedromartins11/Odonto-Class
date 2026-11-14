"use server";

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  authorizePatientFileUpload,
  compensatePatientFileUpload,
} from "@/lib/operational/file-authorization";
import { safeUpload } from "@/lib/operational/validation";
import { PATIENT_STORAGE_BUCKET, reconcileFailedMetadata, verifyStoredUpload } from "@/lib/operational/storage-integrity";
import { isValidUuid } from "@/lib/patients/validation";
import type { DomainActionState } from "@/lib/operational/types";

export async function uploadPatientFile(_: DomainActionState, form: FormData): Promise<DomainActionState> {
  const user = await requireUser();
  const patientId = String(form.get("patientId") ?? ""); const category = String(form.get("category") ?? ""); const file = form.get("file");
  if (!isValidUuid(patientId)) return { success: false, error: "Paciente invalido." };
  if (!(file instanceof File) || !patientId) return { success: false, error: "Selecione um arquivo e paciente válidos." };
  if (category !== "administrativo" && category !== "clinico") return { success: false, error: "Categoria de arquivo inválida." };
  const s = await createSupabaseServerClient();
  const authorized = await authorizePatientFileUpload({
    patientExists: async (id) => {
      const { data, error } = await s.from("pacientes").select("id").eq("id", id).maybeSingle();
      return error === null && data !== null;
    },
    canManageOperational: async () => s.rpc("can_manage_operational"),
    canAccessClinicalPatient: async (id) => s.rpc("can_access_clinical_patient", { p_paciente_id: id }),
  }, patientId, category);
  if (!authorized) return { success: false, error: "Você não tem permissão para este arquivo." };
  const buffer = Buffer.from(await file.arrayBuffer()); const validated = safeUpload(file, buffer, category); if (!validated.ok) return { success: false, error: validated.error };
  if (file.size !== buffer.length) return { success: false, error: "Tamanho de arquivo invalido." };
  const path = `${patientId.toLowerCase()}/${randomUUID()}.${validated.extension}`; const admin = createSupabaseAdminClient();
  const upload = await admin.storage.from("arquivos-paciente").upload(path, buffer, { contentType: file.type, upsert: false });
  if (upload.error) return { success: false, error: "Não foi possível enviar o arquivo." };
  const storage = admin.storage.from(PATIENT_STORAGE_BUCKET);
  const verified = await verifyStoredUpload({
    patientId,
    purpose: `file:${validated.category}`,
    path,
    expectedBytes: buffer,
    mimeType: file.type,
    readInfo: () => storage.info(path),
    readBytes: () => storage.download(path, {}, { cache: "no-store" }),
  });
  if (!verified) {
    const compensated = await compensatePatientFileUpload(() => storage.remove([path]));
    if (!compensated) console.error("Falha na compensacao de upload de arquivo.");
    return { success: false, error: "Nao foi possivel verificar o arquivo privado." };
  }
  const uploadToken = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(uploadToken).digest("hex");
  let proof;
  try {
    proof = await admin.rpc("prepare_upload_attestation", {
    p_actor_id: user.id,
    p_paciente_id: patientId,
    p_purpose: `file:${validated.category}`,
    p_bucket_id: PATIENT_STORAGE_BUCKET,
    p_storage_path: path,
    p_sha256: verified.sha256,
    p_tamanho_bytes: verified.size,
    p_mime_type: verified.mimeType,
    p_token_hash: tokenHash,
    });
  } catch {
    try { await admin.rpc("cancel_upload_attestation", { p_token_hash: tokenHash }); } catch { /* TTL expires the proof. */ }
    const compensated = await compensatePatientFileUpload(() => storage.remove([path]));
    if (!compensated) console.error("Falha na compensacao de upload de arquivo.");
    return { success: false, error: "Nao foi possivel verificar o arquivo privado." };
  }
  if (proof.error) {
    try { await admin.rpc("cancel_upload_attestation", { p_token_hash: tokenHash }); } catch { /* TTL expires the proof. */ }
    const compensated = await compensatePatientFileUpload(() => storage.remove([path]));
    if (!compensated) console.error("Falha na compensacao de upload de arquivo.");
    return { success: false, error: "Nao foi possivel verificar o arquivo privado." };
  }
  let metadata;
  try {
    metadata = await s.rpc("create_patient_file_metadata_verified", {
    p_paciente_id: patientId,
    p_storage_path: path,
    p_nome_original: file.name,
    p_mime_type: verified.mimeType,
    p_tamanho_bytes: verified.size,
    p_categoria: validated.category,
    p_sha256: verified.sha256,
    p_upload_token: uploadToken,
    });
  } catch {
    console.error("Falha inconclusiva ao registrar metadados de arquivo; reconciliacao necessaria.");
    return { success: false, error: "Nao foi possivel confirmar o arquivo. Verifique a lista antes de reenviar." };
  }
  if (metadata.error) {
    const outcome = await reconcileFailedMetadata({
      rpcError: metadata.error,
      metadataForPath: () => admin.from("arquivos_paciente").select("id").eq("storage_path", path).maybeSingle(),
      cancelProof: () => admin.rpc("cancel_upload_attestation", { p_token_hash: tokenHash }),
      removeObject: () => storage.remove([path]),
    });
    if (outcome === "preserved") console.error("Falha inconclusiva ao registrar metadados de arquivo; reconciliacao necessaria.");
    return { success: false, error: "Você não tem permissão para este arquivo." };
  }
  revalidatePath(`/pacientes/${patientId}`); return { success: true, error: null };
}

export async function removePatientFile(_: DomainActionState, form: FormData): Promise<DomainActionState> {
  await requireUser(); const fileId = String(form.get("fileId") ?? ""); const s = await createSupabaseServerClient(); const { error } = await s.rpc("soft_delete_patient_file", { p_arquivo_id: fileId });
  if (error) return { success: false, error: "Não foi possível remover o arquivo." }; revalidatePath(`/pacientes/${String(form.get("patientId") ?? "")}`); return { success: true, error: null };
}
