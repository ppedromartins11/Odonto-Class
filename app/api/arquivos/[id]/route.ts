import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireUser(); const { id } = await params; const s = await createSupabaseServerClient();
  const { data, error } = await s.from("arquivos_paciente").select("storage_path").eq("id", id).eq("status", "ativo").maybeSingle();
  if (error || !data) return new NextResponse(null, { status: 404 });
  const signed = await createSupabaseAdminClient().storage.from("arquivos-paciente").createSignedUrl(data.storage_path, 300);
  if (signed.error || !signed.data.signedUrl) return new NextResponse(null, { status: 404 });
  return NextResponse.redirect(signed.data.signedUrl, { headers: { "Cache-Control": "private, no-store" } });
}
