"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { initialPatientActionState } from "@/lib/patients/action-state";
import type { Patient } from "@/lib/patients/types";
import { createPatient, updatePatient } from "./actions";

type Props = {
  mode: "create" | "edit";
  patient?: Patient;
  canEditClinical?: boolean;
};

function FieldError({ message }: { message?: string }) {
  return message ? (
    <p className="mt-1 text-xs text-destructive">{message}</p>
  ) : null;
}

export function PatientForm({ mode, patient, canEditClinical = false }: Props) {
  const action = mode === "create" ? createPatient : updatePatient;
  const [state, formAction, pending] = useActionState(
    action,
    initialPatientActionState
  );
  const cancelHref = patient ? `/pacientes/${patient.id}` : "/pacientes";

  return (
    <form action={formAction} className="space-y-6">
      {patient && <input type="hidden" name="patientId" value={patient.id} />}

      <section className="rounded-lg border border-border bg-card p-5">
        <div className="mb-5">
          <h3 className="text-base font-medium text-card-foreground">
            Dados administrativos
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Somente o nome é obrigatório. Complete os demais dados quando estiverem disponíveis.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <label htmlFor="nome" className="mb-1.5 block text-foreground">
              Nome completo
            </label>
            <Input
              id="nome"
              name="nome"
              required
              minLength={2}
              maxLength={200}
              defaultValue={patient?.nome ?? ""}
              error={Boolean(state.fieldErrors?.nome)}
              autoComplete="name"
            />
            <FieldError message={state.fieldErrors?.nome} />
          </div>

          <div>
            <label htmlFor="dataNascimento" className="mb-1.5 block text-foreground">
              Data de nascimento
            </label>
            <Input
              id="dataNascimento"
              name="dataNascimento"
              type="date"
              defaultValue={patient?.data_nascimento ?? ""}
              error={Boolean(state.fieldErrors?.dataNascimento)}
            />
            <FieldError message={state.fieldErrors?.dataNascimento} />
          </div>

          <div>
            <label htmlFor="telefoneContato" className="mb-1.5 block text-foreground">
              Telefone de contato
            </label>
            <Input
              id="telefoneContato"
              name="telefoneContato"
              type="tel"
              maxLength={30}
              defaultValue={patient?.telefone_contato ?? ""}
              placeholder="Formato livre"
              error={Boolean(state.fieldErrors?.telefoneContato)}
              autoComplete="tel"
            />
            <FieldError message={state.fieldErrors?.telefoneContato} />
          </div>

          <div className="md:col-span-2">
            <label
              htmlFor="documentoIdentificacao"
              className="mb-1.5 block text-foreground"
            >
              Documento de identificação
            </label>
            <Input
              id="documentoIdentificacao"
              name="documentoIdentificacao"
              maxLength={80}
              defaultValue={patient?.documento_identificacao ?? ""}
              placeholder="Opcional, sem formato obrigatório"
              error={Boolean(state.fieldErrors?.documentoIdentificacao)}
            />
            <FieldError message={state.fieldErrors?.documentoIdentificacao} />
          </div>
        </div>
      </section>

      {mode === "create" && canEditClinical && (
        <section className="rounded-lg border border-border bg-card p-5">
          <div className="mb-5">
            <h3 className="text-base font-medium text-card-foreground">
              Alertas clínicos atuais
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Resumo atual para segurança do atendimento. Não substitui anamnese ou prontuário.
            </p>
          </div>
          <ClinicalFields fieldErrors={state.fieldErrors} />
        </section>
      )}

      {state.error && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}

      <div className="flex flex-wrap justify-end gap-2">
        <Link
          href={cancelHref}
          className="inline-flex h-10 items-center justify-center rounded-md border border-border bg-secondary px-4 text-sm font-medium text-secondary-foreground hover:bg-secondary/80"
        >
          Cancelar
        </Link>
        <Button type="submit" disabled={pending}>
          {pending
            ? "Salvando..."
            : mode === "create"
              ? "Cadastrar paciente"
              : "Salvar alterações"}
        </Button>
      </div>
    </form>
  );
}

export function ClinicalFields({
  values,
  fieldErrors,
}: {
  values?: {
    alergias?: string | null;
    intolerancias?: string | null;
    medicamentosEmUso?: string | null;
  };
  fieldErrors?: Record<string, string>;
}) {
  const fields = [
    { name: "alergias", label: "Alergias", value: values?.alergias },
    { name: "intolerancias", label: "Intolerâncias", value: values?.intolerancias },
    {
      name: "medicamentosEmUso",
      label: "Medicamentos em uso",
      value: values?.medicamentosEmUso,
    },
  ] as const;

  return (
    <div className="grid gap-4">
      {fields.map((field) => (
        <div key={field.name}>
          <label htmlFor={field.name} className="mb-1.5 block text-foreground">
            {field.label}
          </label>
          <textarea
            id={field.name}
            name={field.name}
            maxLength={2000}
            rows={3}
            defaultValue={field.value ?? ""}
            aria-invalid={Boolean(fieldErrors?.[field.name])}
            className={`w-full resize-y rounded-md border bg-input-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring ${
              fieldErrors?.[field.name] ? "border-destructive" : "border-border"
            }`}
            placeholder="Não informado"
          />
          <FieldError message={fieldErrors?.[field.name]} />
        </div>
      ))}
    </div>
  );
}
