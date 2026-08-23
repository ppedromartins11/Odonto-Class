import type { ProcedureFormValues } from "./types";

type ValidationResult<T> =
  | { success: true; data: T }
  | { success: false; fieldErrors: Record<string, string> };

function optionalString(value: FormDataEntryValue | null) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

export function validateEvolution(value: FormDataEntryValue | null, required = false) {
  const evolution = optionalString(value);
  const fieldErrors: Record<string, string> = {};
  if (required && !evolution) fieldErrors.evolucao = "Registre a evolução antes de finalizar.";
  if (evolution && evolution.length > 10000) {
    fieldErrors.evolucao = "Use no máximo 10.000 caracteres.";
  }
  return Object.keys(fieldErrors).length > 0
    ? ({ success: false, fieldErrors } as const)
    : ({ success: true, data: evolution } as const);
}

export function validateProcedureFormData(
  formData: FormData
): ValidationResult<ProcedureFormValues> {
  const data: ProcedureFormValues = {
    descricao: String(formData.get("descricao") ?? "").trim(),
    dente: optionalString(formData.get("dente")),
    materialUtilizado: optionalString(formData.get("materialUtilizado")),
    corResina: optionalString(formData.get("corResina")),
    detalhes: optionalString(formData.get("detalhes")),
  };
  const fieldErrors: Record<string, string> = {};
  if (data.descricao.length < 2 || data.descricao.length > 500) {
    fieldErrors.descricao = "Informe uma descrição entre 2 e 500 caracteres.";
  }
  if (data.dente && data.dente.length > 80) fieldErrors.dente = "Use no máximo 80 caracteres.";
  if (data.materialUtilizado && data.materialUtilizado.length > 500) {
    fieldErrors.materialUtilizado = "Use no máximo 500 caracteres.";
  }
  if (data.corResina && data.corResina.length > 80) fieldErrors.corResina = "Use no máximo 80 caracteres.";
  if (data.detalhes && data.detalhes.length > 2000) fieldErrors.detalhes = "Use no máximo 2.000 caracteres.";
  return Object.keys(fieldErrors).length > 0
    ? { success: false, fieldErrors }
    : { success: true, data };
}
