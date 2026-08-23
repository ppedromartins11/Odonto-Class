import Link from "next/link";
import { Plus } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { listPatients } from "@/lib/patients/queries";
import { normalizeSearchInput } from "@/lib/patients/validation";
import { PatientList } from "./PatientList";
import { PatientSearch } from "./PatientSearch";

type SearchParams = Promise<{
  q?: string | string[];
  page?: string | string[];
  inativos?: string | string[];
}>;

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function PatientsPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();
  const params = await searchParams;
  const query = normalizeSearchInput(first(params.q));
  const rawPage = Number(first(params.page) ?? "1");
  const page = Number.isSafeInteger(rawPage) && rawPage > 0 ? rawPage : 1;
  const includeInactive =
    user.perfil === "administrador" && first(params.inativos) === "1";
  const result = await listPatients({ query, page, includeInactive });

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-medium text-foreground">Pacientes</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Cadastro e localização rápida por nome ou telefone.
          </p>
        </div>
        <Link
          href="/pacientes/novo"
          className="inline-flex h-8 items-center justify-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-3.5 w-3.5" /> Novo paciente
        </Link>
      </div>

      <PatientSearch
        query={query}
        includeInactive={includeInactive}
        canIncludeInactive={user.perfil === "administrador"}
      />
      <PatientList
        patients={result.patients}
        query={query}
        page={page}
        pageSize={result.pageSize}
        total={result.total}
        includeInactive={includeInactive}
      />
    </div>
  );
}
