import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { formatClinicDate, todayInClinic } from "@/lib/agenda/dates";
import { isValidUuid } from "@/lib/patients/validation";
import { packageEffectiveStatus } from "@/lib/validity/logic";
import { getSterilizationCycle } from "@/lib/validity/queries";
import type { CycleStatus, PackageEffectiveStatus, PackageStatus } from "@/lib/validity/types";
import { FinishCycleForm, PackageForm, PackageStatusForm } from "../SterilizationForms";

const cycleLabels: Record<CycleStatus, string> = { em_andamento: "Em andamento", concluido: "Concluído", reprovado: "Reprovado", cancelado: "Cancelado" };
const packageLabels: Record<PackageEffectiveStatus, string> = { pendente: "Pendente", valido: "Válido", proximo_do_vencimento: "Vencendo", vencido: "Vencido", utilizado: "Utilizado", descartado: "Descartado" };

export default async function SterilizationCyclePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser(); const { id } = await params; if (!isValidUuid(id)) notFound();
  const { cycle, packages } = await getSterilizationCycle(id); if (!cycle) notFound();
  const equipment = Array.isArray(cycle.equipamentos_esterilizacao) ? cycle.equipamentos_esterilizacao[0] : cycle.equipamentos_esterilizacao;
  const responsible = Array.isArray(cycle.usuarios) ? cycle.usuarios[0] : cycle.usuarios;
  const canOperate = user.perfil !== "dentista"; const isOpen = cycle.status === "em_andamento"; const today = todayInClinic(); const cycleStatus = (cycle.status ?? "cancelado") as CycleStatus;
  return <div className="mx-auto max-w-6xl space-y-5"><Link href="/esterilizacao" className="text-sm text-muted-foreground hover:text-foreground">← Voltar para esterilização</Link><header className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-2xl font-medium">{cycle.codigo}</h2><p className="mt-1 text-sm text-muted-foreground">{equipment?.nome ?? "Equipamento"} · {responsible?.nome ?? "Responsável"}</p></div><span className="rounded bg-secondary px-3 py-1 text-sm font-medium">{cycleLabels[cycleStatus]}</span></header><section className="grid gap-3 rounded-xl border bg-card p-5 sm:grid-cols-3"><div><p className="text-xs text-muted-foreground">Início</p><p className="mt-1 text-sm font-medium">{formatClinicDate(cycle.iniciado_em, { dateStyle: "short", timeStyle: "short" })}</p></div><div><p className="text-xs text-muted-foreground">Término</p><p className="mt-1 text-sm font-medium">{cycle.finalizado_em ? formatClinicDate(cycle.finalizado_em, { dateStyle: "short", timeStyle: "short" }) : "Em andamento"}</p></div><div><p className="text-xs text-muted-foreground">Observações</p><p className="mt-1 text-sm">{cycle.observacoes || "Nenhuma"}</p></div></section><section className="overflow-hidden rounded-xl border bg-card"><div className="border-b px-5 py-4"><h3 className="font-medium">Pacotes do ciclo</h3></div>{packages.length === 0 ? <p className="p-5 text-sm text-muted-foreground">Nenhum pacote vinculado.</p> : <div className="divide-y">{packages.map(item => {
    const effective = packageEffectiveStatus({ status: item.status_operacional as PackageStatus, validity: item.validade_ate, today }) ?? "pendente";
    return <article key={item.id} className="grid gap-2 px-5 py-4 md:grid-cols-[1fr_1.5fr_1fr_auto] md:items-center"><div><p className="font-medium">{item.codigo}</p><p className="text-xs text-muted-foreground">{packageLabels[effective]}</p></div><p className="text-sm">{item.descricao}</p><p className="text-sm text-muted-foreground">Validade {formatClinicDate(item.validade_ate, { dateStyle: "short" })}</p>{canOperate && item.status_operacional === "ativo" && <div className="flex flex-wrap gap-2"><PackageStatusForm packageId={item.id} cycleId={id} status="utilizado" /><PackageStatusForm packageId={item.id} cycleId={id} status="descartado" /></div>}</article>;
  })}</div>}</section>{canOperate && isOpen && <div className="grid gap-5 lg:grid-cols-2"><PackageForm cycleId={id} /><FinishCycleForm cycleId={id} /></div>}</div>;
}
