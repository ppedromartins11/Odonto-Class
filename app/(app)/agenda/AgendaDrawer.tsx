"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { CalendarClock, Clock3, FilePenLine, Stethoscope, UserRound, X } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { formatClinicTime } from "@/lib/agenda/dates";
import type { AgendaItem } from "@/lib/agenda/types";
import { APPOINTMENT_STATUS_VISUAL } from "@/lib/agenda/visual";
import type { PerfilUsuario } from "@/lib/auth/session";
import { AppointmentStatusActions } from "./AppointmentStatusActions";
import { StartAttendanceButton } from "./StartAttendanceButton";

function duration(item: AgendaItem) {
  const minutes = Math.max(0, Math.round((new Date(item.fim).getTime() - new Date(item.inicio).getTime()) / 60000));
  return minutes ? `${minutes} min` : "Duração não informada";
}

function Detail({ label, children, icon: Icon }: { label: string; children: React.ReactNode; icon: typeof Clock3 }) {
  return <div className="flex gap-3"><Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><div className="min-w-0"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p><div className="mt-1 text-sm text-foreground">{children}</div></div></div>;
}

export function AgendaDrawer({ item, profile, onClose }: { item: AgendaItem | null; profile: PerfilUsuario; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!item) return;
    closeRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [item, onClose]);

  if (!item) return null;
  const status = APPOINTMENT_STATUS_VISUAL[item.status];
  const canManage = profile === "administrador" || profile === "recepcao";
  const dentistCanStart = profile === "dentista" && (item.status === "agendado" || item.status === "confirmado");

  return <>
    <button type="button" aria-label="Fechar detalhes da consulta" className="fixed inset-0 z-30 bg-black/25 md:hidden" onClick={onClose} />
    <aside role="dialog" aria-modal="true" aria-labelledby="agenda-drawer-title" className="fixed inset-y-0 right-0 z-40 flex w-full max-w-[23rem] flex-col border-l border-border bg-card shadow-2xl sm:w-[22rem]">
      <header className="flex items-start justify-between gap-3 border-b border-border px-5 py-5">
        <div><h2 id="agenda-drawer-title" className="text-lg font-semibold text-foreground">Consulta</h2><div className="mt-2"><Badge tone={status.tone}>{status.label}</Badge></div></div>
        <button ref={closeRef} type="button" aria-label="Fechar painel de consulta" onClick={onClose} className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"><X className="h-5 w-5" /></button>
      </header>
      <div className="flex-1 space-y-6 overflow-y-auto px-5 py-6">
        <Detail label="Paciente" icon={UserRound}><Link href={`/pacientes/${item.paciente_id}`} className="font-medium text-primary hover:underline">{item.paciente_nome}</Link></Detail>
        <Detail label="Horário" icon={Clock3}><p className="font-medium">{formatClinicTime(item.inicio)} – {formatClinicTime(item.fim)}</p><p className="mt-0.5 text-xs text-muted-foreground">{duration(item)}</p></Detail>
        <Detail label="Profissional" icon={Stethoscope}>{item.profissional_nome}</Detail>
        {item.observacoes_administrativas && <div className="rounded-lg border border-border bg-secondary/50 p-4"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Observação administrativa</p><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-foreground">{item.observacoes_administrativas}</p></div>}
        {!item.observacoes_administrativas && <div className="rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">Nenhuma observação administrativa registrada.</div>}
      </div>
      <footer className="border-t border-border bg-card p-4">
        <div className="grid gap-2">
          {canManage && <AppointmentStatusActions appointmentId={item.id} status={item.status} />}
          {canManage && (item.status === "agendado" || item.status === "confirmado") && <Link href={`/agenda/${item.id}/editar`} className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-border bg-card text-sm font-medium text-foreground hover:bg-secondary"><FilePenLine className="h-4 w-4" /> Editar / remarcar</Link>}
          {dentistCanStart && <StartAttendanceButton appointmentId={item.id} />}
          {profile === "dentista" && item.status === "atendido" && item.atendimento_id && <Link href={`/atendimentos/${item.atendimento_id}`} className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-border bg-card text-sm font-medium text-foreground hover:bg-secondary"><CalendarClock className="h-4 w-4" /> Abrir atendimento</Link>}
          <Link href={`/pacientes/${item.paciente_id}`} className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-primary text-sm font-medium text-primary-foreground hover:bg-primary/90"><UserRound className="h-4 w-4" /> Abrir paciente</Link>
        </div>
      </footer>
    </aside>
  </>;
}
