import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { getAppointment, listActiveProfessionals } from "@/lib/agenda/queries";
import { getPatient } from "@/lib/patients/queries";
import { isValidUuid } from "@/lib/patients/validation";
import { AppointmentForm } from "../../AppointmentForm";

export default async function EditAppointmentPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (user.perfil === "dentista") redirect("/agenda");
  const { id } = await params;
  if (!isValidUuid(id)) notFound();
  const appointment = await getAppointment(id);
  if (!appointment || !["agendado", "confirmado"].includes(appointment.status)) notFound();
  const [professionals, patient] = await Promise.all([listActiveProfessionals(), getPatient(appointment.paciente_id)]);
  if (!patient) notFound();
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div><Link href="/agenda" className="mb-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><ChevronLeft className="h-3.5 w-3.5" /> Voltar para agenda</Link><h2 className="text-2xl font-medium">Editar ou remarcar</h2><p className="mt-0.5 text-sm text-muted-foreground">Ao alterar horário ou profissional, uma confirmação anterior volta para “agendado”.</p></div>
      <AppointmentForm professionals={professionals} appointment={appointment} patient={patient} />
    </div>
  );
}
