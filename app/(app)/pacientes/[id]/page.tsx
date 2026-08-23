import Link from "next/link";
import { notFound } from "next/navigation";
import { Calendar, CalendarPlus, ChevronLeft, FilePenLine, Phone, Stethoscope } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { requireUser } from "@/lib/auth/session";
import { formatClinicDate, formatClinicTime, todayInClinic } from "@/lib/agenda/dates";
import { listPatientAppointments } from "@/lib/agenda/queries";
import { listPatientAttendances } from "@/lib/clinical/queries";
import {
  getPatient,
  getPatientClinicalAlerts,
} from "@/lib/patients/queries";
import { isValidUuid } from "@/lib/patients/validation";
import { PatientClinicalAlertsForm } from "../PatientClinicalAlertsForm";
import { PatientStatusControl } from "../PatientStatusControl";
import { DirectAttendanceButton } from "../../atendimentos/DirectAttendanceButton";
import { listDocuments, listPatientFiles, listReturns } from "@/lib/operational/queries";
import { PatientFiles } from "../PatientFiles";

function formatDate(value: string | null) {
  if (!value) return "Não informada";
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(
    new Date(`${value}T00:00:00Z`)
  );
}

export default async function PatientPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  if (!isValidUuid(id)) notFound();

  const patient = await getPatient(id);
  if (!patient) notFound();

  // A consulta clinica sequer e executada para administrador ou recepcao.
  // RLS no banco repete a protecao para chamadas diretas.
  const [clinicalAlerts, appointments, attendances, returns, documents, files] = await Promise.all([
    user.perfil === "dentista" ? getPatientClinicalAlerts(id) : Promise.resolve(null),
    listPatientAppointments(id),
    user.perfil === "dentista" ? listPatientAttendances(id) : Promise.resolve([]),
    listReturns(id),
    listDocuments(id),
    listPatientFiles(id),
  ]);

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div>
        <Link
          href="/pacientes"
          className="mb-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-3.5 w-3.5" /> Voltar para pacientes
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-2xl font-medium text-foreground">{patient.nome}</h2>
              <Badge tone={patient.ativo ? "success" : "neutral"}>
                {patient.ativo ? "Ativo" : "Inativo"}
              </Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Ficha administrativa do paciente
            </p>
          </div>
          <div className="flex flex-wrap items-start gap-2">
            {patient.ativo && (user.perfil === "administrador" || user.perfil === "recepcao") && (
              <Link
                href={`/agenda/novo?paciente=${patient.id}`}
                className="inline-flex h-8 items-center justify-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                <CalendarPlus className="h-3.5 w-3.5" /> Agendar
              </Link>
            )}
            {patient.ativo && <Link href={`/documentos/novo?paciente=${patient.id}`} className="inline-flex h-8 items-center justify-center rounded-md border border-border bg-secondary px-3 text-sm font-medium hover:bg-secondary/80">Novo documento</Link>}
            {patient.ativo && user.perfil === "dentista" && (
              <DirectAttendanceButton patientId={patient.id} />
            )}
            <Link
              href={`/pacientes/${patient.id}/editar`}
              className="inline-flex h-8 items-center justify-center gap-2 rounded-md border border-border bg-secondary px-3 text-sm font-medium text-secondary-foreground hover:bg-secondary/80"
            >
              <FilePenLine className="h-3.5 w-3.5" /> Editar
            </Link>
            {user.perfil === "administrador" && (
              <PatientStatusControl patientId={patient.id} active={patient.ativo} />
            )}
          </div>
        </div>
      </div>

      {!patient.ativo && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Este paciente está inativo. O registro permanece preservado e pode ser reativado por um administrador.
        </div>
      )}

      <section className="rounded-lg border border-border bg-card p-5">
        <h3 className="text-base font-medium text-card-foreground">Dados administrativos</h3>
        <dl className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Calendar className="h-3.5 w-3.5" /> Data de nascimento
            </dt>
            <dd className="mt-1 text-sm text-foreground">{formatDate(patient.data_nascimento)}</dd>
          </div>
          <div>
            <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Phone className="h-3.5 w-3.5" /> Telefone
            </dt>
            <dd className="mt-1 text-sm text-foreground">
              {patient.telefone_contato ?? "Não informado"}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Documento de identificação</dt>
            <dd className="mt-1 text-sm text-foreground">
              {patient.documento_identificacao ?? "Não informado"}
            </dd>
          </div>
        </dl>
      </section>

      {user.perfil === "dentista" && clinicalAlerts && (
        <PatientClinicalAlertsForm patientId={patient.id} alerts={clinicalAlerts} />
      )}

      <section className="rounded-lg border border-border bg-card p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-medium">Agendamentos</h3>
            <p className="mt-1 text-xs text-muted-foreground">Histórico operacional mais recente visível para o seu perfil.</p>
          </div>
          <Link href={`/agenda?data=${todayInClinic()}`} className="text-xs font-medium text-primary hover:underline">Abrir agenda</Link>
        </div>
        {appointments.length === 0 ? (
          <p className="mt-4 rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">Nenhum agendamento visível.</p>
        ) : (
          <div className="mt-4 divide-y divide-border rounded-md border border-border">
            {appointments.map((appointment) => (
              <div key={appointment.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-medium">{formatClinicDate(appointment.inicio, { dateStyle: "short" })} · {formatClinicTime(appointment.inicio)}–{formatClinicTime(appointment.fim)}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{appointment.profissional_nome}</p>
                </div>
                <Badge tone={appointment.status === "confirmado" || appointment.status === "atendido" ? "success" : appointment.status === "cancelado" ? "danger" : appointment.status === "faltou" ? "warning" : "info"}>{appointment.status}</Badge>
              </div>
            ))}
          </div>
        )}
      </section>

      {user.perfil === "dentista" && (
        <section className="rounded-lg border border-border bg-card p-5">
          <h3 className="text-base font-medium">Meus atendimentos</h3>
          <p className="mt-1 text-xs text-muted-foreground">Somente registros clínicos do profissional autenticado.</p>
          {attendances.length === 0 ? (
            <p className="mt-4 rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">Nenhum atendimento clínico próprio.</p>
          ) : (
            <div className="mt-4 divide-y divide-border rounded-md border border-border">
              {attendances.map((attendance) => (
                <Link key={attendance.id} href={`/atendimentos/${attendance.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-secondary/40">
                  <span className="flex items-center gap-2 text-sm font-medium"><Stethoscope className="h-4 w-4 text-primary" />{formatClinicDate(attendance.iniciado_em, { dateStyle: "short" })} às {formatClinicTime(attendance.iniciado_em)}</span>
                  <Badge tone={attendance.status === "finalizado" ? "success" : "warning"}>{attendance.status === "finalizado" ? "Finalizado" : "Em andamento"}</Badge>
                </Link>
              ))}
            </div>
          )}
        </section>
      )}
      <section className="rounded-lg border border-border bg-card p-5"><h3 className="text-base font-medium">Retornos</h3>{returns.length===0?<p className="mt-3 text-sm text-muted-foreground">Nenhum retorno visível.</p>:<div className="mt-3 divide-y rounded border">{returns.map(item=><div key={item.id} className="p-3 text-sm">{item.status} · previsto para {item.data_prevista}</div>)}</div>}</section>
      <section className="rounded-lg border border-border bg-card p-5"><h3 className="text-base font-medium">Documentos</h3>{documents.length===0?<p className="mt-3 text-sm text-muted-foreground">Nenhum documento visível.</p>:<div className="mt-3 divide-y rounded border">{documents.map(document=><a key={document.id} href={`/api/documentos/${document.id}`} className="block p-3 text-sm font-medium text-primary hover:underline">{document.tipo} · {document.emitido_em}</a>)}</div>}</section>
      <PatientFiles patientId={patient.id} files={files} canUpload={patient.ativo && (user.perfil === "administrador" || user.perfil === "recepcao" || user.perfil === "dentista")} />
    </div>
  );
}
