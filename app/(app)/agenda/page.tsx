import Link from "next/link";
import { CalendarDays, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { addDays, normalizeDateKey, startOfClinicWeek } from "@/lib/agenda/dates";
import { listActiveProfessionals, listAgenda } from "@/lib/agenda/queries";
import { isValidUuid } from "@/lib/patients/validation";
import { AgendaGrid } from "./AgendaGrid";

type SearchParams = Promise<{ data?: string | string[]; visao?: string | string[]; profissional?: string | string[] }>;
const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;

function agendaHref(date: string, view: string, professional?: string | null) {
  const params = new URLSearchParams({ data: date, visao: view });
  if (professional) params.set("profissional", professional);
  return `/agenda?${params}`;
}

export default async function AgendaPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();
  const params = await searchParams;
  const view = first(params.visao) === "semana" ? "semana" : "dia";
  const selectedDate = normalizeDateKey(first(params.data));
  const startDate = view === "semana" ? startOfClinicWeek(selectedDate) : selectedDate;
  const days = view === "semana" ? 7 : 1;
  const endDate = addDays(startDate, days);
  const professionals = await listActiveProfessionals();
  const ownProfessional = professionals.find((item) => item.usuario_id === user.id);
  const requestedProfessional = first(params.profissional);
  const selectedProfessional = user.perfil === "dentista"
    ? ownProfessional?.id ?? null
    : requestedProfessional && isValidUuid(requestedProfessional) ? requestedProfessional : null;
  const items = user.perfil === "dentista" && !ownProfessional
    ? []
    : await listAgenda({ startDate, endDate, professionalId: selectedProfessional });
  const step = view === "semana" ? 7 : 1;
  const canManage = user.perfil === "administrador" || user.perfil === "recepcao";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-medium text-foreground">Agenda</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">Consultas por dia ou semana, no horário da clínica.</p>
        </div>
        {canManage && (
          <Link
            href={`/agenda/novo?data=${selectedDate}`}
            aria-label="Novo agendamento"
            className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" /> Novo agendamento
          </Link>
        )}
      </div>

      <section className="rounded-lg border border-border bg-card p-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <Link aria-label="Período anterior" href={agendaHref(addDays(startDate, -step), view, selectedProfessional)} className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border hover:bg-secondary"><ChevronLeft className="h-4 w-4" /></Link>
            <form action="/agenda" className="flex gap-2">
              <input type="hidden" name="visao" value={view} />
              {selectedProfessional && <input type="hidden" name="profissional" value={selectedProfessional} />}
              <input aria-label="Ir para data" type="date" name="data" defaultValue={selectedDate} className="h-9 rounded-md border border-border bg-input-background px-3 text-sm" />
              <button className="h-9 rounded-md border border-border px-3 text-sm hover:bg-secondary">Ir</button>
            </form>
            <Link aria-label="Próximo período" href={agendaHref(addDays(startDate, step), view, selectedProfessional)} className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border hover:bg-secondary"><ChevronRight className="h-4 w-4" /></Link>
            <Link href={agendaHref(normalizeDateKey(undefined), view, selectedProfessional)} className="inline-flex h-9 items-center rounded-md border border-border px-3 text-sm hover:bg-secondary">Hoje</Link>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            {user.perfil !== "dentista" && (
              <form action="/agenda" className="flex gap-2">
                <input type="hidden" name="data" value={selectedDate} />
                <input type="hidden" name="visao" value={view} />
                <select name="profissional" defaultValue={selectedProfessional ?? ""} className="h-9 min-w-48 rounded-md border border-border bg-input-background px-3 text-sm">
                  <option value="">Todos os profissionais</option>
                  {professionals.map((professional) => <option key={professional.id} value={professional.id}>{professional.nome}</option>)}
                </select>
                <button className="h-9 rounded-md border border-border px-3 text-sm hover:bg-secondary">Filtrar</button>
              </form>
            )}
            <div className="flex rounded-md border border-border p-0.5">
              <Link href={agendaHref(selectedDate, "dia", selectedProfessional)} className={`rounded px-3 py-1.5 text-sm ${view === "dia" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary"}`}>Dia</Link>
              <Link href={agendaHref(selectedDate, "semana", selectedProfessional)} className={`rounded px-3 py-1.5 text-sm ${view === "semana" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary"}`}>Semana</Link>
            </div>
          </div>
        </div>
      </section>

      {!ownProfessional && user.perfil === "dentista" ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">Seu vínculo profissional ativo não foi localizado. A agenda clínica permanece bloqueada.</div>
      ) : items.length === 0 && days === 1 ? (
        <div className="rounded-lg border border-dashed border-border bg-card px-6 py-12 text-center">
          <CalendarDays className="mx-auto h-8 w-8 text-muted-foreground/60" />
          <h3 className="mt-3 text-base font-medium">Nenhum agendamento neste dia</h3>
          <p className="mt-1 text-sm text-muted-foreground">Navegue para outra data ou crie um novo agendamento.</p>
          {canManage && (
            <Link
              href={`/agenda/novo?data=${selectedDate}`}
              className="mt-5 inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              <Plus className="h-4 w-4" /> Novo agendamento
            </Link>
          )}
        </div>
      ) : <AgendaGrid items={items} startDate={startDate} days={days} profile={user.perfil} />}
    </div>
  );
}
