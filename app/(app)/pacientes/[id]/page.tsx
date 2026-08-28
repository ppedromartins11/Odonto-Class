import Link from "next/link";
import { notFound } from "next/navigation";
import {
  AlertTriangle,
  Activity,
  ArrowLeft,
  CalendarDays,
  CalendarPlus,
  Clock3,
  FileImage,
  FilePenLine,
  FileText,
  IdCard,
  Phone,
  Stethoscope,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { requireUser } from "@/lib/auth/session";
import { formatClinicDate, formatClinicTime, todayInClinic } from "@/lib/agenda/dates";
import { listPatientAppointments } from "@/lib/agenda/queries";
import {
  countPatientAttendances,
  getActivePatientAttendance,
  listAttendanceIdsByAppointment,
  listPatientAttendances,
  listPatientProcedures,
} from "@/lib/clinical/queries";
import { getPatient, getPatientClinicalAlerts } from "@/lib/patients/queries";
import { isValidUuid } from "@/lib/patients/validation";
import { listDocuments, listPatientFiles, listReturns } from "@/lib/operational/queries";
import { DirectAttendanceButton } from "../../atendimentos/DirectAttendanceButton";
import { PatientClinicalAlertsForm } from "../PatientClinicalAlertsForm";
import { PatientFiles } from "../PatientFiles";
import { PatientStatusControl } from "../PatientStatusControl";
import { ReturnStatusActions } from "../../retornos/ReturnStatusActions";

type Tab = "visao-geral" | "historico" | "consultas" | "atendimentos" | "procedimentos" | "documentos" | "retornos" | "arquivos-clinicos" | "arquivos-administrativos";
type SearchParams = Promise<{ aba?: string | string[] }>;

const STATUS_TONE = { agendado: "info", confirmado: "success", atendido: "neutral", cancelado: "danger", faltou: "warning" } as const;
const STATUS_LABEL = { agendado: "Agendado", confirmado: "Confirmado", atendido: "Atendido", cancelado: "Cancelado", faltou: "Faltou" } as const;
const RETURN_TONE = { pendente: "info", agendado: "neutral", concluido: "success", cancelado: "danger" } as const;
const RETURN_LABEL = { pendente: "Pendente", agendado: "Agendado", concluido: "Concluído", cancelado: "Cancelado" } as const;

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function isTab(value: string | undefined): value is Tab {
  return value === "visao-geral" || value === "historico" || value === "consultas" || value === "atendimentos" || value === "procedimentos" || value === "documentos" || value === "retornos" || value === "arquivos-clinicos" || value === "arquivos-administrativos";
}

function initials(name: string) {
  return name.trim().split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase();
}

function age(date: string | null) {
  if (!date) return null;
  const today = new Date();
  const birth = new Date(`${date}T00:00:00Z`);
  let years = today.getUTCFullYear() - birth.getUTCFullYear();
  if (today.getUTCMonth() < birth.getUTCMonth() || (today.getUTCMonth() === birth.getUTCMonth() && today.getUTCDate() < birth.getUTCDate())) years--;
  return years >= 0 ? years : null;
}

function patientSince(value: string) {
  const formatted = new Intl.DateTimeFormat("pt-BR", { month: "short", year: "numeric" }).format(new Date(value));
  return formatted.replace(". de ", "/").replace(" de ", "/").replace(".", "");
}

function formatDate(value: string | null) {
  return value ? formatClinicDate(value, { day: "2-digit", month: "long", year: "numeric" }) : "Não informada";
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">{children}</p>;
}

function CardTitle({ title, icon: Icon, action, tone = "text-primary" }: { title: string; icon: LucideIcon; action?: React.ReactNode; tone?: string }) {
  return <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="flex items-center gap-2 text-base font-medium text-foreground"><Icon className={`h-4 w-4 ${tone}`} />{title}</h3>{action}</div>;
}

function SummaryMetric({ label, value, detail, icon: Icon, tone = "text-primary" }: { label: string; value: string | number; detail: string; icon: LucideIcon; tone?: string }) {
  return <article className="rounded-lg border border-border bg-card p-3.5"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-1 truncate text-lg font-semibold text-foreground">{value}</p><p className="mt-0.5 truncate text-xs text-muted-foreground">{detail}</p></div><Icon className={`h-4 w-4 shrink-0 ${tone}`} /></div></article>;
}

function SectionTitle({ title, detail, action }: { title: string; detail?: string; action?: React.ReactNode }) {
  return <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-base font-medium text-foreground">{title}</h3>{detail && <p className="mt-1 text-xs text-muted-foreground">{detail}</p>}</div>{action}</div>;
}

export default async function PatientPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const user = await requireUser();
  const { id } = await params;
  if (!isValidUuid(id)) notFound();

  const patient = await getPatient(id);
  if (!patient) notFound();

  const tabValue = first((await searchParams).aba);
  const isDentist = user.perfil === "dentista";
  const requestedTab = isTab(tabValue) ? tabValue : "visao-geral";
  const activeTab: Tab = (!isDentist && (requestedTab === "atendimentos" || requestedTab === "procedimentos" || requestedTab === "arquivos-clinicos")) || (isDentist && requestedTab === "arquivos-administrativos")
    ? "visao-geral"
    : requestedTab;
  const loadsRecentHistory = activeTab === "visao-geral" || activeTab === "historico";
  const loadsClinicalTimeline = isDentist && (loadsRecentHistory || activeTab === "atendimentos");
  const [clinicalAlerts, appointments, attendances, returns, documents, files, attendanceCount, activeAttendance, procedureEntries] = await Promise.all([
    isDentist ? getPatientClinicalAlerts(id) : Promise.resolve(null),
    activeTab === "consultas" ? listPatientAppointments(id, 50) : loadsRecentHistory ? listPatientAppointments(id, 10) : Promise.resolve([]),
    activeTab === "atendimentos" && isDentist ? listPatientAttendances(id, 50) : loadsClinicalTimeline ? listPatientAttendances(id, 8) : Promise.resolve([]),
    activeTab === "retornos" ? listReturns(id, 50) : loadsRecentHistory ? listReturns(id, 4) : Promise.resolve([]),
    activeTab === "documentos" ? listDocuments(id, 50) : loadsRecentHistory ? listDocuments(id, 4) : Promise.resolve([]),
    activeTab === "arquivos-clinicos" || activeTab === "arquivos-administrativos" ? listPatientFiles(id, 50) : loadsRecentHistory ? listPatientFiles(id, 4) : Promise.resolve([]),
    isDentist && activeTab === "visao-geral" ? countPatientAttendances(id) : Promise.resolve(0),
    isDentist ? getActivePatientAttendance(id) : Promise.resolve(null),
    isDentist && (activeTab === "procedimentos" || activeTab === "atendimentos") ? listPatientProcedures(id, 50) : loadsClinicalTimeline ? listPatientProcedures(id, 8) : Promise.resolve([]),
  ]);
  const attendanceLinks = isDentist && activeTab === "consultas"
    ? await listAttendanceIdsByAppointment(appointments.map((appointment) => appointment.id))
    : [];
  const attendanceByAppointment = new Map(attendanceLinks.flatMap((attendance) => attendance.agendamento_id ? [[attendance.agendamento_id, attendance.id] as const] : []));
  const today = todayInClinic();
  const nextAppointment = [...appointments]
    .filter((appointment) => appointment.inicio >= `${today}T00:00:00`)
    .filter((appointment) => appointment.status === "agendado" || appointment.status === "confirmado")
    .sort((a, b) => a.inicio.localeCompare(b.inicio))[0];
  const nextReturn = [...returns]
    .filter((item) => item.status === "pendente" || item.status === "agendado")
    .sort((a, b) => a.data_prevista.localeCompare(b.data_prevista))[0];
  const lastAppointment = appointments.find((appointment) => appointment.inicio < new Date().toISOString());
  const lastAttendance = attendances[0];
  const lastProcedure = procedureEntries[0];
  const canManageReturns = user.perfil === "administrador" || user.perfil === "recepcao";
  const canSchedule = patient.ativo && (user.perfil === "administrador" || user.perfil === "recepcao");
  const tabs: { value: Tab; label: string }[] = [
    { value: "visao-geral", label: "Visão geral" },
    { value: "historico", label: "Histórico" },
    { value: "consultas", label: "Consultas" },
    ...(isDentist ? [{ value: "atendimentos" as Tab, label: "Atendimentos" }, { value: "procedimentos" as Tab, label: "Procedimentos" }] : []),
    { value: "documentos", label: "Documentos" },
    { value: "retornos", label: "Retornos" },
    ...(isDentist ? [{ value: "arquivos-clinicos" as Tab, label: "Fotos e arquivos clínicos" }] : [{ value: "arquivos-administrativos" as Tab, label: "Arquivos administrativos" }]),
  ];
  const recentHistory = [
    ...appointments.slice(0, 4).map((item) => ({ id: `appointment-${item.id}`, date: item.inicio, title: `Consulta ${STATUS_LABEL[item.status].toLowerCase()}`, description: item.profissional_nome })),
    ...documents.slice(0, 4).map((item) => ({ id: `document-${item.id}`, date: item.created_at, title: item.tipo === "atestado" ? "Atestado emitido" : "Declaração emitida", description: "PDF privado vinculado ao paciente" })),
    ...returns.slice(0, 4).map((item) => ({ id: `return-${item.id}`, date: item.created_at, title: "Retorno", description: `${RETURN_LABEL[item.status]} · previsto para ${formatClinicDate(item.data_prevista, { dateStyle: "short" })}` })),
    ...files.slice(0, 4).map((item) => ({ id: `file-${item.id}`, date: item.created_at, title: "Arquivo enviado", description: `${item.nome_original} · ${item.categoria}` })),
    ...(isDentist ? attendances.slice(0, 4).map((item) => ({ id: `attendance-${item.id}`, date: item.iniciado_em, title: "Atendimento", description: item.evolucao || (item.status === "finalizado" ? "Atendimento finalizado" : "Atendimento em andamento") })) : []),
    ...(isDentist ? procedureEntries.slice(0, 4).map((item) => ({ id: `procedure-${item.id}`, date: item.created_at, title: `Procedimento: ${item.descricao}`, description: `${item.attendance.profissional_nome}${item.dente ? ` · Dente/região ${item.dente}` : ""}${item.detalhes ? ` · ${item.detalhes}` : ""}` })) : []),
  ].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8);
  const ageInYears = age(patient.data_nascimento);
  const clinicalAlertCount = clinicalAlerts
    ? [clinicalAlerts.alergias, clinicalAlerts.intolerancias, clinicalAlerts.medicamentos_em_uso].filter(Boolean).length
    : 0;

  return (
    <div className="-m-3 min-h-[calc(100vh-3.5rem)] bg-card sm:-m-6">
      <header className="sticky top-14 z-[5] border-b border-border bg-card/95 px-4 pb-0 pt-4 shadow-sm backdrop-blur sm:px-6 sm:pt-5">
        <Link href="/pacientes" className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-primary">
          <ArrowLeft className="h-3.5 w-3.5" /> Voltar para pacientes
        </Link>

        <div className="mt-4 flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-blue-50 text-base font-medium text-primary">{initials(patient.nome)}</div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="truncate text-xl font-medium text-foreground">{patient.nome}</h2>
                <Badge tone={patient.ativo ? "success" : "neutral"}>{patient.ativo ? "Ativo" : "Inativo"}</Badge>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">{ageInYears !== null ? `${ageInYears} anos · ` : ""}Paciente desde {patientSince(patient.created_at)}</p>
              <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1"><Phone className="h-3.5 w-3.5" />{patient.telefone_contato ?? "Telefone não informado"}</span>
                {patient.documento_identificacao && <span className="inline-flex items-center gap-1"><IdCard className="h-3.5 w-3.5" />{patient.documento_identificacao}</span>}
              </div>
              {isDentist && clinicalAlerts?.alergias && <p className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-amber-700"><AlertTriangle className="h-3.5 w-3.5" />Alergia: {clinicalAlerts.alergias}</p>}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 xl:justify-end">
            {canSchedule && <Link href={`/agenda/novo?paciente=${patient.id}`} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90"><CalendarPlus className="h-4 w-4" /> Nova consulta</Link>}
            {patient.ativo && isDentist && !activeAttendance && <DirectAttendanceButton patientId={patient.id} />}
            {patient.ativo && isDentist && activeAttendance && <Link href={`/atendimentos/${activeAttendance.id}`} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90"><Stethoscope className="h-4 w-4" /> Registrar evolução</Link>}
            {patient.ativo && isDentist && activeAttendance && <Link href={`/atendimentos/${activeAttendance.id}#procedimentos`} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-secondary/70 px-3 text-sm font-medium text-foreground hover:bg-secondary"><Activity className="h-4 w-4" /> Adicionar procedimento</Link>}
            {patient.ativo && <Link href={`/documentos/novo?paciente=${patient.id}`} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-secondary/70 px-3 text-sm font-medium text-foreground hover:bg-secondary"><FileText className="h-4 w-4" /> Documento</Link>}
            <Link href={`/pacientes/${patient.id}/editar`} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-secondary/70 px-3 text-sm font-medium text-foreground hover:bg-secondary"><FilePenLine className="h-4 w-4" /> Editar</Link>
            {user.perfil === "administrador" && <PatientStatusControl patientId={patient.id} active={patient.ativo} />}
          </div>
        </div>

        {!patient.ativo && <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">Este paciente está inativo. O registro permanece preservado e pode ser reativado por um administrador.</div>}

        <nav className="mt-6 flex gap-0 overflow-x-auto" aria-label="Seções da ficha do paciente">
          {tabs.map((tab) => <Link key={tab.value} href={`/pacientes/${patient.id}?aba=${tab.value}`} className={`whitespace-nowrap border-b-2 px-3 py-3 text-sm font-medium transition-colors ${activeTab === tab.value ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"}`}>{tab.label}</Link>)}
        </nav>
      </header>

      <main className="bg-slate-50/70 px-4 py-5 sm:px-6">
        {activeTab === "visao-geral" && (
          <div className="space-y-4">
            <section className={`grid gap-3 sm:grid-cols-2 ${isDentist ? "xl:grid-cols-6" : "xl:grid-cols-3"}`} aria-label="Resumo rápido do paciente">
              <SummaryMetric label="Próxima consulta" value={nextAppointment ? formatClinicDate(nextAppointment.inicio, { dateStyle: "short" }) : "—"} detail={nextAppointment ? `${formatClinicTime(nextAppointment.inicio)} · ${nextAppointment.profissional_nome}` : "Nenhuma agendada"} icon={CalendarDays} />
              <SummaryMetric label="Última consulta" value={lastAppointment ? formatClinicDate(lastAppointment.inicio, { dateStyle: "short" }) : "—"} detail={lastAppointment ? STATUS_LABEL[lastAppointment.status] : "Sem histórico"} icon={Clock3} tone="text-slate-500" />
              <SummaryMetric label="Retorno pendente" value={nextReturn ? formatClinicDate(nextReturn.data_prevista, { dateStyle: "short" }) : "—"} detail={nextReturn ? RETURN_LABEL[nextReturn.status] : "Nenhum pendente"} icon={Clock3} tone="text-violet-600" />
              {isDentist && <SummaryMetric label="Atendimentos" value={attendanceCount} detail={lastAttendance ? `Último em ${formatClinicDate(lastAttendance.iniciado_em, { dateStyle: "short" })}` : "Nenhum realizado"} icon={Stethoscope} tone="text-blue-600" />}
              {isDentist && <SummaryMetric label="Último procedimento" value={lastProcedure?.descricao ?? "—"} detail={lastProcedure ? formatClinicDate(lastProcedure.created_at, { dateStyle: "short" }) : "Nenhum registrado"} icon={Activity} tone="text-emerald-600" />}
              {isDentist && <SummaryMetric label="Alertas importantes" value={clinicalAlertCount} detail={clinicalAlertCount ? "Revisar antes do atendimento" : "Nenhum informado"} icon={AlertTriangle} tone="text-amber-600" />}
            </section>

            <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(19rem,1fr)]">
            <div className="space-y-4">
              <section className="rounded-lg border border-border bg-card p-5">
                <CardTitle title="Próxima consulta" icon={CalendarDays} />
                {nextAppointment ? (
                  <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50/50 p-4">
                    <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
                      <div><dt className="text-xs text-muted-foreground">Data</dt><dd className="mt-0.5 text-sm font-medium text-foreground">{formatClinicDate(nextAppointment.inicio, { dateStyle: "short" })}</dd></div>
                      <div><dt className="text-xs text-muted-foreground">Horário</dt><dd className="mt-0.5 text-sm font-medium text-foreground">{formatClinicTime(nextAppointment.inicio)}–{formatClinicTime(nextAppointment.fim)}</dd></div>
                      <div><dt className="text-xs text-muted-foreground">Dentista</dt><dd className="mt-0.5 text-sm font-medium text-foreground">{nextAppointment.profissional_nome}</dd></div>
                      <div><dt className="text-xs text-muted-foreground">Status</dt><dd className="mt-1"><Badge tone={STATUS_TONE[nextAppointment.status]}>{STATUS_LABEL[nextAppointment.status]}</Badge></dd></div>
                    </dl>
                    <div className="mt-1 flex justify-end"><Link href={`/agenda?data=${today}`} className="text-xs font-medium text-primary hover:underline">Ver na agenda</Link></div>
                  </div>
                ) : <div className="mt-4"><Empty>Nenhuma consulta futura visível.</Empty></div>}
              </section>

              <section className="rounded-lg border border-border bg-card p-5">
                <SectionTitle title="Histórico recente" action={<Link href={`/pacientes/${patient.id}?aba=historico`} className="text-xs font-medium text-primary hover:underline">Ver histórico completo</Link>} />
                {recentHistory.length === 0 ? <div className="mt-4"><Empty>Nenhum evento recente visível.</Empty></div> : (
                  <ol className="mt-4 space-y-0">
                    {recentHistory.slice(0, 5).map((item, index) => <li key={item.id} className="relative grid grid-cols-[1rem_1fr] gap-3 pb-5 last:pb-0"><div className="relative flex justify-center"><span className="mt-1.5 h-2 w-2 rounded-full bg-primary" />{index < Math.min(recentHistory.length, 5) - 1 && <span className="absolute bottom-0 top-3 w-px bg-border" />}</div><div><p className="text-xs text-muted-foreground">{formatClinicDate(item.date, { dateStyle: "short" })}</p><p className="mt-0.5 text-sm font-medium text-foreground">{item.title}</p><p className="mt-0.5 text-xs leading-5 text-muted-foreground">{item.description}</p></div></li>)}
                  </ol>
                )}
              </section>

              {isDentist && lastAttendance && <section className="rounded-lg border border-border bg-card p-5"><SectionTitle title="Último atendimento" detail={`${formatClinicDate(lastAttendance.iniciado_em, { dateStyle: "short" })} · ${lastAttendance.status === "finalizado" ? "Finalizado" : "Em andamento"}`} action={<Link href={`/atendimentos/${lastAttendance.id}`} className="text-xs font-medium text-primary hover:underline">Abrir atendimento</Link>} /><p className="mt-4 line-clamp-4 whitespace-pre-wrap text-sm leading-6 text-foreground">{lastAttendance.evolucao || "Nenhuma evolução registrada ainda."}</p></section>}

              {isDentist && <section className="rounded-lg border border-border bg-card p-5"><SectionTitle title="Últimos procedimentos" action={<Link href={`/pacientes/${patient.id}?aba=procedimentos`} className="text-xs font-medium text-primary hover:underline">Ver todos</Link>} />{procedureEntries.length === 0 ? <div className="mt-4"><Empty>Nenhum procedimento registrado.</Empty></div> : <div className="mt-4 divide-y divide-border">{procedureEntries.slice(0, 3).map((entry) => <Link key={entry.id} href={`/atendimentos/${entry.attendance.id}`} className="block py-3 first:pt-0 last:pb-0"><p className="text-sm font-medium text-foreground hover:text-primary">{entry.descricao}</p><p className="mt-1 text-xs text-muted-foreground">{formatClinicDate(entry.created_at, { dateStyle: "short" })} · {entry.attendance.profissional_nome}{entry.dente ? ` · ${entry.dente}` : ""}</p></Link>)}</div>}</section>}
            </div>

            <aside className="space-y-4">
              {isDentist && clinicalAlerts ? (
                <section className="rounded-lg border border-border bg-card p-5">
                  <CardTitle title="Informações clínicas" icon={AlertTriangle} tone="text-amber-600" />
                  <div className="mt-4 space-y-3">
                    {clinicalAlerts.alergias && <div className="flex gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span><strong>Alergia:</strong> {clinicalAlerts.alergias}</span></div>}
                    <dl className="space-y-3 border-t border-border pt-3 text-xs">
                      <div><dt className="text-muted-foreground">Intolerâncias</dt><dd className="mt-1 whitespace-pre-wrap text-foreground">{clinicalAlerts.intolerancias ?? "Nenhuma informada"}</dd></div>
                      <div><dt className="text-muted-foreground">Medicamentos em uso</dt><dd className="mt-1 whitespace-pre-wrap text-foreground">{clinicalAlerts.medicamentos_em_uso ?? "Nenhum informado"}</dd></div>
                    </dl>
                  </div>
                  <details className="mt-4 border-t border-border pt-3"><summary className="cursor-pointer text-xs font-medium text-primary">Editar informações clínicas</summary><PatientClinicalAlertsForm patientId={patient.id} alerts={clinicalAlerts} embedded /></details>
                </section>
              ) : (
                <section className="rounded-lg border border-border bg-card p-5">
                  <CardTitle title="Dados do paciente" icon={IdCard} />
                  <dl className="mt-4 space-y-3 text-xs"><div><dt className="text-muted-foreground">Nascimento</dt><dd className="mt-1 text-foreground">{formatDate(patient.data_nascimento)}</dd></div><div><dt className="text-muted-foreground">Telefone</dt><dd className="mt-1 text-foreground">{patient.telefone_contato ?? "Não informado"}</dd></div><div><dt className="text-muted-foreground">Documento de identificação</dt><dd className="mt-1 break-words text-foreground">{patient.documento_identificacao ?? "Não informado"}</dd></div></dl>
                </section>
              )}

              <section className="rounded-lg border border-border bg-card p-5">
                <CardTitle title="Retorno" icon={Clock3} tone="text-violet-600" />
                {nextReturn ? <div className="mt-4"><p className="text-sm font-medium text-foreground">{formatClinicDate(nextReturn.data_prevista, { day: "2-digit", month: "long", year: "numeric" })}</p><div className="mt-1"><Badge tone={RETURN_TONE[nextReturn.status]}>{RETURN_LABEL[nextReturn.status]}</Badge></div>{nextReturn.agendamento_id ? <Link href="/agenda" className="mt-3 inline-block text-xs font-medium text-primary hover:underline">Abrir agenda vinculada</Link> : <Link href={`/pacientes/${patient.id}?aba=retornos`} className="mt-3 inline-block text-xs font-medium text-primary hover:underline">Ver retorno</Link>}</div> : <div className="mt-4"><Empty>Nenhum retorno pendente.</Empty></div>}
              </section>

              <section className="rounded-lg border border-border bg-card p-5">
                <CardTitle title="Documentos recentes" icon={FileText} tone="text-emerald-600" action={<Link href={`/pacientes/${patient.id}?aba=documentos`} className="text-xs font-medium text-primary hover:underline">Ver todos</Link>} />
                {documents.length === 0 ? <div className="mt-4"><Empty>Nenhum documento visível.</Empty></div> : <div className="mt-3 divide-y divide-border">{documents.slice(0, 3).map((document) => <a key={document.id} href={`/api/documentos/${document.id}`} className="flex items-center justify-between gap-3 py-2.5 text-xs hover:text-primary"><span className="font-medium">{document.tipo === "atestado" ? "Atestado" : "Declaração"}</span><span className="text-muted-foreground">{formatClinicDate(document.emitido_em, { dateStyle: "short" })}</span></a>)}</div>}
              </section>

              <section className="rounded-lg border border-border bg-card p-5">
                <CardTitle title={isDentist ? "Arquivos clínicos recentes" : "Arquivos administrativos recentes"} icon={FileImage} tone="text-blue-600" action={<Link href={`/pacientes/${patient.id}?aba=${isDentist ? "arquivos-clinicos" : "arquivos-administrativos"}`} className="text-xs font-medium text-primary hover:underline">Ver todos</Link>} />
                {files.length === 0 ? <div className="mt-4"><Empty>Nenhum arquivo visível.</Empty></div> : <div className="mt-3 divide-y divide-border">{files.slice(0, 3).map((file) => <a key={file.id} href={`/api/arquivos/${file.id}`} className="flex items-center justify-between gap-3 py-2.5 text-xs hover:text-primary"><span className="min-w-0 truncate font-medium">{file.nome_original}</span><span className="shrink-0 text-muted-foreground">{file.mime_type.includes("image") ? "Imagem" : "PDF"}</span></a>)}</div>}
              </section>
            </aside>
            </div>
          </div>
        )}

        {activeTab === "historico" && <section className="rounded-lg border border-border bg-card p-5"><SectionTitle title="Histórico" detail="Linha do tempo operacional visível para o seu perfil." />{recentHistory.length === 0 ? <div className="mt-4"><Empty>Nenhum evento visível.</Empty></div> : <ol className="mt-5 space-y-4 border-l border-border pl-5">{recentHistory.map((item) => <li key={item.id} className="relative"><span className="absolute -left-[1.6rem] top-1 h-3 w-3 rounded-full border-2 border-card bg-primary" /><p className="text-xs text-muted-foreground">{formatClinicDate(item.date, { dateStyle: "short" })}</p><p className="mt-0.5 text-sm font-medium text-foreground">{item.title}</p><p className="mt-1 text-xs text-muted-foreground">{item.description}</p></li>)}</ol>}</section>}

        {activeTab === "consultas" && (
          <section className="rounded-lg border border-border bg-card p-5">
            <SectionTitle title="Consultas" detail="Agendamentos visíveis para o seu perfil." action={<Link href={`/agenda?data=${today}`} className="text-sm font-medium text-primary hover:underline">Abrir agenda</Link>} />
            {appointments.length === 0 ? <div className="mt-4"><Empty>Nenhum agendamento visível.</Empty></div> : (
              <div className="mt-4 divide-y divide-border rounded-lg border border-border">
                {appointments.map((appointment) => {
                  const attendanceId = attendanceByAppointment.get(appointment.id);
                  return (
                    <article key={appointment.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="text-sm font-medium text-foreground">{formatClinicDate(appointment.inicio, { dateStyle: "short" })} · {formatClinicTime(appointment.inicio)}–{formatClinicTime(appointment.fim)}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">{appointment.profissional_nome}</p>
                        {appointment.observacoes_administrativas && <p className="mt-1 text-xs text-muted-foreground">{appointment.observacoes_administrativas}</p>}
                      </div>
                      <div className="flex items-center gap-3">
                        <Badge tone={STATUS_TONE[appointment.status]}>{STATUS_LABEL[appointment.status]}</Badge>
                        {attendanceId ? <Link href={`/atendimentos/${attendanceId}`} className="text-xs font-medium text-primary hover:underline">Abrir atendimento</Link> : <Link href={`/agenda?data=${appointment.inicio.slice(0, 10)}`} className="text-xs font-medium text-primary hover:underline">Ver na agenda</Link>}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {activeTab === "procedimentos" && isDentist && <section className="rounded-lg border border-border bg-card p-5"><SectionTitle title="Procedimentos" detail="Somente procedimentos de atendimentos próprios visíveis para o dentista autenticado." />{procedureEntries.length === 0 ? <div className="mt-4"><Empty>Nenhum procedimento próprio visível.</Empty></div> : <div className="mt-4 divide-y divide-border rounded-lg border border-border">{procedureEntries.map((entry) => <Link key={entry.id} href={`/atendimentos/${entry.attendance.id}`} className="block px-4 py-3 hover:bg-secondary"><p className="text-sm font-medium text-foreground">{entry.descricao}</p><p className="mt-1 text-xs text-muted-foreground">{formatClinicDate(entry.attendance.iniciado_em, { dateStyle: "short" })}{entry.dente ? ` · Dente/região: ${entry.dente}` : ""}{entry.material_utilizado ? ` · ${entry.material_utilizado}` : ""}</p></Link>)}</div>}</section>}

        {activeTab === "documentos" && <section className="rounded-lg border border-border bg-card p-5"><SectionTitle title="Documentos" detail="Downloads passam pela rota autorizada." action={patient.ativo ? <Link href={`/documentos/novo?paciente=${patient.id}`} className="text-sm font-medium text-primary hover:underline">Novo documento</Link> : undefined} />{documents.length === 0 ? <div className="mt-4"><Empty>Nenhum documento visível.</Empty></div> : <div className="mt-4 divide-y divide-border rounded-lg border border-border">{documents.map((document) => <a key={document.id} href={`/api/documentos/${document.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-secondary"><span className="font-medium text-primary">{document.tipo === "atestado" ? "Atestado" : "Declaração"}</span><span className="text-xs text-muted-foreground">{formatClinicDate(document.emitido_em, { dateStyle: "short" })}</span></a>)}</div>}</section>}

        {activeTab === "retornos" && (
          <section className="rounded-lg border border-border bg-card p-5">
            <SectionTitle title="Retornos" detail="Acompanhamento operacional vinculado ao paciente." action={<Link href="/retornos" className="text-sm font-medium text-primary hover:underline">Abrir retornos</Link>} />
            {returns.length === 0 ? <div className="mt-4"><Empty>Nenhum retorno visível.</Empty></div> : (
              <div className="mt-4 divide-y divide-border rounded-lg border border-border">
                {returns.map((item) => (
                  <article key={item.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-medium text-foreground">Previsto para {formatClinicDate(item.data_prevista, { dateStyle: "short" })}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{item.profissional_nome ?? "Profissional não informado"}</p>
                      {item.observacao_administrativa && <p className="mt-1 text-xs text-muted-foreground">{item.observacao_administrativa}</p>}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={RETURN_TONE[item.status]}>{RETURN_LABEL[item.status]}</Badge>
                      {canManageReturns && patient.ativo && item.status === "pendente" && <Link href={`/agenda/novo?paciente=${patient.id}&retorno=${item.id}`} className="text-xs font-medium text-primary hover:underline">Agendar</Link>}
                      {canManageReturns && <ReturnStatusActions returnId={item.id} status={item.status} />}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        )}

        {activeTab === "atendimentos" && isDentist && (
          <section className="rounded-lg border border-border bg-card p-5">
            <SectionTitle title="Atendimentos" detail="Evolução e procedimentos ficam restritos ao dentista autorizado." />
            {attendances.length === 0 ? <div className="mt-4"><Empty>Nenhum atendimento próprio visível.</Empty></div> : (
              <div className="mt-4 space-y-3">
                {attendances.map((attendance) => {
                  const attendanceProcedures = procedureEntries.filter((entry) => entry.atendimento_id === attendance.id);
                  return (
                    <article key={attendance.id} className="rounded-lg border border-border p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium text-foreground">{formatClinicDate(attendance.iniciado_em, { dateStyle: "short" })}</p>
                          <p className="mt-1 text-xs text-muted-foreground">{attendance.status === "finalizado" ? "Finalizado" : "Em andamento"}</p>
                        </div>
                        <Link href={`/atendimentos/${attendance.id}`} className="text-xs font-medium text-primary hover:underline">Abrir atendimento</Link>
                      </div>
                      <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-foreground">{attendance.evolucao || "Nenhuma evolução registrada."}</p>
                      {attendanceProcedures.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{attendanceProcedures.map((procedure) => <span key={procedure.id} className="rounded-full bg-secondary px-2.5 py-1 text-xs text-muted-foreground">{procedure.descricao}</span>)}</div>}
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {activeTab === "arquivos-clinicos" && isDentist && (
          <PatientFiles
            patientId={patient.id}
            files={files.filter((file) => file.categoria === "clinico")}
            canUpload={patient.ativo}
            category="clinico"
            title="Fotos e arquivos clínicos"
            description="Imagens e PDFs clínicos acessíveis somente por autorização server-side."
          />
        )}

        {activeTab === "arquivos-administrativos" && !isDentist && (
          <PatientFiles
            patientId={patient.id}
            files={files.filter((file) => file.categoria === "administrativo")}
            canUpload={patient.ativo && (user.perfil === "administrador" || user.perfil === "recepcao")}
            category="administrativo"
            title="Arquivos administrativos"
            description="Documentos operacionais sem conteúdo clínico, protegidos por download autorizado."
          />
        )}
      </main>
    </div>
  );
}
