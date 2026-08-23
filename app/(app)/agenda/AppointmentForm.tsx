"use client";

import Link from "next/link";
import { useActionState } from "react";
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
}: {
  professionals: ActiveProfessional[];
  appointment?: Appointment;
  patient?: Patient | null;
  defaultStart?: string;
  defaultEnd?: string;
  returnId?: string | null;
}) {
  const editing = Boolean(appointment);
  const [state, formAction, pending] = useActionState(
    editing ? updateAppointment : createAppointment,
    initialDomainActionState
  );
  const start = appointment ? toClinicLocalInput(appointment.inicio) : defaultStart;
  const end = appointment ? toClinicLocalInput(appointment.fim) : defaultEnd;

  return (
    <form action={formAction} className="space-y-5">
      {appointment && <input type="hidden" name="appointmentId" value={appointment.id} />}
      {returnId && <input type="hidden" name="returnId" value={returnId} />}
      <section className="rounded-lg border border-border bg-card p-5">
        <div className="mb-5">
          <h3 className="text-base font-medium text-card-foreground">Dados do agendamento</h3>
          <p className="mt-1 text-xs text-muted-foreground">Horários são exibidos no fuso da clínica (Cuiabá).</p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <PatientPicker
              initialPatient={patient ? { id: patient.id, nome: patient.nome, telefone_contato: patient.telefone_contato } : null}
              error={state.fieldErrors?.pacienteId}
            />
          </div>
          <div className="md:col-span-2">
            <label htmlFor="profissionalId" className="mb-1.5 block text-foreground">Profissional</label>
            <select
              id="profissionalId"
              name="profissionalId"
              required
              defaultValue={appointment?.profissional_id ?? ""}
              className={`h-10 w-full rounded-md border bg-input-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring ${state.fieldErrors?.profissionalId ? "border-destructive" : "border-border"}`}
            >
              <option value="">Selecione</option>
              {professionals.map((professional) => (
                <option key={professional.id} value={professional.id}>{professional.nome}</option>
              ))}
            </select>
            <FieldError message={state.fieldErrors?.profissionalId} />
          </div>
          <div>
            <label htmlFor="inicioLocal" className="mb-1.5 block text-foreground">Início</label>
            <Input id="inicioLocal" name="inicioLocal" type="datetime-local" required defaultValue={start} error={Boolean(state.fieldErrors?.inicioLocal)} />
            <FieldError message={state.fieldErrors?.inicioLocal} />
          </div>
          <div>
            <label htmlFor="fimLocal" className="mb-1.5 block text-foreground">Fim</label>
            <Input id="fimLocal" name="fimLocal" type="datetime-local" required defaultValue={end} error={Boolean(state.fieldErrors?.fimLocal)} />
            <FieldError message={state.fieldErrors?.fimLocal} />
          </div>
          <div className="md:col-span-2">
            <label htmlFor="observacoesAdministrativas" className="mb-1.5 block text-foreground">Observações administrativas</label>
            <textarea
              id="observacoesAdministrativas"
              name="observacoesAdministrativas"
              rows={3}
              maxLength={1000}
              defaultValue={appointment?.observacoes_administrativas ?? ""}
              placeholder="Somente informações operacionais; não registre conteúdo clínico."
              className={`w-full resize-y rounded-md border bg-input-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring ${state.fieldErrors?.observacoesAdministrativas ? "border-destructive" : "border-border"}`}
            />
            <FieldError message={state.fieldErrors?.observacoesAdministrativas} />
          </div>
        </div>
      </section>
      {state.error && <p role="alert" className="text-sm text-destructive">{state.error}</p>}
      <div className="flex justify-end gap-2">
        <Link href="/agenda" className="inline-flex h-10 items-center rounded-md border border-border bg-secondary px-4 text-sm font-medium hover:bg-secondary/80">Cancelar</Link>
        <Button type="submit" disabled={pending}>{pending ? "Salvando..." : editing ? "Salvar alterações" : "Criar agendamento"}</Button>
      </div>
    </form>
  );
}
