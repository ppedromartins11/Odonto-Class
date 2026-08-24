import { Search } from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { PatientListFilter } from "@/lib/patients/types";

export function PatientSearch({
  query,
  filter,
  canManageInactive,
}: {
  query: string;
  filter: PatientListFilter;
  canManageInactive: boolean;
}) {
  return (
    <form action="/pacientes" className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            name="q"
            defaultValue={query}
            maxLength={100}
            placeholder="Buscar por nome ou telefone"
            aria-label="Buscar paciente por nome ou telefone"
            className="h-10 w-full rounded-md border border-border bg-input-background pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        {canManageInactive ? (
          <label className="flex items-center gap-2 whitespace-nowrap text-xs text-muted-foreground">
            <span className="sr-only">Status do paciente</span>
            <select name="status" defaultValue={filter} className="h-10 rounded-md border border-border bg-input-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring">
              <option value="ativos">Ativos</option>
              <option value="inativos">Inativos</option>
              <option value="todos">Todos</option>
            </select>
          </label>
        ) : (
          <input type="hidden" name="status" value="ativos" />
        )}
        <Button type="submit">Buscar</Button>
      </div>
    </form>
  );
}
