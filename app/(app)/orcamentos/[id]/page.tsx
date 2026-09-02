import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { listActiveProfessionals } from "@/lib/agenda/queries";
import { getPatient } from "@/lib/patients/queries";
import { isValidUuid } from "@/lib/patients/validation";
import { formatCents } from "@/lib/budgets/validation";
import { getBudget, listBudgetPdfVersions } from "@/lib/budgets/queries";
import type { BudgetStatus } from "@/lib/budgets/types";
import { BudgetEditor } from "../BudgetEditor";
import { BudgetStatusActions } from "../BudgetStatusActions";
import { BudgetPdfVersions } from "../BudgetPdfVersions";

const labels: Record<BudgetStatus, string> = {
  rascunho: "Rascunho",
  enviado: "Enviado",
  aprovado: "Aprovado",
  rejeitado: "Rejeitado",
  expirado: "Expirado",
  convertido: "Convertido",
};

export default async function BudgetDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  if (!isValidUuid(id)) notFound();

  const budget = await getBudget(id);
  if (!budget) notFound();

  const [patient, professionals, pdfVersions] = await Promise.all([
    getPatient(budget.paciente_id),
    listActiveProfessionals(),
    listBudgetPdfVersions(budget.id),
  ]);
  const canRegisterPayment = budget.effective_status === "aprovado"
    && (user.perfil === "administrador" || user.perfil === "recepcao");

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/orcamentos" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary">
            <ArrowLeft className="h-3.5 w-3.5" />Voltar para orçamentos
          </Link>
          <h2 className="mt-3 text-2xl font-medium">Orçamento #{budget.numero}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {budget.paciente_nome} · {labels[budget.effective_status]} · {formatCents(budget.total_centavos)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canRegisterPayment && (
            <Link href={`/financeiro/novo?paciente=${budget.paciente_id}&orcamento=${budget.id}`} className="inline-flex h-9 items-center rounded bg-primary px-3 text-sm font-medium text-primary-foreground">
              Registrar pagamento
            </Link>
          )}
        </div>
      </div>

      {budget.effective_status === "rascunho" ? (
        <BudgetEditor budget={budget} patient={patient} professionals={professionals} />
      ) : (
        <>
          <section className="rounded-lg border bg-card p-5">
            <h3 className="font-medium">Itens do orçamento</h3>
            <div className="mt-4 divide-y">
              {budget.items.map((item) => (
                <div key={item.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                  <span>{item.quantidade}× {item.descricao}</span>
                  <span className="font-medium">{formatCents(item.total_centavos)}</span>
                </div>
              ))}
              <div className="flex justify-end pt-4 text-base font-semibold">Total: {formatCents(budget.total_centavos)}</div>
            </div>
          </section>
          <BudgetStatusActions budgetId={budget.id} status={budget.effective_status} />
        </>
      )}
      <BudgetPdfVersions budgetId={budget.id} versions={pdfVersions} />
    </div>
  );
}
