import Link from "next/link";
import { AlertTriangle, ArrowRight, CalendarDays, CheckSquare, Clock3, RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { requireUser } from "@/lib/auth/session";
import { addDays, formatClinicDate, formatClinicTime, todayInClinic } from "@/lib/agenda/dates";
import { listActiveProfessionals, listAgenda } from "@/lib/agenda/queries";
import type { AppointmentStatus } from "@/lib/agenda/types";
import { getDashboardOperationalData } from "@/lib/operational/queries";
import type { ReturnStatus, TaskStatus } from "@/lib/operational/types";

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

export default async function DashboardPage() {
  const user = await requireUser();
  const today = todayInClinic();
  const ownProfessional = user.perfil === "dentista"
    ? (await listActiveProfessionals()).find((professional) => professional.usuario_id === user.id)
    : undefined;
  const professionalId = user.perfil === "dentista" ? ownProfessional?.id ?? null : null;
  const [appointments, operational] = await Promise.all([
    user.perfil === "dentista" && !professionalId ? Promise.resolve([]) : listAgenda({ startDate: today, endDate: addDays(today, 1), professionalId }),
    getDashboardOperationalData(today),
  ]);
  const { pendingTasks, pendingTaskCount, overdueTaskCount, relevantReturns, pendingReturnCount, overdueReturnCount } = operational;
  const todayAppointments = [...appointments].sort((a, b) => a.inicio.localeCompare(b.inicio));
  const notConfirmed = todayAppointments.filter((item) => item.status === "agendado");
  const alerts = [
    overdueTaskCount ? { id: "tasks", text: `${overdueTaskCount} ${overdueTaskCount === 1 ? "tarefa está" : "tarefas estão"} com prazo vencido`, href: "/tarefas" } : null,
    overdueReturnCount ? { id: "returns", text: `${overdueReturnCount} ${overdueReturnCount === 1 ? "retorno está" : "retornos estão"} atrasado${overdueReturnCount === 1 ? "" : "s"}`, href: "/retornos" } : null,
    notConfirmed.length ? { id: "appointments", text: `${notConfirmed.length} ${notConfirmed.length === 1 ? "consulta de hoje aguarda" : "consultas de hoje aguardam"} confirmação`, href: "/agenda" } : null,
  ].filter((alert): alert is { id: string; text: string; href: string } => Boolean(alert));
  const firstName = user.nome.split(" ")[0] || user.nome;
  const canManageAppointments = user.perfil === "administrador" || user.perfil === "recepcao";

  return <div className="mx-auto max-w-7xl space-y-5"><header><h2 className="text-2xl font-medium text-foreground">{greetingForNow()}, {firstName} <span aria-hidden="true">👋</span></h2><p className="mt-1 text-sm text-muted-foreground">Acompanhe a rotina da clínica hoje.</p></header><section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Resumo operacional"><MetricCard label="Consultas hoje" value={todayAppointments.length} description="Agendamentos do dia" icon={CalendarDays} /><MetricCard label="Tarefas pendentes" value={pendingTaskCount} description="Aguardam conclusão" icon={CheckSquare} tone="text-violet-600" /><MetricCard label="Retornos pendentes" value={pendingReturnCount} description="Precisam de acompanhamento" icon={RotateCcw} tone="text-amber-600" /><MetricCard label="Não confirmadas" value={notConfirmed.length} description="Consultas de hoje" icon={Clock3} tone="text-slate-500" /></section><section className="grid gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(19rem,1fr)]"><div className="rounded-xl border border-border bg-card shadow-sm"><div className="flex items-center justify-between border-b border-border px-5 py-4"><div><h3 className="font-medium text-foreground">Agenda de hoje</h3><p className="mt-0.5 text-xs text-muted-foreground">{formatClinicDate(today, { weekday: "long", day: "2-digit", month: "long" })}</p></div><Link href="/agenda" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">Ver agenda completa <ArrowRight className="h-3.5 w-3.5" /></Link></div>{todayAppointments.length === 0 ? <div className="px-5 py-6"><EmptyState>Nenhuma consulta agendada para hoje.</EmptyState>{canManageAppointments && <Link href={`/agenda/novo?data=${today}`} className="inline-flex h-9 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90">Novo agendamento</Link>}</div> : <div className="divide-y divide-border">{todayAppointments.slice(0, 6).map((appointment) => { const status = APPOINTMENT_STATUS[appointment.status]; return <article key={appointment.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5"><p className="w-24 text-sm font-semibold text-foreground">{formatClinicTime(appointment.inicio)}</p><div className="min-w-[12rem] flex-1"><Link href={`/pacientes/${appointment.paciente_id}`} className="font-medium text-foreground hover:text-primary">{appointment.paciente_nome}</Link><p className="mt-0.5 text-xs text-muted-foreground">{appointment.profissional_nome}{appointment.observacoes_administrativas ? ` · ${appointment.observacoes_administrativas}` : ""}</p></div><Badge tone={status.tone}>{status.label}</Badge></article>; })}</div>}</div><div className="space-y-5"><section className="rounded-xl border border-border bg-card shadow-sm"><div className="flex items-center justify-between border-b border-border px-5 py-4"><h3 className="font-medium text-foreground">Retornos</h3><Link href="/retornos" className="text-sm font-medium text-primary hover:underline">Ver retornos</Link></div>{relevantReturns.length === 0 ? <EmptyState>Nenhum retorno pendente.</EmptyState> : <div className="divide-y divide-border">{relevantReturns.map((item) => { const status = RETURN_STATUS[item.status]; return <div key={item.id} className="px-5 py-3"><div className="flex items-center justify-between gap-2"><Link href={`/pacientes/${item.paciente_id}`} className="min-w-0 truncate text-sm font-medium text-foreground hover:text-primary">{item.paciente_nome}</Link><Badge tone={status.tone}>{status.label}</Badge></div><p className="mt-1 text-xs text-muted-foreground">Previsto para {formatClinicDate(item.data_prevista, { day: "2-digit", month: "short" })}</p></div>; })}</div>}</section><section className="rounded-xl border border-border bg-card shadow-sm"><div className="border-b border-border px-5 py-4"><h3 className="font-medium text-foreground">Alertas operacionais</h3></div>{alerts.length === 0 ? <EmptyState>Nenhum alerta importante no momento.</EmptyState> : <div className="divide-y divide-border">{alerts.map((alert) => <Link key={alert.id} href={alert.href} className="flex items-start gap-2 px-5 py-3 text-sm text-foreground hover:bg-secondary"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />{alert.text}</Link>)}</div>}</section></div></section><section className="rounded-xl border border-border bg-card shadow-sm"><div className="flex items-center justify-between border-b border-border px-5 py-4"><div><h3 className="font-medium text-foreground">Tarefas pendentes</h3><p className="mt-0.5 text-xs text-muted-foreground">Pendências operacionais mais próximas</p></div><Link href="/tarefas" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">Ver todas <ArrowRight className="h-3.5 w-3.5" /></Link></div>{pendingTasks.length === 0 ? <EmptyState>Nenhuma tarefa pendente.</EmptyState> : <div className="grid divide-y divide-border md:grid-cols-2 md:divide-x md:divide-y-0">{pendingTasks.map((task) => { const status = TASK_STATUS[task.status]; return <article key={task.id} className="flex items-start gap-3 px-5 py-4"><CheckSquare className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><div className="min-w-0 flex-1"><p className="font-medium text-foreground">{task.titulo}</p><p className="mt-0.5 text-xs text-muted-foreground">{task.responsavel_nome}{task.prazo ? ` · Prazo ${formatClinicDate(task.prazo, { day: "2-digit", month: "short" })}` : ""}{task.paciente_nome ? ` · ${task.paciente_nome}` : ""}</p></div><Badge tone={status.tone}>{status.label}</Badge></article>; })}</div>}</section><p className="text-xs text-muted-foreground">Indicadores financeiros e alertas de validade permanecem desativados neste release candidate.</p></div>;
}
