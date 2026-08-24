"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { CalendarDays, Clock, Plus, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { addDays, formatClinicDate, formatClinicTime, toClinicDateKey } from "@/lib/agenda/dates";
import type { AgendaItem } from "@/lib/agenda/types";
import { APPOINTMENT_BLOCK_STYLE, APPOINTMENT_STATUS_VISUAL } from "@/lib/agenda/visual";
import type { PerfilUsuario } from "@/lib/auth/session";

const AgendaDrawer = dynamic(() =>
  import("./AgendaDrawer").then((module) => module.AgendaDrawer)
);

const START_HOUR = 7;
const END_HOUR = 20;
const HOUR_HEIGHT = 76;
const HOURS = Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, index) => START_HOUR + index);

function minutesInClinic(value: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Cuiaba", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(value));
  const item = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return Number(item.hour) * 60 + Number(item.minute);
}

function appointmentPosition(item: AgendaItem) {
  const start = minutesInClinic(item.inicio);
  const end = Math.max(start + 20, minutesInClinic(item.fim));
  const top = Math.max(0, ((start - START_HOUR * 60) / 60) * HOUR_HEIGHT);
  return { top, height: Math.max(112, ((end - start) / 60) * HOUR_HEIGHT - 4) };
}

export function AgendaGrid({ items, startDate, days, profile }: { items: AgendaItem[]; startDate: string; days: number; profile: PerfilUsuario }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const canManage = profile === "administrador" || profile === "recepcao";
  const dateKeys = Array.from({ length: days }, (_, index) => addDays(startDate, index));
  const gridColumns = `4.5rem repeat(${days}, minmax(${days === 1 ? "19rem" : "11rem"}, 1fr))`;
  const selected = items.find((item) => item.id === selectedId) ?? null;

  return <>
    <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div className="overflow-x-auto">
        <div className="min-w-[25rem]" style={{ minWidth: days === 1 ? "25rem" : "58rem" }}>
          <div className="grid border-b border-border bg-secondary/40" style={{ gridTemplateColumns: gridColumns }}>
            <div className="border-r border-border px-3 py-3 text-xs font-medium text-muted-foreground">Horário</div>
            {dateKeys.map((dateKey) => <div key={dateKey} className="border-r border-border px-3 py-3 last:border-r-0"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{formatClinicDate(dateKey, { weekday: "short" })}</p><p className="mt-0.5 text-sm font-semibold text-foreground">{formatClinicDate(dateKey, { day: "2-digit", month: "long" })}</p></div>)}
          </div>
          <div className="grid" style={{ gridTemplateColumns: gridColumns }}>
            <div className="relative border-r border-border bg-secondary/20" style={{ height: `${(END_HOUR - START_HOUR) * HOUR_HEIGHT}px` }}>
              {HOURS.slice(0, -1).map((hour) => <span key={hour} className="absolute right-3 -translate-y-2 text-xs text-muted-foreground" style={{ top: `${(hour - START_HOUR) * HOUR_HEIGHT}px` }}>{String(hour).padStart(2, "0")}:00</span>)}
            </div>
            {dateKeys.map((dateKey) => <div key={dateKey} className="relative border-r border-border last:border-r-0" style={{ height: `${(END_HOUR - START_HOUR) * HOUR_HEIGHT}px`, backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent ${HOUR_HEIGHT - 1}px, rgb(226 232 240) ${HOUR_HEIGHT - 1}px, rgb(226 232 240) ${HOUR_HEIGHT}px)` }}>
              {items.filter((item) => toClinicDateKey(item.inicio) === dateKey).map((item) => {
                const status = APPOINTMENT_STATUS_VISUAL[item.status];
                const position = appointmentPosition(item);
                const selectedItem = selectedId === item.id;
                const open = () => setSelectedId(item.id);
                return <article key={item.id} role="button" tabIndex={0} aria-label={`Abrir detalhes da consulta de ${item.paciente_nome}`} aria-pressed={selectedItem} onClick={open} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); open(); } }} className={`absolute left-2 right-2 cursor-pointer rounded-lg border p-2.5 shadow-sm outline-none transition hover:-translate-y-px hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring ${APPOINTMENT_BLOCK_STYLE[item.status]} ${selectedItem ? "ring-2 ring-primary ring-offset-2" : ""}`} style={{ top: `${position.top + 2}px`, height: `${position.height}px` }}>
                  <div className="flex items-start justify-between gap-2"><p className="flex items-center gap-1 text-xs font-semibold text-foreground"><Clock className="h-3.5 w-3.5 text-primary" />{formatClinicTime(item.inicio)}–{formatClinicTime(item.fim)}</p><Badge tone={status.tone} className="shrink-0">{status.label}</Badge></div>
                  <p className="mt-1 flex items-start gap-1 text-sm font-semibold leading-5 text-foreground"><UserRound className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span className="line-clamp-1">{item.paciente_nome}</span></p>
                  <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{item.profissional_nome}</p>
                  {item.observacoes_administrativas && <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">{item.observacoes_administrativas}</p>}
                </article>;
              })}
            </div>)}
          </div>
        </div>
      </div>
      {items.length === 0 && <div className="border-t border-border px-5 py-5 text-center"><CalendarDays className="mx-auto h-6 w-6 text-muted-foreground/60" /><p className="mt-2 text-sm font-medium text-foreground">Nenhum agendamento neste período</p><p className="mt-1 text-xs text-muted-foreground">A grade continua disponível para facilitar a visualização do dia.</p>{canManage && <Link href={`/agenda/novo?data=${startDate}`} className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90"><Plus className="h-4 w-4" /> Novo agendamento</Link>}</div>}
    </section>
    {selected && <AgendaDrawer item={selected} profile={profile} onClose={() => setSelectedId(null)} />}
  </>;
}
