import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { isValidUuid } from "@/lib/patients/validation";
import { formatClinicDate } from "@/lib/agenda/dates";
import { getStockMaterial, listStockMovements } from "@/lib/stock/queries";
import { movementLabels, unitLabels } from "@/lib/stock/validation";
import { StockMaterialForm } from "../StockMaterialForm";
import { StockMovementForm } from "../StockMovementForm";
import { StockActiveForm } from "../StockActiveForm";

export default async function StockMaterialPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser(); const { id } = await params; if (!isValidUuid(id)) notFound();
  const [material, movementResult] = await Promise.all([getStockMaterial(id), listStockMovements({ materialId: id, page: 1, pageSize: 15 })]);
  if (!material) notFound(); const admin = user.perfil === "administrador";
  return <div className="mx-auto max-w-6xl space-y-5"><Link href="/estoque" className="text-sm text-muted-foreground hover:text-foreground">← Voltar para estoque</Link><header className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-2xl font-medium">{material.nome}</h2><p className="mt-1 text-sm text-muted-foreground">{material.categoria} · {unitLabels[material.unidade]}</p></div>{admin && <StockActiveForm materialId={material.id} active={material.ativo} />}</header>
    {admin && <StockMaterialForm material={material} />}
    {material.ativo && <section className="grid gap-4 lg:grid-cols-3"><StockMovementForm materialId={id} type="saida" profile={user.perfil} />{user.perfil !== "dentista" && <StockMovementForm materialId={id} type="entrada" profile={user.perfil} />}{admin && <StockMovementForm materialId={id} type="ajuste" profile={user.perfil} />}</section>}
    <section className="overflow-hidden rounded-xl border border-border bg-card"><div className="flex items-center justify-between border-b border-border px-5 py-4"><div><h3 className="font-medium">Movimentações recentes</h3><p className="mt-1 text-xs text-muted-foreground">{user.perfil === "dentista" ? "Somente suas movimentações." : "Histórico completo do material."}</p></div><Link href={`/estoque/movimentacoes?material=${id}`} className="text-sm font-medium text-primary hover:underline">Ver histórico</Link></div>{movementResult.movements.length === 0 ? <p className="p-5 text-sm text-muted-foreground">Nenhuma movimentação visível.</p> : <div className="divide-y">{movementResult.movements.map((movement) => <article key={movement.id} className="grid gap-1 px-5 py-3 text-sm md:grid-cols-[1fr_8rem_8rem_1fr]"><span>{formatClinicDate(movement.created_at, { dateStyle: "short", timeStyle: "short" })}</span><span className="font-medium">{movementLabels[movement.tipo]} · {movement.quantidade}</span><span>{movement.quantidade_anterior} → {movement.quantidade_posterior}</span><span className="text-muted-foreground">{movement.usuario_nome}{movement.motivo ? ` · ${movement.motivo}` : ""}</span></article>)}</div>}</section></div>;
}
