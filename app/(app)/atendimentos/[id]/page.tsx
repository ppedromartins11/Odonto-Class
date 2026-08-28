import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft, FilePenLine, Stethoscope } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { requireUser } from "@/lib/auth/session";
import { formatClinicDate, formatClinicTime } from "@/lib/agenda/dates";
import { getAttendance, listProcedures } from "@/lib/clinical/queries";
import { getPatient } from "@/lib/patients/queries";
import { isValidUuid } from "@/lib/patients/validation";
import { EvolutionEditor } from "../EvolutionEditor";
import { ProcedureForm } from "../ProcedureForm";
import { ReturnForm } from "../ReturnForm";

export default async function AttendancePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (user.perfil !== "dentista") redirect("/dashboard");
  const { id } = await params;
  if (!isValidUuid(id)) notFound();
  const attendance = await getAttendance(id);
  if (!attendance) notFound();
  const [patient, procedures] = await Promise.all([getPatient(attendance.paciente_id), listProcedures(id)]);
  if (!patient) notFound();
  const inProgress = attendance.status === "em_andamento";
  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div><Link href={`/pacientes/${patient.id}`} className="mb-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><ChevronLeft className="h-3.5 w-3.5" /> Voltar para o paciente</Link><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><Stethoscope className="h-5 w-5 text-primary" /><h2 className="text-2xl font-medium">Atendimento</h2><Badge tone={inProgress ? "warning" : "success"}>{inProgress ? "Em andamento" : "Finalizado"}</Badge></div><p className="mt-1 text-sm text-muted-foreground">{patient.nome} · {formatClinicDate(attendance.iniciado_em, { dateStyle: "short" })} às {formatClinicTime(attendance.iniciado_em)}</p></div></div></div>
      {inProgress ? <EvolutionEditor attendanceId={attendance.id} initialValue={attendance.evolucao} /> : (
        <section className="rounded-lg border border-border bg-card p-5"><h3 className="text-base font-medium">Evolução clínica</h3><p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-foreground">{attendance.evolucao}</p><p className="mt-4 text-xs text-muted-foreground">Finalizado em {attendance.finalizado_em ? `${formatClinicDate(attendance.finalizado_em, { dateStyle: "short" })} às ${formatClinicTime(attendance.finalizado_em)}` : "—"}. Registro preservado e imutável.</p></section>
      )}
      <section id="procedimentos" className="scroll-mt-24 rounded-lg border border-border bg-card p-5"><div className="mb-4"><h3 className="text-base font-medium">Procedimentos realizados</h3><p className="mt-1 text-xs text-muted-foreground">Sem catálogo, estoque ou cobrança automática nesta fase.</p></div>{procedures.length === 0 ? <p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">Nenhum procedimento registrado.</p> : <div className="space-y-3">{procedures.map((procedure) => <article key={procedure.id} className="rounded-md border border-border p-4"><div className="flex items-start justify-between gap-3"><div><h4 className="text-sm font-medium">{procedure.descricao}</h4><p className="mt-1 text-xs text-muted-foreground">{procedure.dente ? `Dente/região: ${procedure.dente}` : "Sem dente/região específica"}</p></div>{inProgress && <Link href={`/atendimentos/${attendance.id}/procedimentos/${procedure.id}/editar`} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"><FilePenLine className="h-3.5 w-3.5" /> Editar</Link>}</div>{procedure.material_utilizado && <p className="mt-2 text-xs"><span className="text-muted-foreground">Material:</span> {procedure.material_utilizado}</p>}{procedure.cor_resina && <p className="mt-1 text-xs"><span className="text-muted-foreground">Cor:</span> {procedure.cor_resina}</p>}{procedure.detalhes && <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">{procedure.detalhes}</p>}</article>)}</div>}</section>
      {inProgress && <section className="rounded-lg border border-border bg-card p-5"><h3 className="mb-4 text-base font-medium">Adicionar procedimento</h3><ProcedureForm attendanceId={attendance.id} /></section>}
      <section className="rounded-lg border border-border bg-card p-5"><h3 className="text-base font-medium">Indicar retorno</h3><p className="mt-1 text-xs text-muted-foreground">Cria um retorno pendente para a recepção agendar.</p><ReturnForm attendanceId={attendance.id} /></section>
    </div>
  );
}
