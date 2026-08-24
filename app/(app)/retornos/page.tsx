import Link from "next/link";
import { CalendarPlus, CheckCircle2, CircleDashed, Clock3, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { requireUser } from "@/lib/auth/session";
import { formatClinicDate, todayInClinic } from "@/lib/agenda/dates";
import { listReturns } from "@/lib/operational/queries";
import type { OperationalReturn, ReturnStatus } from "@/lib/operational/types";
import { ReturnStatusActions } from "./ReturnStatusActions";

type SearchParams = Promise<{ status?: string | string[] }>;

const STATUS: Record<ReturnStatus, { label: string; tone: "info" | "success" | "neutral" | "danger" }> = {
  pendente: { label: "Pendente", tone: "info" },
  agendado: { label: "Agendado", tone: "neutral" },
  concluido: { label: "Concluído", tone: "success" },
  cancelado: { label: "Cancelado", tone: "danger" },
};

const FILTERS: { value: "todos" | ReturnStatus; label: string }[] = [
  { value: "todos", label: "Todos" },
  { value: "pendente", label: "Pendentes" },
  { value: "agendado", label: "Agendados" },
  { value: "concluido", label: "Concluídos" },
  { value: "cancelado", label: "Cancelados" },
];

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function isStatus(value: string | undefined): value is ReturnStatus {
  return value === "pendente" || value === "agendado" || value === "concluido" || value === "cancelado";
}

function isOverdue(item: OperationalReturn) {
  return item.status === "pendente" && item.data_prevista < todayInClinic();
}

function SummaryCard({ label, value, icon: Icon, tone = "text-primary" }: { label: string; value: number; icon: typeof CircleDashed; tone?: string }) {
  return <div className="rounded-lg border border-border bg-card p-4 shadow-sm"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-semibold text-foreground">{value}</p></div><Icon className={`h-5 w-5 ${tone}`} /></div></div>;
}

export default async function ReturnsPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();
  const selected = first((await searchParams).status);
  const status = isStatus(selected) ? selected : "todos";
  const returns = await listReturns();
  const visible = status === "todos" ? returns : returns.filter((item) => item.status === status);
  const counts = {
    pendente: returns.filter((item) => item.status === "pendente").length,
    agendado: returns.filter((item) => item.status === "agendado").length,
    concluido: returns.filter((item) => item.status === "concluido").length,
    atrasado: returns.filter(isOverdue).length,
  };
  const canManage = user.perfil === "administrador" || user.perfil === "recepcao";

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div>
        <h2 className="text-2xl font-medium text-foreground">Retornos</h2>
        <p className="mt-1 text-sm text-muted-foreground">Acompanhe pacientes que precisam retornar, agende novos horários e finalize pendências.</p>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Resumo de retornos">
        <SummaryCard label="Pendentes" value={counts.pendente} icon={CircleDashed} />
        <SummaryCard label="Agendados" value={counts.agendado} icon={CalendarPlus} tone="text-slate-500" />
        <SummaryCard label="Concluídos" value={counts.concluido} icon={CheckCircle2} tone="text-emerald-600" />
        <SummaryCard label="Atrasados" value={counts.atrasado} icon={Clock3} tone="text-amber-600" />
      </section>

      <nav className="flex flex-wrap gap-2" aria-label="Filtrar retornos por status">
        {FILTERS.map((filter) => <Link key={filter.value} href={filter.value === "todos" ? "/retornos" : `/retornos?status=${filter.value}`} className={`rounded-md px-3 py-1.5 text-sm font-medium ${status === filter.value ? "bg-primary text-primary-foreground" : "border border-border bg-card text-muted-foreground hover:bg-secondary"}`}>{filter.label}</Link>)}
      </nav>

      {visible.length === 0 ? (
        <section className="rounded-xl border border-dashed border-border bg-card px-6 py-12 text-center">
          <CalendarPlus className="mx-auto h-8 w-8 text-muted-foreground/60" />
          <h3 className="mt-3 text-base font-medium text-foreground">{status === "todos" ? "Nenhum retorno pendente" : "Nenhum retorno neste filtro"}</h3>
          <p className="mt-1 text-sm text-muted-foreground">Retornos são criados a partir do atendimento e ficam disponíveis aqui para acompanhamento.</p>
        </section>
      ) : (
        <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          <div className="divide-y divide-border">
            {visible.map((item) => {
              const visualStatus = STATUS[item.status];
              const overdue = isOverdue(item);
              return (
                <article key={item.id} className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/pacientes/${item.paciente_id}`} className="inline-flex items-center gap-1.5 font-semibold text-foreground hover:text-primary"><UserRound className="h-4 w-4 text-primary" />{item.paciente_nome}</Link>
                      <Badge tone={visualStatus.tone}>{visualStatus.label}</Badge>
                      {overdue && <Badge tone="warning">Atrasado</Badge>}
                    </div>
                    <p className="text-sm text-muted-foreground">Previsto para <span className="font-medium text-foreground">{formatClinicDate(item.data_prevista, { day: "2-digit", month: "long", year: "numeric" })}</span>{item.profissional_nome ? ` · ${item.profissional_nome}` : ""}</p>
                    <p className="text-xs text-muted-foreground">{item.atendimento_origem_id ? "Originado em atendimento" : "Origem não disponível"}{item.observacao_administrativa ? ` · ${item.observacao_administrativa}` : ""}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                    <Link href={`/pacientes/${item.paciente_id}`} className="rounded-md px-2.5 py-1.5 text-xs font-medium text-primary hover:bg-accent">Abrir paciente</Link>
                    {canManage && item.status === "pendente" && <Link href={`/agenda/novo?paciente=${item.paciente_id}&retorno=${item.id}`} className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"><CalendarPlus className="h-3.5 w-3.5" /> Agendar retorno</Link>}
                    {canManage && <ReturnStatusActions returnId={item.id} status={item.status} />}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
