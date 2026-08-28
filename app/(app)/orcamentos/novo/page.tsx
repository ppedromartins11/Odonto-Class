import { requireUser } from "@/lib/auth/session";
import { listActiveProfessionals } from "@/lib/agenda/queries";
import { getPatient } from "@/lib/patients/queries";
import { isValidUuid } from "@/lib/patients/validation";
import { BudgetEditor } from "../BudgetEditor";

export default async function NewBudgetPage({ searchParams }: { searchParams: Promise<{ paciente?: string }> }) {
  await requireUser(); const { paciente } = await searchParams; const [patient, professionals] = await Promise.all([paciente && isValidUuid(paciente) ? getPatient(paciente) : Promise.resolve(null), listActiveProfessionals()]);
  return <div className="mx-auto max-w-4xl space-y-5"><div><h2 className="text-2xl font-medium">Novo orçamento</h2><p className="mt-1 text-sm text-muted-foreground">Crie um rascunho ou envie uma proposta comercial ao paciente.</p></div><BudgetEditor patient={patient} professionals={professionals}/></div>;
}
