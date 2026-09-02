import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getPatient } from "@/lib/patients/queries";
import { isValidUuid } from "@/lib/patients/validation";
import { listDocumentAuthorAttendances } from "@/lib/operational/queries";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { DocumentForm } from "../DocumentForm";

export default async function NewDocument({ searchParams }: { searchParams: Promise<{ paciente?: string }> }) {
  const user = await requireUser();
  const { paciente } = await searchParams;
  const patientId = paciente && isValidUuid(paciente) ? paciente : null;
  const [patient, attendances] = await Promise.all([
    patientId ? getPatient(patientId) : Promise.resolve(null),
    patientId ? listDocumentAuthorAttendances(patientId) : Promise.resolve([]),
  ]);
  const professionalIds = user.perfil === "administrador"
    ? [...new Set(attendances.map((attendance) => attendance.profissional_id))]
    : [];
  const supabase = await createSupabaseServerClient();
  const { data: professionals } = professionalIds.length
    ? await supabase.from("profissionais").select("id,usuario_id").in("id", professionalIds)
    : { data: [] as Array<{ id: string; usuario_id: string }> };
  const professionalUserIds = Object.fromEntries((professionals ?? []).map((professional) => [professional.id, professional.usuario_id]));
  if (paciente && !patient) notFound();
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div><h2 className="text-2xl font-medium">Novo documento oficial</h2><p className="mt-1 text-sm text-muted-foreground">Emita atestados ou prepare declarações vinculadas a um atendimento real e a um profissional com registro ativo.</p></div>
      <DocumentForm patient={patient} initialAttendances={attendances} profile={user.perfil} professionalUserIds={professionalUserIds} />
    </div>
  );
}
