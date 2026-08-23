"use client";

import { useEffect, useState } from "react";
import { Search, UserRound, X } from "lucide-react";

type PatientOption = { id: string; nome: string; telefone_contato: string | null };

export function PatientPicker({
  initialPatient,
  error,
}: {
  initialPatient?: PatientOption | null;
  error?: string;
}) {
  const [selected, setSelected] = useState<PatientOption | null>(initialPatient ?? null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PatientOption[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (selected || query.trim().length < 2) {
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/pacientes/busca?q=${encodeURIComponent(query.trim())}`, {
          signal: controller.signal,
          cache: "no-store",
        });
        const payload = (await response.json()) as { patients?: PatientOption[] };
        setResults(response.ok ? payload.patients ?? [] : []);
      } catch (fetchError) {
        if ((fetchError as Error).name !== "AbortError") setResults([]);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, selected]);

  return (
    <div>
      <label className="mb-1.5 block text-foreground">Paciente</label>
      <input type="hidden" name="pacienteId" value={selected?.id ?? ""} />
      {selected ? (
        <div className={`flex min-h-10 items-center gap-3 rounded-md border bg-input-background px-3 ${error ? "border-destructive" : "border-border"}`}>
          <UserRound className="h-4 w-4 text-primary" />
          <div className="min-w-0 flex-1 py-2">
            <p className="truncate text-sm font-medium text-foreground">{selected.nome}</p>
            <p className="text-xs text-muted-foreground">{selected.telefone_contato ?? "Telefone não informado"}</p>
          </div>
          <button type="button" onClick={() => setSelected(null)} aria-label="Trocar paciente" className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <div className="relative">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <input
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setResults([]);
              setLoading(false);
            }}
            placeholder="Digite nome ou telefone"
            aria-label="Buscar paciente para agendamento"
            className={`h-10 w-full rounded-md border bg-input-background pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring ${error ? "border-destructive" : "border-border"}`}
          />
          {query.trim().length >= 2 && (
            <div className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-border bg-card shadow-lg">
              {loading ? (
                <p className="px-3 py-4 text-sm text-muted-foreground">Buscando pacientes...</p>
              ) : results.length === 0 ? (
                <p className="px-3 py-4 text-sm text-muted-foreground">Nenhum paciente ativo encontrado.</p>
              ) : results.map((patient) => (
                <button
                  key={patient.id}
                  type="button"
                  onClick={() => { setSelected(patient); setQuery(""); setResults([]); setLoading(false); }}
                  className="block w-full border-b border-border px-3 py-2.5 text-left last:border-b-0 hover:bg-secondary"
                >
                  <span className="block text-sm font-medium text-foreground">{patient.nome}</span>
                  <span className="block text-xs text-muted-foreground">{patient.telefone_contato ?? "Telefone não informado"}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}
