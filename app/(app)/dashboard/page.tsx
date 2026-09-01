import Link from "next/link";
import { AlertTriangle, ArrowRight, CalendarDays, CheckSquare, Clock3, DollarSign, RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { requireUser } from "@/lib/auth/session";
import { addDays, formatClinicDate, formatClinicTime, todayInClinic } from "@/lib/agenda/dates";
import { listActiveProfessionals, listAgenda } from "@/lib/agenda/queries";
import type { AppointmentStatus } from "@/lib/agenda/types";
import { getDashboardOperationalData } from "@/lib/operational/queries";
import type { ReturnStatus, TaskStatus } from "@/lib/operational/types";
import { getPaymentSummary } from "@/lib/financial/queries";
import { formatCents } from "@/lib/financial/validation";
import { getStockSummary } from "@/lib/stock/queries";
import { getValiditySterilizationSummary } from "@/lib/validity/queries";

const APPOINTMENT_STATUS: Record<AppointmentStatus, { label: string; tone: "info" | "success" | "neutral" | "danger" | "warning" }> = {
  agendado: { label: "Agendado", tone: "info" },
  confirmado: { label: "Confirmado", tone: "success" },
  atendido: { label: "Atendido", tone: "neutral" },
  cancelado: { label: "Cancelado", tone: "danger" },
  faltou: { label: "Faltou", tone: "warning" },
};

const RETURN_STATUS: Record<ReturnStatus, { label: string; tone: "info" | "success" | "neutral" | "danger" }> = {
  pendente: { label: "Pendente", tone: "info" },
  agendado: { label: "Agendado", tone: "neutral" },
  concluido: { label: "Concluído", tone: "success" },
  cancelado: { label: "Cancelado", tone: "danger" },
};

const TASK_STATUS: Record<TaskStatus, { label: string; tone: "info" | "success" | "danger" }> = {
  pendente: { label: "Pendente", tone: "info" },
  em_andamento: { label: "Em andamento", tone: "info" },
  concluida: { label: "Concluída", tone: "success" },
  cancelada: { label: "Cancelada", tone: "danger" },
};

function greetingForNow() {
  const hour = Number(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Cuiaba", hour: "2-digit", hour12: false }).format(new Date()));
  if (hour < 12) return "Bom dia";
  if (hour < 18) return "Boa tarde";
  return "Boa noite";
}

function MetricCard({ label, value, description, icon: Icon, tone = "text-primary" }: { label: string; value: number; description: string; icon: typeof CalendarDays; tone?: string }) {
  return <div className="rounded-xl border border-border bg-card p-4 shadow-sm"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-semibold text-foreground">{value}</p><p className="mt-1 text-xs text-muted-foreground">{description}</p></div><Icon className={`h-5 w-5 ${tone}`} /></div></div>;
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return <p className="px-1 py-6 text-sm text-muted-foreground">{children}</p>;
}

async function loadDashboardStockSummary(enabled: boolean) {
  if (!enabled) return { summary: null, unavailable: false };
  try {
    return { summary: await getStockSummary(), unavailable: false };
  } catch {
    console.error("DASHBOARD_STOCK_SUMMARY_UNAVAILABLE");
    return { summary: null, unavailable: true };
  }
}

async function loadDashboardValiditySummary(enabled: boolean) {
  if (!enabled) return { summary: null, unavailable: false };
  try {
    return { summary: await getValiditySterilizationSummary(), unavailable: false };
  } catch {
    console.error("DASHBOARD_VALIDITY_SUMMARY_UNAVAILABLE");
    return { summary: null, unavailable: true };
  }
}

export default async function DashboardPage() {
  const user = await requireUser();
  const today = todayInClinic();
  const ownProfessional = user.perfil === "dentista"
    ? (await listActiveProfessionals()).find((professional) => professional.usuario_id === user.id)
    : undefined;
  const professionalId = user.perfil === "dentista" ? ownProfessional?.id ?? null : null;
  const [appointments, operational, financialSummary, stock, validity] = await Promise.all([
    user.perfil === "dentista" && !professionalId ? Promise.resolve([]) : listAgenda({ startDate: today, endDate: addDays(today, 1), professionalId }),
    getDashboardOperationalData(today),
    user.perfil === "administrador" ? getPaymentSummary(`${today.slice(0, 7)}-01`, today) : Promise.resolve(null),
    loadDashboardStockSummary(user.perfil === "administrador" || user.perfil === "recepcao"),
    loadDashboardValiditySummary(user.perfil === "administrador" || user.perfil === "recepcao"),
  ]);
  const stockSummary = stock.summary;
  const validitySummary = validity.summary;
  const { pendingTasks, pendingTaskCount, overdueTaskCount, relevantReturns, pendingReturnCount, overdueReturnCount } = operational;
  const todayAppointments = [...appointments].sort((a, b) => a.inicio.localeCompare(b.inicio));
  const notConfirmed = todayAppointments.filter((item) => item.status === "agendado");
  const alerts = [
    overdueTaskCount ? { id: "tasks", text: `${overdueTaskCount} ${overdueTaskCount === 1 ? "tarefa está" : "tarefas estão"} com prazo vencido`, href: "/tarefas" } : null,
    overdueReturnCount ? { id: "returns", text: `${overdueReturnCount} ${overdueReturnCount === 1 ? "retorno está" : "retornos estão"} atrasado${overdueReturnCount === 1 ? "" : "s"}`, href: "/retornos" } : null,
    notConfirmed.length ? { id: "appointments", text: `${notConfirmed.length} ${notConfirmed.length === 1 ? "consulta de hoje aguarda" : "consultas de hoje aguardam"} confirmação`, href: "/agenda" } : null,
  ].filter((alert): alert is { id: string; text: string; href: string } => Boolean(alert));
  if (stock.unavailable) alerts.push({ id: "stock-unavailable", text: "Os alertas de estoque não puderam ser carregados. Consulte o módulo de Estoque.", href: "/estoque" });
  if (stockSummary?.estoque_baixo) alerts.push({ id: "stock-low", text: `${stockSummary.estoque_baixo} ${stockSummary.estoque_baixo === 1 ? "material está" : "materiais estão"} com estoque baixo`, href: "/estoque?status=estoque_baixo" });
  if (stockSummary?.vencendo) alerts.push({ id: "stock-expiring", text: `${stockSummary.vencendo} ${stockSummary.vencendo === 1 ? "material vence" : "materiais vencem"} em até 30 dias`, href: "/estoque?status=vencendo" });
  if (stockSummary?.vencidos) alerts.push({ id: "stock-expired", text: `${stockSummary.vencidos} ${stockSummary.vencidos === 1 ? "material vencido" : "materiais vencidos"}`, href: "/estoque?status=vencido" });
  if (validity.unavailable) alerts.push({ id: "validity-unavailable", text: "Os alertas de lotes e esterilização não puderam ser carregados.", href: "/validade" });
  if (validitySummary?.lotes_vencendo) alerts.push({ id: "lots-expiring", text: `${validitySummary.lotes_vencendo} ${validitySummary.lotes_vencendo === 1 ? "lote vence" : "lotes vencem"} em até 30 dias`, href: "/validade?status=proximo_do_vencimento" });
  if (validitySummary?.lotes_vencidos) alerts.push({ id: "lots-expired", text: `${validitySummary.lotes_vencidos} ${validitySummary.lotes_vencidos === 1 ? "lote vencido" : "lotes vencidos"}`, href: "/validade?status=vencido" });
  if (validitySummary?.pacotes_vencendo) alerts.push({ id: "packages-expiring", text: `${validitySummary.pacotes_vencendo} ${validitySummary.pacotes_vencendo === 1 ? "pacote esterilizado vence" : "pacotes esterilizados vencem"} em até 30 dias`, href: "/esterilizacao?pacote=proximo_do_vencimento" });
  if (validitySummary?.pacotes_vencidos) alerts.push({ id: "packages-expired", text: `${validitySummary.pacotes_vencidos} ${validitySummary.pacotes_vencidos === 1 ? "pacote esterilizado vencido" : "pacotes esterilizados vencidos"}`, href: "/esterilizacao?pacote=vencido" });
  if (validitySummary?.ciclos_reprovados) alerts.push({ id: "cycles-rejected", text: `${validitySummary.ciclos_reprovados} ${validitySummary.ciclos_reprovados === 1 ? "ciclo foi reprovado" : "ciclos foram reprovados"} nos últimos 30 dias`, href: "/esterilizacao?ciclo=reprovado" });
  const firstName = user.nome.split(" ")[0] || user.nome;
  const canManageAppointments = user.perfil === "administrador" || user.perfil === "recepcao";

  return <div className="mx-auto max-w-7xl space-y-5"><header><h2 className="text-2xl font-medium text-foreground">{greetingForNow()}, {firstName} <span aria-hidden="true">👋</span></h2><p className="mt-1 text-sm text-muted-foreground">Acompanhe a rotina da clínica hoje.</p></header><section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Resumo operacional"><MetricCard label="Consultas hoje" value={todayAppointments.length} description="Agendamentos do dia" icon={CalendarDays} /><MetricCard label="Tarefas pendentes" value={pendingTaskCount} description="Aguardam conclusão" icon={CheckSquare} tone="text-violet-600" /><MetricCard label="Retornos pendentes" value={pendingReturnCount} description="Precisam de acompanhamento" icon={RotateCcw} tone="text-amber-600" /><MetricCard label="Não confirmadas" value={notConfirmed.length} description="Consultas de hoje" icon={Clock3} tone="text-slate-500" /></section><section className="grid gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(19rem,1fr)]"><div className="rounded-xl border border-border bg-card shadow-sm"><div className="flex items-center justify-between border-b border-border px-5 py-4"><div><h3 className="font-medium text-foreground">Agenda de hoje</h3><p className="mt-0.5 text-xs text-muted-foreground">{formatClinicDate(today, { weekday: "long", day: "2-digit", month: "long" })}</p></div><Link href="/agenda" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">Ver agenda completa <ArrowRight className="h-3.5 w-3.5" /></Link></div>{todayAppointments.length === 0 ? <div className="px-5 py-6"><EmptyState>Nenhuma consulta agendada para hoje.</EmptyState>{canManageAppointments && <Link href={`/agenda/novo?data=${today}`} className="inline-flex h-9 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90">Novo agendamento</Link>}</div> : <div className="divide-y divide-border">{todayAppointments.slice(0, 6).map((appointment) => { const status = APPOINTMENT_STATUS[appointment.status]; return <article key={appointment.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5"><p className="w-24 text-sm font-semibold text-foreground">{formatClinicTime(appointment.inicio)}</p><div className="min-w-[12rem] flex-1"><Link href={`/pacientes/${appointment.paciente_id}`} className="font-medium text-foreground hover:text-primary">{appointment.paciente_nome}</Link><p className="mt-0.5 text-xs text-muted-foreground">{appointment.profissional_nome}{appointment.observacoes_administrativas ? ` · ${appointment.observacoes_administrativas}` : ""}</p></div><Badge tone={status.tone}>{status.label}</Badge></article>; })}</div>}</div><div className="space-y-5">{financialSummary && <section className="rounded-xl border border-border bg-card shadow-sm"><div className="flex items-center justify-between border-b border-border px-5 py-4"><div className="flex items-center gap-2"><DollarSign className="h-4 w-4 text-emerald-600" /><h3 className="font-medium text-foreground">Financeiro</h3></div><Link href="/financeiro" className="text-sm font-medium text-primary hover:underline">Ver pagamentos</Link></div><div className="p-5"><p className="text-xs text-muted-foreground">Recebido hoje</p><p className="mt-1 text-2xl font-semibold text-foreground">{formatCents(financialSummary.recebido_hoje_centavos)}</p><div className="mt-4 grid grid-cols-2 gap-3 border-t border-border pt-3 text-sm"><div><p className="text-xs text-muted-foreground">No período</p><p className="mt-1 font-medium">{formatCents(financialSummary.recebido_periodo_centavos)}</p></div><div><p className="text-xs text-muted-foreground">Pagamentos pagos</p><p className="mt-1 font-medium">{financialSummary.quantidade_pagamentos}</p></div></div>{financialSummary.quantidade_pagamentos === 0 && <p className="mt-3 text-xs text-muted-foreground">Nenhum pagamento recebido no período.</p>}</div></section>}<section className="rounded-xl border border-border bg-card shadow-sm"><div className="flex items-center justify-between border-b border-border px-5 py-4"><h3 className="font-medium text-foreground">Retornos</h3><Link href="/retornos" className="text-sm font-medium text-primary hover:underline">Ver retornos</Link></div>{relevantReturns.length === 0 ? <EmptyState>Nenhum retorno pendente.</EmptyState> : <div className="divide-y divide-border">{relevantReturns.map((item) => { const status = RETURN_STATUS[item.status]; return <div key={item.id} className="px-5 py-3"><div className="flex items-center justify-between gap-2"><Link href={`/pacientes/${item.paciente_id}`} className="min-w-0 truncate text-sm font-medium text-foreground hover:text-primary">{item.paciente_nome}</Link><Badge tone={status.tone}>{status.label}</Badge></div><p className="mt-1 text-xs text-muted-foreground">Previsto para {formatClinicDate(item.data_prevista, { day: "2-digit", month: "short" })}</p></div>; })}</div>}</section><section className="rounded-xl border border-border bg-card shadow-sm"><div className="border-b border-border px-5 py-4"><h3 className="font-medium text-foreground">Alertas operacionais</h3></div>{alerts.length === 0 ? <EmptyState>Nenhum alerta importante no momento.</EmptyState> : <div className="divide-y divide-border">{alerts.map((alert) => <Link key={alert.id} href={alert.href} className="flex items-start gap-2 px-5 py-3 text-sm text-foreground hover:bg-secondary"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />{alert.text}</Link>)}</div>}</section></div></section><section className="rounded-xl border border-border bg-card shadow-sm"><div className="flex items-center justify-between border-b border-border px-5 py-4"><div><h3 className="font-medium text-foreground">Tarefas pendentes</h3><p className="mt-0.5 text-xs text-muted-foreground">Pendências operacionais mais próximas</p></div><Link href="/tarefas" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">Ver todas <ArrowRight className="h-3.5 w-3.5" /></Link></div>{pendingTasks.length === 0 ? <EmptyState>Nenhuma tarefa pendente.</EmptyState> : <div className="grid divide-y divide-border md:grid-cols-2 md:divide-x md:divide-y-0">{pendingTasks.map((task) => { const status = TASK_STATUS[task.status]; return <article key={task.id} className="flex items-start gap-3 px-5 py-4"><CheckSquare className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><div className="min-w-0 flex-1"><p className="font-medium text-foreground">{task.titulo}</p><p className="mt-0.5 text-xs text-muted-foreground">{task.responsavel_nome}{task.prazo ? ` · Prazo ${formatClinicDate(task.prazo, { day: "2-digit", month: "short" })}` : ""}{task.paciente_nome ? ` · ${task.paciente_nome}` : ""}</p></div><Badge tone={status.tone}>{status.label}</Badge></article>; })}</div>}</section></div>;
}
