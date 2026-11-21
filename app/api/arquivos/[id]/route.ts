import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isValidUuid } from "@/lib/patients/validation";
import { legacyFilePathBelongsToPatient, PATIENT_STORAGE_BUCKET, storedObjectMatchesPath } from "@/lib/operational/storage-integrity";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  const denied = () => new NextResponse(null, { status: 404, headers: { "Cache-Control": "private, no-store" } });
  if (!isValidUuid(id)) return denied();
  const s = await createSupabaseServerClient();
  const { data, error } = await s.from("arquivos_paciente").select("paciente_id,storage_path").eq("id", id).eq("status", "ativo").maybeSingle();
  if (error || !data || typeof data.storage_path !== "string" || typeof data.paciente_id !== "string" ||
    !legacyFilePathBelongsToPatient(data.storage_path, data.paciente_id)) return denied();
  try {
    const storage = createSupabaseAdminClient().storage.from(PATIENT_STORAGE_BUCKET);
    const info = await storage.info(data.storage_path);
    if (info.error || !storedObjectMatchesPath(info.data, data.storage_path)) return denied();
    const signed = await storage.createSignedUrl(data.storage_path, 300);
    if (signed.error || !signed.data?.signedUrl) return denied();
    return NextResponse.redirect(signed.data.signedUrl, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return denied();
  }
}
