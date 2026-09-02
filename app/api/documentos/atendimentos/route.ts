import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/session";
import { isValidUuid } from "@/lib/patients/validation";
import { listDocumentAuthorAttendances } from "@/lib/operational/queries";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const user = await requireUser();
  const patientId = new URL(request.url).searchParams.get("paciente") ?? "";
  if (!isValidUuid(patientId)) return NextResponse.json({ attendances: [] }, { status: 400 });
  const attendances = await listDocumentAuthorAttendances(patientId);
  const professionalIds = user.perfil === "administrador"
    ? [...new Set(attendances.map((attendance) => attendance.profissional_id))]
    : [];
  const supabase = await createSupabaseServerClient();
  const { data: professionals } = professionalIds.length
    ? await supabase.from("profissionais").select("id,usuario_id").in("id", professionalIds)
    : { data: [] as Array<{ id: string; usuario_id: string }> };
  const professionalUserIds = Object.fromEntries(
    (professionals ?? []).map((professional) => [professional.id, professional.usuario_id])
  );

  return NextResponse.json(
    { attendances, professionalUserIds },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}
