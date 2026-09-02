import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isValidUuid } from "@/lib/patients/validation";

export async function GET(_: Request, { params }: { params: Promise<{ id: string; versionId: string }> }) {
  await requireUser();
  const { id, versionId } = await params;
  if (!isValidUuid(id) || !isValidUuid(versionId)) return new NextResponse(null, { status: 404 });
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("orcamento_pdf_versoes").select("storage_path,versao").eq("id", versionId).eq("orcamento_id", id).maybeSingle();
  if (error || !data) return new NextResponse(null, { status: 404 });
  const signed = await createSupabaseAdminClient().storage.from("arquivos-paciente").createSignedUrl(data.storage_path, 300, { download: `orcamento-versao-${data.versao}.pdf` });
  if (signed.error || !signed.data.signedUrl) return new NextResponse(null, { status: 404 });
  return NextResponse.redirect(signed.data.signedUrl, { headers: { "Cache-Control": "private, no-store" } });
}

