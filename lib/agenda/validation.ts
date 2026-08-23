import { isValidUuid } from "../patients/validation";
import type { AppointmentFormValues } from "./types";

type ValidationResult<T> =
  | { success: true; data: T }
  | { success: false; fieldErrors: Record<string, string> };

function optionalString(value: FormDataEntryValue | null) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

export function isValidLocalDateTime(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}:00Z`);
  return !Number.isNaN(parsed.getTime())
    && parsed.toISOString().slice(0, 16) === value;
}

export function validateAppointmentFormData(
  formData: FormData
): ValidationResult<AppointmentFormValues> {
  const pacienteId = String(formData.get("pacienteId") ?? "");
  const profissionalId = String(formData.get("profissionalId") ?? "");
  const inicioLocal = String(formData.get("inicioLocal") ?? "");
  const fimLocal = String(formData.get("fimLocal") ?? "");
  const observacoesAdministrativas = optionalString(
    formData.get("observacoesAdministrativas")
  );
  const fieldErrors: Record<string, string> = {};

  if (!isValidUuid(pacienteId)) fieldErrors.pacienteId = "Selecione um paciente válido.";
  if (!isValidUuid(profissionalId)) fieldErrors.profissionalId = "Selecione um profissional válido.";
  if (!isValidLocalDateTime(inicioLocal)) fieldErrors.inicioLocal = "Informe data e hora inicial válidas.";
  if (!isValidLocalDateTime(fimLocal)) fieldErrors.fimLocal = "Informe data e hora final válidas.";
  if (!fieldErrors.inicioLocal && !fieldErrors.fimLocal && fimLocal <= inicioLocal) {
    fieldErrors.fimLocal = "O horário final deve ser posterior ao inicial.";
  }
  if (observacoesAdministrativas && observacoesAdministrativas.length > 1000) {
    fieldErrors.observacoesAdministrativas = "Use no máximo 1.000 caracteres.";
  }

  return Object.keys(fieldErrors).length > 0
    ? { success: false, fieldErrors }
    : {
        success: true,
        data: {
          pacienteId,
          profissionalId,
          inicioLocal,
          fimLocal,
          observacoesAdministrativas,
        },
      };
}
