import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { formatClinicDate, todayInClinic } from "@/lib/agenda/dates";
import { isValidUuid } from "@/lib/patients/validation";
import { validityStatus } from "@/lib/validity/logic";
import { getValidityLot, listValidityLotMovements } from "@/lib/validity/queries";
import { LotActiveForm, LotAdjustmentForm, LotExitForm, LotMetadataForm } from "../ValidityForms";

const movementLabels: Record<string, string> = { entrada: "Entrada", saida: "Saída", ajuste: "Ajuste" };

export default async function ValidityLotPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser(); const { id } = await params; if (!isValidUuid(id)) notFound();
  const [lot, movements] = await Promise.all([getValidityLot(id), listValidityLotMovements(id)]); if (!lot) notFound();
  const material = Array.isArray(lot.materiais_estoque) ? lot.materiais_estoque[0] : lot.materiais_estoque;
  const today = todayInClinic();
  const status = validityStatus({ quantity: lot.quantidade_atual, active: lot.ativo, validity: lot.data_validade, today });
  const available = lot.ativo && lot.data_validade >= today ? lot.quantidade_atual : 0;

  return <div className="mx-auto max-w-5xl space-y-5">
    <Link href="/validade" className="text-sm text-muted-foreground hover:text-foreground">← Voltar para validade</Link>
    <header className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-2xl font-medium">{material?.nome} · {lot.codigo_lote}</h2><p className="mt-1 text-sm capitalize text-muted-foreground">Status: {status?.replaceAll("_", " ")}</p></div>{user.perfil === "administrador" && <LotActiveForm lotId={id} active={lot.ativo} />}</header>
    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{[["Saldo físico", lot.quantidade_atual], ["Disponível para uso", available], ["Quantidade recebida", lot.quantidade_inicial], ["Validade", formatClinicDate(lot.data_validade, { dateStyle: "short" })]].map(([label, value]) => <article key={String(label)} className="rounded-xl border bg-card p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-2 text-lg font-semibold">{value}</p></article>)}</section>
    <section className="rounded-xl border bg-card p-5"><h3 className="font-medium">Dados do lote</h3><dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2"><div><dt className="text-muted-foreground">Fabricação</dt><dd>{lot.data_fabricacao ? formatClinicDate(lot.data_fabricacao, { dateStyle: "short" }) : "Não informada"}</dd></div><div><dt className="text-muted-foreground">Fornecedor</dt><dd>{lot.fornecedor ?? "Não informado"}</dd></div></dl></section>
    {user.perfil !== "dentista" && lot.ativo && lot.quantidade_atual > 0 && <LotExitForm materialId={lot.material_id} lotId={lot.id} />}
    {user.perfil === "administrador" && <div className="grid gap-5 lg:grid-cols-2"><LotMetadataForm lot={lot} />{lot.ativo && <LotAdjustmentForm lotId={lot.id} materialId={lot.material_id} currentQuantity={lot.quantidade_atual} />}</div>}
    <section className="overflow-hidden rounded-xl border bg-card"><div className="border-b px-5 py-4"><h3 className="font-medium">Histórico do lote</h3><p className="mt-1 text-xs text-muted-foreground">Movimentações append-only visíveis para o seu perfil.</p></div>{movements.length === 0 ? <p className="p-5 text-sm text-muted-foreground">Nenhuma movimentação visível.</p> : <div className="divide-y">{movements.map(item => {
      const movement = Array.isArray(item.movimentacoes_estoque) ? item.movimentacoes_estoque[0] : item.movimentacoes_estoque;
      const actor = movement && (Array.isArray(movement.usuarios) ? movement.usuarios[0] : movement.usuarios);
      return <article key={item.id} className="grid gap-1 px-5 py-3 text-sm md:grid-cols-[8rem_7rem_8rem_1fr]"><span>{movement ? formatClinicDate(movement.created_at, { dateStyle: "short", timeStyle: "short" }) : "—"}</span><span className="font-medium">{movementLabels[movement?.tipo ?? ""] ?? "Movimento"} · {item.quantidade}</span><span>{item.quantidade_lote_anterior} → {item.quantidade_lote_posterior}</span><span className="text-muted-foreground">{actor?.nome ?? "Usuário"}{item.finalidade_saida ? ` · ${item.finalidade_saida}` : ""}{movement?.motivo ? ` · ${movement.motivo}` : ""}</span></article>;
    })}</div>}</section>
  </div>;
}
