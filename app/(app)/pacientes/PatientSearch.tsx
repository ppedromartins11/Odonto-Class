import { Search } from "lucide-react";
import { Button } from "@/components/ui/Button";

export function PatientSearch({
  query,
  includeInactive,
  canIncludeInactive,
}: {
  query: string;
  includeInactive: boolean;
  canIncludeInactive: boolean;
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
        {canIncludeInactive && (
          <label className="flex items-center gap-2 whitespace-nowrap text-xs text-muted-foreground">
            <input
              type="checkbox"
              name="inativos"
              value="1"
              defaultChecked={includeInactive}
              className="h-4 w-4 rounded border-border"
            />
            Incluir inativos
          </label>
        )}
        <Button type="submit">Buscar</Button>
      </div>
    </form>
  );
}
