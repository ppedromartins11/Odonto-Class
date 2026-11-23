"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { initialDomainActionState } from "@/lib/agenda/action-state";
import { toClinicLocalInput } from "@/lib/agenda/dates";
import type { ActiveProfessional, Appointment } from "@/lib/agenda/types";
import type { Patient } from "@/lib/patients/types";
import { createAppointment, updateAppointment } from "./actions";
import { PatientPicker } from "./PatientPicker";

function FieldError({ message }: { message?: string }) {
  return message ? <p className="mt-1 text-xs text-destructive">{message}</p> : null;
}

export function AppointmentForm({
  professionals,
  appointment,
  patient,
  defaultStart,
  defaultEnd,
  returnId,
  requestId,
}: {
  professionals: ActiveProfessional[];
  appointment?: Appointment;
  patient?: Patient | null;
  defaultStart?: string;
  defaultEnd?: string;
  returnId?: string | null;
  requestId?: string;
}) {
  const editing = Boolean(appointment);
  const [state, formAction, pending] = useActionState(
    editing ? updateAppointment : createAppointment,
    initialDomainActionState
  );
  const [stableRequestId] = useState(requestId ?? "");
  const start = appointment ? toClinicLocalInput(appointment.inicio) : defaultStart;
  const end = appointment ? toClinicLocalInput(appointment.fim) : defaultEnd;

  if (state.success && state.appointmentId) {
    return <section role="status" className="space-y-3 rounded-lg border border-green-200 bg-green-50 p-5 text-sm text-green-900">
      <h2 className="text-base font-medium">Agendamento confirmado</h2>
      <p>{returnId ? "A consulta foi criada e vinculada ao retorno." : "A consulta foi criada."}</p>
      <Link href={`/agenda/${state.appointmentId}/editar`} className="inline-flex rounded border border-green-300 px-3 py-2 font-medium hover:bg-green-100">Abrir consulta</Link>
    </section>;
  }

  return (
    <form action={formAction} className="space-y-5">
      {appointment && <input type="hidden" name="appointmentId" value={appointment.id} />}
      {!editing && stableRequestId && <input type="hidden" name="requestId" value={stableRequestId} />}
      {returnId && <input type="hidden" name="returnId" value={returnId} />}
      <section className="rounded-lg border border-border bg-card p-5">
        <div className="mb-5">
          <h2 className="text-base font-medium text-card-foreground">Dados do agendamento</h2>
          <p className="mt-1 text-xs text-muted-foreground">Horários são exibidos no fuso da clínica (Cuiabá).</p>
        </div>
        <div className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            {returnId && patient ? <div>
              <span className="mb-1.5 block text-foreground">Paciente do retorno</span>
              <input type="hidden" name="pacienteId" value={patient.id} />
              <p className="rounded-md border bg-input-background px-3 py-2 text-sm font-medium">{patient.nome}</p>
              <FieldError message={state.fieldErrors?.pacienteId} />
            </div> : <PatientPicker
              initialPatient={patient ? { id: patient.id, nome: patient.nome, telefone_contato: patient.telefone_contato } : null}
              error={state.fieldErrors?.pacienteId}
            />}
          </div>
          <div className="md:col-span-2">
            <label htmlFor="profissionalId" className="mb-1.5 block text-foreground">Profissional</label>
            <select
              id="profissionalId"
              name="profissionalId"
              required
              defaultValue={state.submitted?.profissionalId ?? appointment?.profissional_id ?? ""}
              className={`h-11 w-full min-w-0 max-w-full rounded-md border bg-input-background px-3 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-ring ${state.fieldErrors?.profissionalId ? "border-destructive" : "border-border"}`}
            >
              <option value="">Selecione</option>
              {professionals.map((professional) => (
                <option key={professional.id} value={professional.id}>{professional.nome}</option>
              ))}
            </select>
            <FieldError message={state.fieldErrors?.profissionalId} />
          </div>
          <div className="min-w-0">
            <label htmlFor="inicioLocal" className="mb-1.5 block text-foreground">Início</label>
            <Input id="inicioLocal" name="inicioLocal" type="datetime-local" required defaultValue={state.submitted?.inicioLocal ?? start} error={Boolean(state.fieldErrors?.inicioLocal)} />
            <FieldError message={state.fieldErrors?.inicioLocal} />
          </div>
          <div className="min-w-0">
            <label htmlFor="fimLocal" className="mb-1.5 block text-foreground">Fim</label>
            <Input id="fimLocal" name="fimLocal" type="datetime-local" required defaultValue={state.submitted?.fimLocal ?? end} error={Boolean(state.fieldErrors?.fimLocal)} />
            <FieldError message={state.fieldErrors?.fimLocal} />
          </div>
          <div className="md:col-span-2">
            <label htmlFor="observacoesAdministrativas" className="mb-1.5 block text-foreground">Observações administrativas</label>
            <textarea
              id="observacoesAdministrativas"
              name="observacoesAdministrativas"
              rows={3}
              maxLength={1000}
              defaultValue={state.submitted?.observacoesAdministrativas ?? appointment?.observacoes_administrativas ?? ""}
              placeholder="Somente informações operacionais; não registre conteúdo clínico."
              className={`w-full resize-y rounded-md border bg-input-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring ${state.fieldErrors?.observacoesAdministrativas ? "border-destructive" : "border-border"}`}
            />
            <FieldError message={state.fieldErrors?.observacoesAdministrativas} />
          </div>
        </div>
      </section>
      {!editing && professionals.length === 0 && <p role="alert" className="text-sm text-destructive">Nenhum profissional ativo disponível para agendamento. Avise a administração.</p>}
      {state.error && <p role="alert" className="text-sm text-destructive">{state.error}</p>}
      <div className="flex justify-end gap-2">
        <Link href={returnId ? "/retornos" : "/agenda"} className="inline-flex h-10 items-center rounded-md border border-border bg-secondary px-4 text-sm font-medium hover:bg-secondary/80">Cancelar</Link>
        <Button type="submit" disabled={pending || (!editing && professionals.length === 0)}>{pending ? "Salvando..." : editing ? "Salvar alterações" : "Criar agendamento"}</Button>
      </div>
    </form>
  );
}
