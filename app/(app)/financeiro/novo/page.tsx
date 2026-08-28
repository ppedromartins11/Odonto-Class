import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getPatient } from "@/lib/patients/queries";
import { isValidUuid } from "@/lib/patients/validation";
import { PaymentForm } from "../PaymentForm";

type SearchParams = Promise<{ paciente?: string; orcamento?: string; atendimento?: string }>;

export default async function NewPaymentPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();
  if (user.perfil === "dentista") redirect("/financeiro");

  const { paciente, orcamento, atendimento } = await searchParams;
  const patient = paciente && isValidUuid(paciente) ? await getPatient(paciente) : null;
  const initialReference = orcamento && isValidUuid(orcamento)
    ? `orcamento:${orcamento}`
    : atendimento && isValidUuid(atendimento)
      ? `atendimento:${atendimento}`
      : null;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h2 className="text-2xl font-medium">Registrar pagamento</h2>
        <p className="mt-1 text-sm text-muted-foreground">Registre um pagamento vinculado ao paciente, atendimento ou orçamento.</p>
      </div>
      <PaymentForm patient={patient} initialReference={initialReference} />
    </div>
  );
}
