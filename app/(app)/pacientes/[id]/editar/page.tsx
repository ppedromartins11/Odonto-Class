import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { getPatient } from "@/lib/patients/queries";
import { isValidUuid } from "@/lib/patients/validation";
import { PatientForm } from "../../PatientForm";

export default async function EditPatientPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireUser();
  const { id } = await params;
  if (!isValidUuid(id)) notFound();
  const patient = await getPatient(id);
  if (!patient) notFound();

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <Link
          href={`/pacientes/${patient.id}`}
          className="mb-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-3.5 w-3.5" /> Voltar para a ficha
        </Link>
        <h2 className="text-2xl font-medium text-foreground">Editar paciente</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">{patient.nome}</p>
      </div>
      <PatientForm mode="edit" patient={patient} />
    </div>
  );
}
