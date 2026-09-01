import Link from "next/link";
import { AlertTriangle, CalendarClock, FlaskConical, Plus } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { formatClinicDate, todayInClinic } from "@/lib/agenda/dates";
import { getValiditySterilizationSummary, listSterilizationCycles, listSterilizationEquipment, listSterilizationPackages } from "@/lib/validity/queries";
import { CYCLE_STATUSES, PACKAGE_EFFECTIVE_STATUSES, type CycleStatus, type PackageEffectiveStatus } from "@/lib/validity/types";
import { EquipmentActiveForm, EquipmentEditDialog, EquipmentForm, StartCycleForm } from "./SterilizationForms";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;
const cycleLabels: Record<CycleStatus, string> = { em_andamento: "Em andamento", concluido: "Concluído", reprovado: "Reprovado", cancelado: "Cancelado" };
const packageLabels: Record<PackageEffectiveStatus, string> = { pendente: "Pendente", valido: "Válido", proximo_do_vencimento: "Vencendo", vencido: "Vencido", utilizado: "Utilizado", descartado: "Descartado" };
const tones: Record<string, string> = { em_andamento: "bg-blue-50 text-blue-700", concluido: "bg-emerald-50 text-emerald-700", valido: "bg-emerald-50 text-emerald-700", proximo_do_vencimento: "bg-amber-50 text-amber-700", pendente: "bg-amber-50 text-amber-700", reprovado: "bg-red-50 text-red-700", vencido: "bg-red-50 text-red-700", cancelado: "bg-slate-100 text-slate-600", utilizado: "bg-blue-50 text-blue-700", descartado: "bg-slate-100 text-slate-600" };

export default async function SterilizationPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();
  const params = await searchParams;
  const rawCycle = first(params.ciclo);
  const cycleStatus = CYCLE_STATUSES.includes(rawCycle as CycleStatus) ? rawCycle as CycleStatus : undefined;
  const rawPackage = first(params.pacote);
  const packageStatus = PACKAGE_EFFECTIVE_STATUSES.includes(rawPackage as PackageEffectiveStatus) ? rawPackage as PackageEffectiveStatus : undefined;
  const cyclePage = Math.max(1, Number(first(params.cyclePage) ?? "1") || 1);
  const packagePage = Math.max(1, Number(first(params.packagePage) ?? "1") || 1);
  const [cycles, packages, equipment, summary] = await Promise.all([
    listSterilizationCycles({ status: cycleStatus, page: cyclePage }),
    listSterilizationPackages({ status: packageStatus, page: packagePage, today: todayInClinic() }),
    listSterilizationEquipment(),
    user.perfil === "dentista" ? Promise.resolve(null) : getValiditySterilizationSummary(),
  ]);
  const canOperate = user.perfil !== "dentista";
  const activeEquipment = equipment.filter(item => item.ativo);
  const cyclePages = Math.max(1, Math.ceil(cycles.total / cycles.pageSize));
  const packagePages = Math.max(1, Math.ceil(packages.total / packages.pageSize));
  const pageHref = (nextCyclePage = cyclePage, nextPackagePage = packagePage, nextCycleStatus = cycleStatus, nextPackageStatus = packageStatus) => {
    const query = new URLSearchParams();
    if (nextCycleStatus) query.set("ciclo", nextCycleStatus);
    if (nextPackageStatus) query.set("pacote", nextPackageStatus);
    if (nextCyclePage > 1) query.set("cyclePage", String(nextCyclePage));
    if (nextPackagePage > 1) query.set("packagePage", String(nextPackagePage));
    return `/esterilizacao${query.size ? `?${query}` : ""}`;
  };

  return <div className="mx-auto max-w-7xl space-y-5">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-2xl font-medium">Esterilização</h2><p className="mt-1 text-sm text-muted-foreground">Ciclos, pacotes, rastreabilidade e validade operacional.</p></div>{canOperate && <a href="#novo-ciclo" className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground"><Plus className="h-4 w-4" />Novo ciclo</a>}</header>
    {summary && <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6"><article className="rounded-xl border bg-card p-4"><p className="text-xs text-muted-foreground">Ciclos hoje</p><p className="mt-2 text-2xl font-semibold">{summary.ciclos_hoje}</p></article><article className="rounded-xl border bg-card p-4"><div className="flex justify-between"><span className="text-xs text-muted-foreground">Em andamento</span><FlaskConical className="h-4 w-4 text-blue-600" /></div><p className="mt-2 text-2xl font-semibold">{summary.ciclos_em_andamento}</p></article><article className="rounded-xl border bg-card p-4"><p className="text-xs text-muted-foreground">Pacotes válidos</p><p className="mt-2 text-2xl font-semibold">{summary.pacotes_validos}</p></article><article className="rounded-xl border bg-card p-4"><div className="flex justify-between"><span className="text-xs text-muted-foreground">Pacotes vencendo</span><CalendarClock className="h-4 w-4 text-amber-600" /></div><p className="mt-2 text-2xl font-semibold">{summary.pacotes_vencendo}</p></article><article className="rounded-xl border bg-card p-4"><div className="flex justify-between"><span className="text-xs text-muted-foreground">Pacotes vencidos</span><AlertTriangle className="h-4 w-4 text-red-600" /></div><p className="mt-2 text-2xl font-semibold">{summary.pacotes_vencidos}</p></article><article className="rounded-xl border bg-card p-4"><div className="flex justify-between"><span className="text-xs text-muted-foreground">Reprovados (30d)</span><FlaskConical className="h-4 w-4 text-red-600" /></div><p className="mt-2 text-2xl font-semibold">{summary.ciclos_reprovados}</p></article></section>}
    <section className="rounded-xl border bg-card"><div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4"><div><h3 className="font-medium">Ciclos</h3><p className="mt-1 text-xs text-muted-foreground">{cycles.total} ciclo(s) visível(is)</p></div><nav className="flex gap-1 overflow-x-auto"><Link href={pageHref(1, packagePage, undefined, packageStatus)} className={`rounded-full px-3 py-1.5 text-xs ${!cycleStatus ? "bg-primary text-primary-foreground" : "bg-secondary"}`}>Todos</Link>{CYCLE_STATUSES.map(status => <Link key={status} href={pageHref(1, packagePage, status, packageStatus)} className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs ${cycleStatus === status ? "bg-primary text-primary-foreground" : "bg-secondary"}`}>{cycleLabels[status]}</Link>)}</nav></div>{cycles.cycles.length === 0 ? <p className="p-5 text-sm text-muted-foreground">Nenhum ciclo encontrado.</p> : <div className="divide-y">{cycles.cycles.map(cycle => {
      const equipmentRelation = Array.isArray(cycle.equipamentos_esterilizacao) ? cycle.equipamentos_esterilizacao[0] : cycle.equipamentos_esterilizacao;
      const userRelation = Array.isArray(cycle.usuarios) ? cycle.usuarios[0] : cycle.usuarios;
      const currentStatus = (cycle.status ?? "cancelado") as CycleStatus;
      return <Link key={cycle.id} href={`/esterilizacao/${cycle.id}`} className="grid gap-1 px-5 py-4 hover:bg-secondary/50 md:grid-cols-[1fr_1fr_1fr_auto] md:items-center"><span className="font-medium">{cycle.codigo}</span><span className="text-sm text-muted-foreground">{equipmentRelation?.nome ?? "Equipamento"}</span><span className="text-sm text-muted-foreground">{formatClinicDate(cycle.iniciado_em, { dateStyle: "short", timeStyle: "short" })} · {userRelation?.nome ?? "Responsável"}</span><span className={`w-fit rounded px-2 py-1 text-xs font-medium ${tones[currentStatus]}`}>{cycleLabels[currentStatus]}</span></Link>;
    })}</div>}{cyclePages > 1 && <nav className="flex items-center justify-between border-t px-5 py-3 text-sm"><span>Página {cyclePage} de {cyclePages}</span><div className="flex gap-2">{cyclePage > 1 && <Link href={pageHref(cyclePage - 1)} className="rounded border px-3 py-1.5">Anterior</Link>}{cyclePage < cyclePages && <Link href={pageHref(cyclePage + 1)} className="rounded border px-3 py-1.5">Próxima</Link>}</div></nav>}</section>
    <section className="rounded-xl border bg-card"><div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4"><div><h3 className="font-medium">Pacotes</h3><p className="mt-1 text-xs text-muted-foreground">Situação calculada na data da clínica</p></div><nav className="flex max-w-full gap-1 overflow-x-auto"><Link href={pageHref(cyclePage, 1, cycleStatus, undefined)} className={`rounded-full px-3 py-1.5 text-xs ${!packageStatus ? "bg-primary text-primary-foreground" : "bg-secondary"}`}>Todos</Link>{PACKAGE_EFFECTIVE_STATUSES.map(status => <Link key={status} href={pageHref(cyclePage, 1, cycleStatus, status)} className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs ${packageStatus === status ? "bg-primary text-primary-foreground" : "bg-secondary"}`}>{packageLabels[status]}</Link>)}</nav></div>{packages.packages.length === 0 ? <p className="p-5 text-sm text-muted-foreground">Nenhum pacote encontrado.</p> : <div className="divide-y">{packages.packages.map(item => <Link key={item.id} href={`/esterilizacao/${item.ciclo_id}`} className="grid gap-1 px-5 py-3 hover:bg-secondary/50 md:grid-cols-[1fr_1.5fr_1fr_auto] md:items-center"><span className="font-medium">{item.codigo}</span><span className="text-sm">{item.descricao}</span><span className="text-sm text-muted-foreground">Validade {formatClinicDate(item.validade_ate, { dateStyle: "short" })}</span><span className={`w-fit rounded px-2 py-1 text-xs font-medium ${tones[item.effective_status]}`}>{packageLabels[item.effective_status]}</span></Link>)}</div>}{packagePages > 1 && <nav className="flex items-center justify-between border-t px-5 py-3 text-sm"><span>Página {packagePage} de {packagePages}</span><div className="flex gap-2">{packagePage > 1 && <Link href={pageHref(cyclePage, packagePage - 1)} className="rounded border px-3 py-1.5">Anterior</Link>}{packagePage < packagePages && <Link href={pageHref(cyclePage, packagePage + 1)} className="rounded border px-3 py-1.5">Próxima</Link>}</div></nav>}</section>
    <section className="rounded-xl border bg-card"><div className="border-b px-5 py-4"><h3 className="font-medium">Equipamentos</h3></div><div className="divide-y">{equipment.length === 0 ? <p className="p-5 text-sm text-muted-foreground">Nenhum equipamento cadastrado.</p> : equipment.map(item => <article key={item.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"><div><p className="font-medium">{item.nome} · {item.identificacao}</p><p className="text-xs text-muted-foreground">{[item.fabricante, item.modelo, item.numero_serie].filter(Boolean).join(" · ") || "Sem detalhes adicionais"}</p></div><div className="flex items-center gap-2"><span className={`rounded px-2 py-1 text-xs ${item.ativo ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{item.ativo ? "Ativo" : "Inativo"}</span>{user.perfil === "administrador" && <><EquipmentEditDialog equipment={item} /><EquipmentActiveForm id={item.id} active={item.ativo} /></>}</div></article>)}</div></section>
    {canOperate && <section id="novo-ciclo"><StartCycleForm equipment={activeEquipment} /></section>}
    {user.perfil === "administrador" && <EquipmentForm />}
  </div>;
}
