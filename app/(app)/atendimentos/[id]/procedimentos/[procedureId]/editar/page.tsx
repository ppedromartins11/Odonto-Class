import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getAttendance, getProcedure } from "@/lib/clinical/queries";
import { isValidUuid } from "@/lib/patients/validation";
import { ProcedureForm } from "../../../../ProcedureForm";

export default async function EditProcedurePage({ params }: { params: Promise<{ id: string; procedureId: string }> }) {
  const user = await requireUser();
  if (user.perfil !== "dentista") redirect("/dashboard");
  const { id, procedureId } = await params;
  if (!isValidUuid(id) || !isValidUuid(procedureId)) notFound();
  const [attendance, procedure] = await Promise.all([getAttendance(id), getProcedure(procedureId)]);
  if (!attendance || !procedure || procedure.atendimento_id !== attendance.id || attendance.status !== "em_andamento") notFound();
  return <div className="mx-auto max-w-3xl space-y-5"><div><h2 className="text-2xl font-medium">Editar procedimento</h2><p className="mt-1 text-sm text-muted-foreground">Alterações são auditadas sem copiar o conteúdo clínico.</p></div><section className="rounded-lg border border-border bg-card p-5"><ProcedureForm attendanceId={attendance.id} procedure={procedure} /></section></div>;
}
