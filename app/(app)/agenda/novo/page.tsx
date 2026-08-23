import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { addDays, normalizeDateKey, todayInClinic } from "@/lib/agenda/dates";
import { listActiveProfessionals } from "@/lib/agenda/queries";
import { getPatient } from "@/lib/patients/queries";
import { isValidUuid } from "@/lib/patients/validation";
import { AppointmentForm } from "../AppointmentForm";

type SearchParams = Promise<{ data?: string | string[]; paciente?: string | string[]; retorno?: string | string[] }>;
const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;

export default async function NewAppointmentPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();
  if (user.perfil === "dentista") redirect("/agenda");
  const params = await searchParams;
  let date = normalizeDateKey(first(params.data));
  if (date < todayInClinic()) date = addDays(todayInClinic(), 1);
  const patientId = first(params.paciente);
  const [professionals, patient] = await Promise.all([
    listActiveProfessionals(),
    patientId && isValidUuid(patientId) ? getPatient(patientId) : Promise.resolve(null),
  ]);
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div><Link href="/agenda" className="mb-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><ChevronLeft className="h-3.5 w-3.5" /> Voltar para agenda</Link><h2 className="text-2xl font-medium">Novo agendamento</h2><p className="mt-0.5 text-sm text-muted-foreground">Selecione paciente, profissional e intervalo.</p></div>
      <AppointmentForm professionals={professionals} patient={patient} defaultStart={`${date}T09:00`} defaultEnd={`${date}T10:00`} returnId={first(params.retorno) ?? null} />
    </div>
  );
}
