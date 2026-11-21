import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { addDays, normalizeDateKey, todayInClinic } from "@/lib/agenda/dates";
import { getReturnForScheduling, listActiveProfessionals } from "@/lib/agenda/queries";
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
  const returnId = first(params.retorno);
  if (returnId && !isValidUuid(returnId)) notFound();
  const linkedReturn = returnId ? await getReturnForScheduling(returnId) : null;
  if (returnId && !linkedReturn) notFound();
  if (linkedReturn && (linkedReturn.status !== "pendente" || linkedReturn.agendamento_id)) {
    return <div className="mx-auto max-w-3xl space-y-4 rounded-lg border bg-card p-6">
      <h1 className="text-xl font-medium">Retorno já processado</h1>
      <p className="text-sm text-muted-foreground">{linkedReturn.status === "agendado" ? "Este retorno já possui um agendamento." : "Este retorno não está pendente para agendamento."}</p>
      <div className="flex flex-wrap gap-3 text-sm">
        {linkedReturn.agendamento_id && <Link href={`/agenda/${linkedReturn.agendamento_id}/editar`} className="rounded border px-3 py-2 font-medium">Abrir consulta vinculada</Link>}
        <Link href="/retornos" className="rounded border px-3 py-2">Ver retornos</Link>
      </div>
    </div>;
  }
  const patientId = linkedReturn?.paciente_id ?? first(params.paciente);
  const [professionals, patient] = await Promise.all([
    listActiveProfessionals(),
    patientId && isValidUuid(patientId) ? getPatient(patientId) : Promise.resolve(null),
  ]);
  if (linkedReturn && !patient) notFound();
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div><Link href="/agenda" className="mb-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><ChevronLeft className="h-3.5 w-3.5" /> Voltar para agenda</Link><h1 className="text-2xl font-medium">Novo agendamento</h1><p className="mt-0.5 text-sm text-muted-foreground">Selecione paciente, profissional e intervalo.</p></div>
      <AppointmentForm key={`${returnId ?? "none"}:${patientId ?? "none"}`} professionals={professionals} patient={patient} defaultStart={`${date}T09:00`} defaultEnd={`${date}T10:00`} returnId={returnId ?? null} requestId={randomUUID()} />
    </div>
  );
}
