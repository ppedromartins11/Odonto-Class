import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isValidUuid } from "@/lib/patients/validation";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  const denied = () => new NextResponse(null, { status: 404, headers: { "Cache-Control": "private, no-store" } });
  if (!isValidUuid(id)) return denied();
  const supabase = await createSupabaseServerClient();
  // A RPC usa a sessao do solicitante e autoriza o binario, nao so a metadata.
  const { data: path, error } = await supabase.rpc("get_document_download_path", { p_documento_id: id });
  if (error || typeof path !== "string" || !path) return denied();
  const signed = await createSupabaseAdminClient().storage.from("arquivos-paciente").createSignedUrl(path, 300);
  if (signed.error || !signed.data?.signedUrl) return denied();
  return NextResponse.redirect(signed.data.signedUrl, { headers: { "Cache-Control": "private, no-store" } });
}
