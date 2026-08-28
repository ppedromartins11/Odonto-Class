import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarPlus, CheckCircle2, CircleDashed, Clock3, Search, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { requireUser } from "@/lib/auth/session";
import { formatClinicDate, todayInClinic } from "@/lib/agenda/dates";
import { getReturnSummary, listReturnsPage } from "@/lib/operational/queries";
import type { OperationalReturn, ReturnStatus } from "@/lib/operational/types";
import { ReturnStatusActions } from "./ReturnStatusActions";

type SearchParams = Promise<{ filtro?: string | string[]; q?: string | string[]; page?: string | string[] }>;
type ReturnFilter = "todos" | ReturnStatus | "atrasados";

const STATUS: Record<ReturnStatus, { label: string; tone: "info" | "success" | "neutral" | "danger" }> = {
  pendente: { label: "Pendente", tone: "info" },
  agendado: { label: "Agendado", tone: "neutral" },
  concluido: { label: "Concluído", tone: "success" },
  cancelado: { label: "Cancelado", tone: "danger" },
};

const FILTERS: { value: ReturnFilter; label: string }[] = [
  { value: "todos", label: "Todos" },
  { value: "pendente", label: "Pendentes" },
  { value: "agendado", label: "Agendados" },
  { value: "concluido", label: "Concluídos" },
  { value: "cancelado", label: "Cancelados" },
  { value: "atrasados", label: "Atrasados" },
];

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function isFilter(value: string | undefined): value is ReturnFilter {
  return value === "todos" || value === "pendente" || value === "agendado" || value === "concluido" || value === "cancelado" || value === "atrasados";
}

function pageNumber(value: string | undefined) {
  const page = Number(value);
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}

function returnHref({ filter, query, page = 1 }: { filter: ReturnFilter; query: string; page?: number }) {
  const params = new URLSearchParams();
  if (filter !== "todos") params.set("filtro", filter);
  if (query) params.set("q", query);
  if (page > 1) params.set("page", String(page));
  const search = params.toString();
  return search ? `/retornos?${search}` : "/retornos";
}

function isOverdue(item: OperationalReturn) {
  return item.status === "pendente" && item.data_prevista < todayInClinic();
}

function SummaryCard({ label, value, icon: Icon, tone = "text-primary" }: { label: string; value: number; icon: typeof CircleDashed; tone?: string }) {
  return <div className="rounded-lg border border-border bg-card p-4 shadow-sm"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-semibold text-foreground">{value}</p></div><Icon className={`h-5 w-5 ${tone}`} /></div></div>;
}

export default async function ReturnsPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();
  const params = await searchParams;
  const candidateFilter = first(params.filtro);
  const filter = isFilter(candidateFilter) ? candidateFilter : "todos";
  const query = (first(params.q) ?? "").trim().slice(0, 100);
  const requestedPage = pageNumber(first(params.page));
  const today = todayInClinic();
  const [result, counts] = await Promise.all([
    listReturnsPage({
      query,
      status: filter === "todos" || filter === "atrasados" ? undefined : filter,
      overdue: filter === "atrasados",
      page: requestedPage,
      today,
    }),
    getReturnSummary(today),
  ]);
  const totalPages = Math.max(1, Math.ceil(result.total / result.pageSize));
  if (requestedPage > totalPages) redirect(returnHref({ filter, query, page: totalPages }));
  const page = Math.min(requestedPage, totalPages);
  const canManage = user.perfil === "administrador" || user.perfil === "recepcao";

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div>
        <h2 className="text-2xl font-medium text-foreground">Retornos</h2>
        <p className="mt-1 text-sm text-muted-foreground">Acompanhe pacientes que precisam retornar, agende novos horários e finalize pendências.</p>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Resumo de retornos">
        <SummaryCard label="Pendentes" value={counts.pending} icon={CircleDashed} />
        <SummaryCard label="Agendados" value={counts.scheduled} icon={CalendarPlus} tone="text-slate-500" />
        <SummaryCard label="Concluídos" value={counts.completed} icon={CheckCircle2} tone="text-emerald-600" />
        <SummaryCard label="Atrasados" value={counts.overdue} icon={Clock3} tone="text-amber-600" />
      </section>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <nav className="flex flex-wrap gap-2" aria-label="Filtrar retornos">
          {FILTERS.map((item) => <Link key={item.value} href={returnHref({ filter: item.value, query })} className={`rounded-md px-3 py-1.5 text-sm font-medium ${filter === item.value ? "bg-primary text-primary-foreground" : "border border-border bg-card text-muted-foreground hover:bg-secondary"}`}>{item.label}</Link>)}
        </nav>
        <form className="relative w-full sm:w-72">
          {filter !== "todos" && <input type="hidden" name="filtro" value={filter} />}
          <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input name="q" defaultValue={query} maxLength={100} placeholder="Buscar por paciente" aria-label="Buscar retorno por paciente" className="h-9 w-full rounded-md border border-border bg-card pl-9 pr-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/10" />
        </form>
      </div>

      {result.returns.length === 0 ? (
        <section className="rounded-xl border border-dashed border-border bg-card px-6 py-12 text-center">
          <CalendarPlus className="mx-auto h-8 w-8 text-muted-foreground/60" />
          <h3 className="mt-3 text-base font-medium text-foreground">{query ? "Nenhum retorno para esta busca" : filter === "todos" ? "Nenhum retorno encontrado" : "Nenhum retorno neste filtro"}</h3>
          <p className="mt-1 text-sm text-muted-foreground">Retornos são criados a partir do atendimento e ficam disponíveis aqui para acompanhamento.</p>
        </section>
      ) : (
        <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          <div className="divide-y divide-border">
            {result.returns.map((item) => {
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
          {result.total > result.pageSize && <nav className="flex items-center justify-between border-t border-border px-4 py-3 text-sm" aria-label="Paginação de retornos"><span className="text-muted-foreground">Página {page} de {totalPages} · {result.total} retornos</span><div className="flex gap-2">{page > 1 && <Link href={returnHref({ filter, query, page: page - 1 })} className="rounded-md border border-border px-3 py-1.5 font-medium hover:bg-secondary">Anterior</Link>}{page < totalPages && <Link href={returnHref({ filter, query, page: page + 1 })} className="rounded-md border border-border px-3 py-1.5 font-medium hover:bg-secondary">Próxima</Link>}</div></nav>}
        </section>
      )}
    </div>
  );
}
