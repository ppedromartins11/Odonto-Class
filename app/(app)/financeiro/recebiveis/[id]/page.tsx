import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { formatCents } from "@/lib/financial/validation";
import { getFinancialReceivable, listFinancialInstallments } from "@/lib/financial/queries";
import { installmentVisualStatus } from "@/lib/financial/receivables";
import { todayInClinic } from "@/lib/agenda/dates";
import { isValidUuid } from "@/lib/patients/validation";
import { InstallmentPaymentForm, ReceivableCancelForm } from "../../ReceivableActions";

const labels = { pendente: "Pendente", parcialmente_pago: "Parcialmente pago", pago: "Pago", cancelado: "Cancelado", paga: "Paga", cancelada: "Cancelada", vencida: "Vencida" } as const;

export default async function FinancialReceivablePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (user.perfil === "dentista") redirect("/financeiro");
  const { id } = await params;
  if (!isValidUuid(id)) notFound();
  const [receivable, installments] = await Promise.all([getFinancialReceivable(id), listFinancialInstallments(id)]);
  if (!receivable) notFound();
  const paid = installments.filter((item) => item.status === "paga").reduce((total, item) => total + item.valor_centavos, 0);
  const open = Number(receivable.valor_total_centavos) - paid;
  const reference = receivable.atendimentos ? `Atendimento de ${String(receivable.atendimentos.iniciado_em).slice(0, 10)}` : receivable.orcamentos ? `Orçamento #${receivable.orcamentos.numero}` : "Paciente";
  return <div className="mx-auto max-w-5xl space-y-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><Link href="/financeiro" className="text-sm text-primary hover:underline">← Financeiro</Link><h2 className="mt-2 text-2xl font-medium">Recebível</h2><p className="mt-1 text-sm text-muted-foreground">{receivable.pacientes.nome} · {reference}</p></div>{user.perfil === "administrador" && receivable.status !== "cancelado" && receivable.status !== "pago" && <ReceivableCancelForm receivableId={id} patientId={String(receivable.paciente_id)}/>}</div><section className="grid gap-3 sm:grid-cols-4"><article className="rounded-lg border bg-card p-4"><p className="text-xs text-muted-foreground">Total</p><p className="mt-1 text-xl font-semibold">{formatCents(Number(receivable.valor_total_centavos))}</p></article><article className="rounded-lg border bg-card p-4"><p className="text-xs text-muted-foreground">Pago</p><p className="mt-1 text-xl font-semibold">{formatCents(paid)}</p></article><article className="rounded-lg border bg-card p-4"><p className="text-xs text-muted-foreground">Em aberto</p><p className="mt-1 text-xl font-semibold">{formatCents(open)}</p></article><article className="rounded-lg border bg-card p-4"><p className="text-xs text-muted-foreground">Status</p><p className="mt-1 text-xl font-semibold">{labels[receivable.status as keyof typeof labels]}</p></article></section><section className="overflow-hidden rounded-lg border bg-card"><div className="border-b px-4 py-3"><h3 className="font-medium">Parcelas</h3></div><div className="divide-y">{installments.map((item) => { const visual = installmentVisualStatus(item.status, item.vencimento, todayInClinic()); return <article key={item.id} className="grid gap-3 px-4 py-4 md:grid-cols-[.6fr_1fr_1fr_1fr_1.8fr] md:items-center"><span className="font-medium">{item.numero_parcela}/{item.total_parcelas}</span><span>{item.vencimento}</span><span>{formatCents(item.valor_centavos)}</span><span className="inline-flex w-fit rounded bg-secondary px-2 py-1 text-xs">{labels[visual]}</span>{item.status === "pendente" && receivable.status !== "cancelado" ? <InstallmentPaymentForm installmentId={item.id} receivableId={id} patientId={String(receivable.paciente_id)}/> : <span className="text-right text-xs text-muted-foreground">{item.pagamento_id ? "Pagamento registrado" : "—"}</span>}</article>; })}</div></section></div>;
}
