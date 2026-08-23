import Link from "next/link";
import { ChevronLeft, ChevronRight, Phone, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import type { PatientListItem } from "@/lib/patients/types";

function formatDate(value: string | null) {
  if (!value) return "Nascimento não informado";
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(
    new Date(`${value}T00:00:00Z`)
  );
}

function pageHref({
  page,
  query,
  includeInactive,
}: {
  page: number;
  query: string;
  includeInactive: boolean;
}) {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (page > 1) params.set("page", String(page));
  if (includeInactive) params.set("inativos", "1");
  const suffix = params.toString();
  return suffix ? `/pacientes?${suffix}` : "/pacientes";
}

export function PatientList({
  patients,
  query,
  page,
  pageSize,
  total,
  includeInactive,
}: {
  patients: PatientListItem[];
  query: string;
  page: number;
  pageSize: number;
  total: number;
  includeInactive: boolean;
}) {
  if (patients.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-card px-6 py-12 text-center">
        <UserRound className="mx-auto h-8 w-8 text-muted-foreground/60" />
        <h3 className="mt-3 text-base font-medium text-foreground">
          {query ? "Nenhum paciente encontrado" : "Nenhum paciente cadastrado"}
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {query
            ? "Revise o nome ou telefone informado e tente novamente."
            : "Cadastre o primeiro paciente para iniciar a lista."}
        </p>
      </div>
    );
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="divide-y divide-border">
          {patients.map((patient) => (
            <Link
              key={patient.id}
              href={`/pacientes/${patient.id}`}
              className="flex flex-col gap-3 px-4 py-4 transition-colors hover:bg-secondary/30 sm:flex-row sm:items-center"
            >
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-accent">
                  <UserRound className="h-4 w-4 text-primary" />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{patient.nome}</p>
                  <p className="text-xs text-muted-foreground">{formatDate(patient.data_nascimento)}</p>
                </div>
              </div>
              <div className="flex items-center justify-between gap-4 pl-12 sm:justify-end sm:pl-0">
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Phone className="h-3.5 w-3.5" />
                  {patient.telefone_contato ?? "Não informado"}
                </span>
                <Badge tone={patient.ativo ? "success" : "neutral"}>
                  {patient.ativo ? "Ativo" : "Inativo"}
                </Badge>
              </div>
            </Link>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {total} paciente{total === 1 ? "" : "s"}
        </span>
        <div className="flex items-center gap-2">
          {page > 1 ? (
            <Link
              href={pageHref({ page: page - 1, query, includeInactive })}
              className="inline-flex h-8 items-center gap-1 rounded-md border border-border bg-card px-3 text-foreground hover:bg-secondary"
            >
              <ChevronLeft className="h-3.5 w-3.5" /> Anterior
            </Link>
          ) : null}
          <span>
            Página {page} de {totalPages}
          </span>
          {page < totalPages ? (
            <Link
              href={pageHref({ page: page + 1, query, includeInactive })}
              className="inline-flex h-8 items-center gap-1 rounded-md border border-border bg-card px-3 text-foreground hover:bg-secondary"
            >
              Próxima <ChevronRight className="h-3.5 w-3.5" />
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  );
}
