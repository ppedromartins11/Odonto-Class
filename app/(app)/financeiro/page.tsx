import Link from "next/link";
import { DollarSign, Plus } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { todayInClinic } from "@/lib/agenda/dates";
import { formatCents, isPaymentMethod, isPaymentStatus } from "@/lib/financial/validation";
import { getPaymentSummary, listFinancialReceivables, listPayments } from "@/lib/financial/queries";
import { loadFinancialPage, parseFinancialPage } from "@/lib/financial/pagination";
import type { PaymentMethod, PaymentStatus } from "@/lib/financial/types";
import type { ReceivableStatus } from "@/lib/financial/receivables";
import { PaymentStatusActions } from "./PaymentStatusActions";

const methodLabels: Record<PaymentMethod, string> = {
  pix: "PIX", dinheiro: "Dinheiro", cartao_credito: "Cartão de crédito",
  cartao_debito: "Cartão de débito", transferencia: "Transferência", outro: "Outro",
};
const statusLabels: Record<PaymentStatus, string> = { pago: "Pago", cancelado: "Cancelado", estornado: "Estornado" };
const receivableStatusLabels: Record<ReceivableStatus, string> = { pendente: "Pendente", parcialmente_pago: "Parcialmente pago", pago: "Pago", cancelado: "Cancelado" };
type SearchParams = Promise<{ q?: string; paciente?: string; inicio?: string; fim?: string; forma?: string; status?: string; page?: string; recebivel?: string; vencidos?: string; recebivelPage?: string }>;

export default async function FinancialPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();
  const p = await searchParams;
  const requestedPaymentPage = parseFinancialPage(p.page);
  const method: PaymentMethod | undefined = isPaymentMethod(p.forma ?? "") ? p.forma as PaymentMethod : undefined;
  const status: PaymentStatus | undefined = isPaymentStatus(p.status ?? "") ? p.status as PaymentStatus : undefined;
  const receivableStatus: ReceivableStatus | undefined = ["pendente", "parcialmente_pago", "pago", "cancelado"].includes(p.recebivel ?? "") ? p.recebivel as ReceivableStatus : undefined;
  const requestedReceivablePage = parseFinancialPage(p.recebivelPage);
  const today = todayInClinic();
  const firstDay = `${today.slice(0, 7)}-01`;
  const [paymentList, summary, receivableList] = await Promise.all([
    loadFinancialPage(requestedPaymentPage, (page) => listPayments({ query: p.q ?? "", patientId: p.paciente, startDate: p.inicio, endDate: p.fim, method, status, page }), (result) => result.payments.length > 0),
    user.perfil === "administrador" ? getPaymentSummary(p.inicio ?? firstDay, p.fim ?? today) : Promise.resolve(null),
    user.perfil === "dentista" ? Promise.resolve(null) : loadFinancialPage(requestedReceivablePage, (page) => listFinancialReceivables({ query: p.q ?? "", status: receivableStatus, overdue: p.vencidos === "1", page }), (result) => result.receivables.length > 0),
  ]);
  const { result, page, pages } = paymentList;
  const receivables = receivableList?.result;
  const receivablePage = receivableList?.page ?? 1;
  const receivablePages = receivableList?.pages ?? 1;
  const pageHref = (key: "page" | "recebivelPage", nextPage: number) => {
    const values = new URLSearchParams();
    for (const [name, value] of Object.entries(p)) if (name !== "page" && name !== "recebivelPage" && typeof value === "string" && value) values.set(name, value);
    values.set("page", String(key === "page" ? nextPage : page));
    values.set("recebivelPage", String(key === "recebivelPage" ? nextPage : receivablePage));
    return `/financeiro?${values}`;
  };

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="text-2xl font-medium">Financeiro</h1><p className="mt-1 text-sm text-muted-foreground">Controle de pagamentos da clínica.</p></div>
        {user.perfil !== "dentista" && <div className="flex gap-2"><Link href="/financeiro/recebiveis/novo" className="inline-flex h-9 items-center gap-2 rounded bg-primary px-3 text-sm font-medium text-primary-foreground"><Plus className="h-4 w-4" />Novo recebível</Link><Link href="/financeiro/novo" className="inline-flex h-9 items-center gap-2 rounded border px-3 text-sm font-medium">Pagamento avulso</Link></div>}
      </div>

      {summary && <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <article className="rounded-lg border bg-card p-4"><p className="text-xs text-muted-foreground">Recebido hoje</p><p className="mt-1 text-xl font-semibold">{formatCents(summary.recebido_hoje_centavos)}</p></article>
        <article className="rounded-lg border bg-card p-4"><p className="text-xs text-muted-foreground">Recebido no período</p><p className="mt-1 text-xl font-semibold">{formatCents(summary.recebido_periodo_centavos)}</p></article>
        <article className="rounded-lg border bg-card p-4"><p className="text-xs text-muted-foreground">Pagamentos pagos</p><p className="mt-1 text-xl font-semibold">{summary.quantidade_pagamentos}</p></article>
        <article className="rounded-lg border bg-card p-4"><p className="text-xs text-muted-foreground">A receber</p><p className="mt-1 text-xl font-semibold">{formatCents(summary.a_receber_centavos)}</p></article>
        <article className="rounded-lg border border-red-200 bg-red-50/30 p-4"><p className="text-xs text-red-700">Vencido</p><p className="mt-1 text-xl font-semibold text-red-800">{formatCents(summary.vencido_centavos)}</p></article>
      </section>}

      {user.perfil !== "dentista" && receivables && <section className="space-y-3 rounded-lg border bg-card p-4" aria-labelledby="receivables-title"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 id="receivables-title" className="font-medium">Contas a receber</h2><p className="mt-1 text-xs text-muted-foreground">Obrigações financeiras e parcelas pendentes.</p></div><form className="flex flex-wrap gap-2"><input type="hidden" name="q" value={p.q ?? ""}/><input type="hidden" name="page" value={page}/><input type="hidden" name="paciente" value={p.paciente ?? ""}/><input type="hidden" name="inicio" value={p.inicio ?? ""}/><input type="hidden" name="fim" value={p.fim ?? ""}/><input type="hidden" name="forma" value={p.forma ?? ""}/><input type="hidden" name="status" value={p.status ?? ""}/><select aria-label="Status do recebível" name="recebivel" defaultValue={receivableStatus ?? ""} className="h-9 rounded border bg-background px-2 text-xs"><option value="">Todos</option>{Object.entries(receivableStatusLabels).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select><label className="inline-flex h-9 items-center gap-1 rounded border px-2 text-xs"><input name="vencidos" value="1" type="checkbox" defaultChecked={p.vencidos === "1"}/>Vencidos</label><button className="h-9 rounded border px-3 text-xs">Filtrar</button></form></div>{receivables.receivables.length === 0 ? <p className="rounded border border-dashed px-4 py-6 text-sm text-muted-foreground">Nenhum recebível encontrado para os filtros atuais.</p> : <div className="overflow-hidden rounded border"><div className="hidden grid-cols-[1.2fr_1fr_.7fr_.7fr_.8fr_auto] gap-3 border-b px-3 py-2 text-xs uppercase text-muted-foreground md:grid"><span>Paciente</span><span>Origem</span><span>Total</span><span>Em aberto</span><span>Vencimento</span><span>Status</span></div><div className="divide-y">{receivables.receivables.map((item) => <Link key={item.id} href={`/financeiro/recebiveis/${item.id}`} className="grid gap-1 px-3 py-3 text-sm hover:bg-secondary/50 md:grid-cols-[1.2fr_1fr_.7fr_.7fr_.8fr_auto] md:items-center md:gap-3"><span className="font-medium">{item.paciente_nome}</span><span className="text-muted-foreground">{item.referencia}</span><span>{formatCents(item.valor_total_centavos)}</span><span>{formatCents(Number(item.valor_aberto_centavos))}</span><span className={item.proximo_vencimento && item.proximo_vencimento < today ? "text-red-700" : ""}>{item.proximo_vencimento ?? "—"}</span><span className="inline-flex w-fit rounded bg-secondary px-2 py-1 text-xs">{receivableStatusLabels[item.status]}</span></Link>)}</div></div>}{receivables.total > 0 && <p className="text-xs text-muted-foreground">Recebíveis: página {receivablePage} de {receivablePages} · {receivables.total} registro(s)</p>}{receivablePages > 1 && <nav aria-label="Páginas de recebíveis" className="flex flex-wrap justify-end gap-2 text-sm">{receivablePage > 1 && <Link href={pageHref("recebivelPage", receivablePage - 1)} className="rounded border px-3 py-1.5">Anterior</Link>}{receivablePage < receivablePages && <Link href={pageHref("recebivelPage", receivablePage + 1)} className="rounded border px-3 py-1.5">Próxima</Link>}</nav>}</section>}

      <form className="grid gap-2 rounded-lg border bg-card p-3 md:grid-cols-6">
        <input type="hidden" name="paciente" value={p.paciente ?? ""} />
        <input type="hidden" name="recebivel" value={p.recebivel ?? ""} />
        <input type="hidden" name="vencidos" value={p.vencidos ?? ""} />
        <input type="hidden" name="recebivelPage" value={receivablePage} />
        <input aria-label="Buscar paciente" name="q" defaultValue={p.q} placeholder="Buscar paciente" className="h-10 rounded border bg-background px-3 text-sm" />
        <input aria-label="Data inicial" name="inicio" type="date" defaultValue={p.inicio} className="h-10 rounded border bg-background px-3 text-sm" />
        <input aria-label="Data final" name="fim" type="date" defaultValue={p.fim} className="h-10 rounded border bg-background px-3 text-sm" />
        <select aria-label="Forma de pagamento" name="forma" defaultValue={method ?? ""} className="h-10 rounded border bg-background px-3 text-sm"><option value="">Todas as formas</option>{Object.entries(methodLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
        <select aria-label="Status do pagamento" name="status" defaultValue={status ?? ""} className="h-10 rounded border bg-background px-3 text-sm"><option value="">Todos os status</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
        <button className="h-10 rounded border text-sm font-medium hover:bg-secondary">Filtrar</button>
      </form>

      {result.payments.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center"><DollarSign className="mx-auto h-8 w-8 text-muted-foreground" /><h2 className="mt-3 font-medium">Nenhum pagamento encontrado.</h2></div>
      ) : (
        <div className="overflow-hidden rounded-lg border bg-card">
          <div className="hidden grid-cols-[.8fr_1.4fr_1fr_1fr_.8fr_.8fr_1fr] gap-3 border-b px-4 py-3 text-xs uppercase text-muted-foreground md:grid"><span>Data</span><span>Paciente</span><span>Referência</span><span>Forma</span><span>Valor</span><span>Status</span><span>Responsável</span></div>
          <div className="divide-y">
            {result.payments.map((payment) => <article key={payment.id} className="grid gap-1 px-4 py-4 text-sm md:grid-cols-[.8fr_1.4fr_1fr_1fr_.8fr_.8fr_1fr] md:items-center md:gap-3">
              <span>{payment.data_pagamento}</span>
              <Link href={`/pacientes/${payment.paciente_id}?aba=pagamentos`} className="font-medium hover:text-primary">{payment.paciente_nome}</Link>
              <span className="text-muted-foreground">{payment.referencia}</span><span>{methodLabels[payment.forma]}</span><span className="font-medium">{formatCents(payment.valor_centavos)}</span>
              <span className="inline-flex w-fit rounded bg-secondary px-2 py-1 text-xs">{statusLabels[payment.status]}</span>
              <div className="flex flex-wrap items-center gap-2"><span className="text-muted-foreground">{payment.responsavel_nome}</span>{user.perfil === "administrador" && <PaymentStatusActions paymentId={payment.id} patientId={payment.paciente_id} status={payment.status} />}</div>
            </article>)}
          </div>
        </div>
      )}

      {result.total > 0 && <p className="text-right text-xs text-muted-foreground">Pagamentos: página {page} de {pages} · {result.total} registro(s)</p>}
      {pages > 1 && <nav aria-label="Páginas de pagamentos" className="flex flex-wrap justify-end gap-2 text-sm">{page > 1 && <Link href={pageHref("page", page - 1)} className="rounded border px-3 py-1.5">Anterior</Link>}{page < pages && <Link href={pageHref("page", page + 1)} className="rounded border px-3 py-1.5">Próxima</Link>}</nav>}
    </div>
  );
}
