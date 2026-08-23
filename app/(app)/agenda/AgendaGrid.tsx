import Link from "next/link";
import { Clock, FilePenLine, UserRound } from "lucide-react";
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
  return (
    <div className={days === 1 ? "grid gap-4" : "grid gap-4 xl:grid-cols-7"}>
      {dateKeys.map((dateKey) => {
        const daily = items.filter((item) => toClinicDateKey(item.inicio) === dateKey);
        return (
          <section key={dateKey} className="min-w-0 rounded-lg border border-border bg-card">
            <div className="border-b border-border px-3 py-3">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{formatClinicDate(dateKey, { weekday: "short" })}</p>
              <p className="text-sm font-semibold text-foreground">{formatClinicDate(dateKey, { day: "2-digit", month: "2-digit" })}</p>
            </div>
            <div className="space-y-2 p-2">
              {daily.length === 0 ? (
                <p className="px-2 py-8 text-center text-xs text-muted-foreground">Sem agendamentos</p>
              ) : daily.map((item) => {
                const status = STATUS[item.status];
                return (
                  <article key={item.id} className="rounded-md border border-border bg-background p-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="flex items-center gap-1 text-sm font-semibold text-foreground"><Clock className="h-3.5 w-3.5 text-primary" />{formatClinicTime(item.inicio)}–{formatClinicTime(item.fim)}</p>
                      <Badge tone={status.tone}>{status.label}</Badge>
                    </div>
                    <Link href={`/pacientes/${item.paciente_id}`} className="mt-2 flex items-start gap-1.5 text-sm font-medium text-foreground hover:text-primary">
                      <UserRound className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" /> <span className="break-words">{item.paciente_nome}</span>
                    </Link>
                    <p className="mt-1 text-xs text-muted-foreground">{item.profissional_nome}</p>
                    {item.observacoes_administrativas && <p className="mt-2 line-clamp-3 text-xs text-muted-foreground">{item.observacoes_administrativas}</p>}
                    {canManage && ["agendado", "confirmado"].includes(item.status) && (
                      <Link href={`/agenda/${item.id}/editar`} className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"><FilePenLine className="h-3.5 w-3.5" /> Editar/remarcar</Link>
                    )}
                    {canManage && <AppointmentStatusActions appointmentId={item.id} status={item.status} />}
                    {profile === "dentista" && ["agendado", "confirmado"].includes(item.status) && <StartAttendanceButton appointmentId={item.id} />}
                  </article>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
