"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { safeUpload } from "@/lib/operational/validation";
import type { DomainActionState } from "@/lib/operational/types";

export async function uploadPatientFile(_: DomainActionState, form: FormData): Promise<DomainActionState> {
  await requireUser();
  const patientId = String(form.get("patientId") ?? ""); const category = String(form.get("category") ?? ""); const file = form.get("file");
  if (!(file instanceof File) || !patientId) return { success: false, error: "Selecione um arquivo e paciente válidos." };
  const buffer = Buffer.from(await file.arrayBuffer()); const validated = safeUpload(file, buffer, category); if (!validated.ok) return { success: false, error: validated.error };
  const path = `${patientId}/${randomUUID()}.${validated.extension}`; const admin = createSupabaseAdminClient();
  const upload = await admin.storage.from("arquivos-paciente").upload(path, buffer, { contentType: file.type, upsert: false });
  if (upload.error) return { success: false, error: "Não foi possível enviar o arquivo." };
  const s = await createSupabaseServerClient(); const metadata = await s.rpc("create_patient_file_metadata", { p_paciente_id: patientId, p_storage_path: path, p_nome_original: file.name, p_mime_type: file.type, p_tamanho_bytes: file.size, p_categoria: validated.category });
  if (metadata.error) { await admin.storage.from("arquivos-paciente").remove([path]); return { success: false, error: "Você não tem permissão para este arquivo." }; }
  revalidatePath(`/pacientes/${patientId}`); return { success: true, error: null };
}

export async function removePatientFile(_: DomainActionState, form: FormData): Promise<DomainActionState> {
  await requireUser(); const fileId = String(form.get("fileId") ?? ""); const s = await createSupabaseServerClient(); const { error } = await s.rpc("soft_delete_patient_file", { p_arquivo_id: fileId });
  if (error) return { success: false, error: "Não foi possível remover o arquivo." }; revalidatePath(`/pacientes/${String(form.get("patientId") ?? "")}`); return { success: true, error: null };
}
