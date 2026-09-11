import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ClipboardList, FileText, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { ToothChips } from "@/components/clinical/ToothChips";
import { requireUser } from "@/lib/auth/session";
import { formatClinicDate } from "@/lib/agenda/dates";
import { getBudget } from "@/lib/budgets/queries";
import { getPatient } from "@/lib/patients/queries";
import { isValidUuid } from "@/lib/patients/validation";
import { getTreatmentPlan } from "@/lib/treatments/queries";
import type { TreatmentPlanItemStatus, TreatmentPlanStatus } from "@/lib/treatments/types";
import { CancelTreatmentPlanAction } from "../TreatmentPlanActions";

const planLabel: Record<TreatmentPlanStatus, string> = { planejado: "Planejado", em_andamento: "Em andamento", concluido: "Concluído", cancelado: "Cancelado" };
const planTone: Record<TreatmentPlanStatus, "neutral" | "warning" | "success" | "danger"> = { planejado: "neutral", em_andamento: "warning", concluido: "success", cancelado: "danger" };
const itemLabel: Record<TreatmentPlanItemStatus, string> = { planejado: "Planejado", em_andamento: "Em andamento", realizado: "Realizado", cancelado: "Cancelado" };

export default async function TreatmentPlanPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  if (!isValidUuid(id)) notFound();
  const plan = await getTreatmentPlan(id, user);
  if (!plan) notFound();
  const [patient, budget] = await Promise.all([getPatient(plan.paciente_id), getBudget(plan.orcamento_id)]);
  if (!patient || !budget) notFound();
  const isDentist = user.perfil === "dentista";
  return <div className="mx-auto max-w-5xl space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <Link href={`/pacientes/${plan.paciente_id}?aba=tratamentos`} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"><ArrowLeft className="h-3.5 w-3.5" /> Voltar para o paciente</Link>
        <div className="mt-3 flex flex-wrap items-center gap-2"><h2 className="text-2xl font-medium">Plano de tratamento</h2><Badge tone={planTone[plan.status]}>{planLabel[plan.status]}</Badge></div>
        <p className="mt-1 text-sm text-muted-foreground">Criado em {formatClinicDate(plan.created_at, { dateStyle: "long" })}</p>
      </div>
      <CancelTreatmentPlanAction planId={plan.id} eligible={user.perfil === "administrador" && plan.status === "planejado"} />
    </div>
    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Link href={`/pacientes/${patient.id}`} className="rounded-lg border border-border bg-card p-4 hover:border-primary/40"><UserRound className="h-4 w-4 text-primary" /><p className="mt-3 text-xs text-muted-foreground">Paciente</p><p className="mt-1 font-medium">{patient.nome}</p></Link>
      <Link href={`/orcamentos/${budget.id}`} className="rounded-lg border border-border bg-card p-4 hover:border-primary/40"><FileText className="h-4 w-4 text-primary" /><p className="mt-3 text-xs text-muted-foreground">Orçamento de origem</p><p className="mt-1 font-medium">Orçamento #{budget.numero}</p></Link>
      <article className="rounded-lg border border-border bg-card p-4"><ClipboardList className="h-4 w-4 text-primary" /><p className="mt-3 text-xs text-muted-foreground">Progresso</p><p className="mt-1 font-medium">{plan.completed_items} de {plan.total_items} itens</p></article>
      <article className="rounded-lg border border-border bg-card p-4"><p className="text-xs text-muted-foreground">Conclusão</p><p className="mt-2 text-2xl font-semibold">{plan.progress_percent}%</p><div className="mt-3 h-2 overflow-hidden rounded-full bg-secondary"><div className="h-full rounded-full bg-primary" style={{ width: `${plan.progress_percent}%` }} /></div></article>
    </section>
    {isDentist ? <section className="rounded-lg border border-border bg-card p-5"><h3 className="text-base font-medium">Itens clínicos do plano</h3><p className="mt-1 text-xs text-muted-foreground">A execução é atualizada somente pelos procedimentos vinculados e pelo estado real do atendimento.</p>
      <div className="mt-4 space-y-3">{plan.clinical_items && plan.clinical_items.length > 0 ? plan.clinical_items.map((item) => <article key={item.id} className="rounded-md border border-border p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h4 className="font-medium">{item.descricao_snapshot}</h4><p className="mt-1 text-sm text-muted-foreground">Planejado: {item.quantidade_planejada} · Executado: {item.quantidade_executada} · Restante: {item.quantidade_restante}</p></div><Badge tone={item.status === "realizado" ? "success" : item.status === "cancelado" ? "danger" : item.status === "em_andamento" ? "warning" : "neutral"}>{itemLabel[item.status]}</Badge></div>
        {item.procedures.length > 0 && <div className="mt-3 space-y-2 border-t border-border pt-3">{item.procedures.map((procedure) => <div key={procedure.id} className="flex flex-wrap items-center justify-between gap-2 text-sm"><span>Procedimento: quantidade {procedure.quantidade}<ToothChips teeth={procedure.teeth} /></span><Link className="text-primary hover:underline" href={`/atendimentos/${procedure.atendimento_id}`}>Ver atendimento ({procedure.attendance_status === "finalizado" ? "finalizado" : "em andamento"})</Link></div>)}</div>}</article>) : <p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">Nenhum item clínico disponível.</p>}</div>
    </section> : <section className="rounded-lg border border-border bg-card p-5"><h3 className="text-base font-medium">Resumo administrativo</h3><p className="mt-2 text-sm text-muted-foreground">Este perfil visualiza somente a situação geral e o progresso do plano. Os detalhes clínicos permanecem protegidos.</p></section>}
  </div>;
}
