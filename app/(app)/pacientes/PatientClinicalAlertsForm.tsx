"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/Button";
import { initialPatientActionState } from "@/lib/patients/action-state";
import type { PatientClinicalAlerts } from "@/lib/patients/types";
import { updatePatientClinicalAlerts } from "./actions";
import { ClinicalFields } from "./PatientForm";

export function PatientClinicalAlertsForm({
  patientId,
  alerts,
}: {
  patientId: string;
  alerts: PatientClinicalAlerts;
}) {
  const [state, formAction, pending] = useActionState(
    updatePatientClinicalAlerts,
    initialPatientActionState
  );

  return (
    <form action={formAction} className="rounded-lg border border-border bg-card p-5">
      <input type="hidden" name="patientId" value={patientId} />
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-medium text-card-foreground">Alertas clínicos atuais</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Visível apenas para dentistas ativos. Não substitui o prontuário.
          </p>
        </div>
      </div>

      <ClinicalFields
        values={{
          alergias: alerts.alergias,
          intolerancias: alerts.intolerancias,
          medicamentosEmUso: alerts.medicamentos_em_uso,
        }}
        fieldErrors={state.fieldErrors}
      />

      {state.error && (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {state.error}
        </p>
      )}
      {state.success && (
        <p role="status" className="mt-4 text-sm text-green-700">
          Alertas clínicos atualizados.
        </p>
      )}

      <div className="mt-4 flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? "Salvando..." : "Salvar alertas"}
        </Button>
      </div>
    </form>
  );
}
