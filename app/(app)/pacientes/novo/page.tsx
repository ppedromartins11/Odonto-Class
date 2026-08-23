import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { PatientForm } from "../PatientForm";

export default async function NewPatientPage() {
  const user = await requireUser();

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <Link
          href="/pacientes"
          className="mb-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-3.5 w-3.5" /> Voltar para pacientes
        </Link>
        <h2 className="text-2xl font-medium text-foreground">Novo paciente</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Cadastre apenas as informações disponíveis neste momento.
        </p>
      </div>
      <PatientForm mode="create" canEditClinical={user.perfil === "dentista"} />
    </div>
  );
}
