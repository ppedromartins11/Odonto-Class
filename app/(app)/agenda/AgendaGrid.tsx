import Link from "next/link";
import { CalendarDays, Clock, FilePenLine, Plus, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { addDays, formatClinicDate, formatClinicTime, toClinicDateKey } from "@/lib/agenda/dates";
import type { AgendaItem, AppointmentStatus } from "@/lib/agenda/types";
import type { PerfilUsuario } from "@/lib/auth/session";
import { AppointmentStatusActions } from "./AppointmentStatusActions";
import { StartAttendanceButton } from "./StartAttendanceButton";

const STATUS: Record<AppointmentStatus, { label: string; tone: "info" | "success" | "neutral" | "danger" | "warning" }> = {
  agendado: { label: "Agendado", tone: "info" },
  confirmado: { label: "Confirmado", tone: "success" },
  atendido: { label: "Atendido", tone: "neutral" },
  cancelado: { label: "Cancelado", tone: "danger" },
  faltou: { label: "Faltou", tone: "warning" },
};

const BLOCK_STYLE: Record<AppointmentStatus, string> = {
  agendado: "border-blue-200 bg-blue-50/90",
  confirmado: "border-emerald-200 bg-emerald-50/90",
  atendido: "border-slate-200 bg-slate-100/90",
  cancelado: "border-red-200 bg-red-50/80 opacity-75",
  faltou: "border-amber-200 bg-amber-50/90",
};

const START_HOUR = 7;
const END_HOUR = 20;
const HOUR_HEIGHT = 76;
const HOURS = Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, index) => START_HOUR + index);

function minutesInClinic(value: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Cuiaba",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(value));
  const item = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return Number(item.hour) * 60 + Number(item.minute);
}

function appointmentPosition(item: AgendaItem) {
  const start = minutesInClinic(item.inicio);
  const end = Math.max(start + 20, minutesInClinic(item.fim));
  const rangeStart = START_HOUR * 60;
  const top = Math.max(0, ((start - rangeStart) / 60) * HOUR_HEIGHT);
  const height = Math.max(112, ((end - start) / 60) * HOUR_HEIGHT - 4);
  return { top, height };
}

export function AgendaGrid({
  items,
  startDate,
  days,
  profile,
}: {
  items: AgendaItem[];
  startDate: string;
  days: number;
  profile: PerfilUsuario;
}) {
  const canManage = profile === "administrador" || profile === "recepcao";
  const dateKeys = Array.from({ length: days }, (_, index) => addDays(startDate, index));
  const gridColumns = `4.5rem repeat(${days}, minmax(${days === 1 ? "19rem" : "11rem"}, 1fr))`;
  const noAppointments = items.length === 0;

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div className="overflow-x-auto">
        <div className="min-w-[25rem]" style={{ minWidth: days === 1 ? "25rem" : "58rem" }}>
          <div className="grid border-b border-border bg-secondary/40" style={{ gridTemplateColumns: gridColumns }}>
            <div className="border-r border-border px-3 py-3 text-xs font-medium text-muted-foreground">Horário</div>
            {dateKeys.map((dateKey) => (
              <div key={dateKey} className="border-r border-border px-3 py-3 last:border-r-0">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{formatClinicDate(dateKey, { weekday: "short" })}</p>
                <p className="mt-0.5 text-sm font-semibold text-foreground">{formatClinicDate(dateKey, { day: "2-digit", month: "long" })}</p>
              </div>
            ))}
          </div>

          <div className="grid" style={{ gridTemplateColumns: gridColumns }}>
            <div className="relative border-r border-border bg-secondary/20" style={{ height: `${(END_HOUR - START_HOUR) * HOUR_HEIGHT}px` }}>
              {HOURS.slice(0, -1).map((hour) => (
                <span key={hour} className="absolute right-3 -translate-y-2 text-xs text-muted-foreground" style={{ top: `${(hour - START_HOUR) * HOUR_HEIGHT}px` }}>
                  {String(hour).padStart(2, "0")}:00
                </span>
              ))}
            </div>
            {dateKeys.map((dateKey) => {
              const daily = items.filter((item) => toClinicDateKey(item.inicio) === dateKey);
              return (
                <div
                  key={dateKey}
                  className="relative border-r border-border last:border-r-0"
                  style={{
                    height: `${(END_HOUR - START_HOUR) * HOUR_HEIGHT}px`,
                    backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent ${HOUR_HEIGHT - 1}px, rgb(226 232 240) ${HOUR_HEIGHT - 1}px, rgb(226 232 240) ${HOUR_HEIGHT}px)`,
                  }}
                >
                  {daily.map((item) => {
                    const status = STATUS[item.status];
                    const position = appointmentPosition(item);
                    return (
                      <article
                        key={item.id}
                        className={`absolute left-2 right-2 rounded-lg border p-2.5 shadow-sm ${BLOCK_STYLE[item.status]}`}
                        style={{ top: `${position.top + 2}px`, height: `${position.height}px` }}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="flex items-center gap-1 text-xs font-semibold text-foreground"><Clock className="h-3.5 w-3.5 text-primary" />{formatClinicTime(item.inicio)}–{formatClinicTime(item.fim)}</p>
                          <Badge tone={status.tone} className="shrink-0">{status.label}</Badge>
                        </div>
                        <Link href={`/pacientes/${item.paciente_id}`} className="mt-1 flex items-start gap-1 text-sm font-semibold leading-5 text-foreground hover:text-primary">
                          <UserRound className="mt-0.5 h-3.5 w-3.5 shrink-0" /> <span className="line-clamp-1">{item.paciente_nome}</span>
                        </Link>
                        <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{item.profissional_nome}</p>
                        {item.observacoes_administrativas && <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">{item.observacoes_administrativas}</p>}
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          {canManage && ["agendado", "confirmado"].includes(item.status) && (
                            <Link href={`/agenda/${item.id}/editar`} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"><FilePenLine className="h-3.5 w-3.5" /> Editar</Link>
                          )}
                          {canManage && <AppointmentStatusActions appointmentId={item.id} status={item.status} compact />}
                          {profile === "dentista" && ["agendado", "confirmado"].includes(item.status) && <StartAttendanceButton appointmentId={item.id} />}
                        </div>
                      </article>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      {noAppointments && (
        <div className="border-t border-border px-5 py-5 text-center">
          <CalendarDays className="mx-auto h-6 w-6 text-muted-foreground/60" />
          <p className="mt-2 text-sm font-medium text-foreground">Nenhum agendamento neste período</p>
          <p className="mt-1 text-xs text-muted-foreground">A grade continua disponível para facilitar a visualização do dia.</p>
          {canManage && <Link href={`/agenda/novo?data=${startDate}`} className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90"><Plus className="h-4 w-4" /> Novo agendamento</Link>}
        </div>
      )}
    </section>
  );
}
