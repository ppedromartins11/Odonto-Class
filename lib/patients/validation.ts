import type {
  PatientClinicalAlertValues,
  PatientFormValues,
} from "./types";

type ValidationResult<T> =
  | { success: true; data: T }
  | { success: false; fieldErrors: Record<string, string> };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function optionalString(value: FormDataEntryValue | null) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

export function isValidUuid(value: string) {
  return UUID_PATTERN.test(value);
}

export function normalizePhoneSearch(value: string) {
  return value.replace(/[^0-9]+/g, "");
}

export function normalizeSearchInput(value: string | undefined) {
  return String(value ?? "").trim().slice(0, 100);
}

export function validatePatientFormData(
  formData: FormData
): ValidationResult<PatientFormValues> {
  const nome = String(formData.get("nome") ?? "").trim();
  const dataNascimento = optionalString(formData.get("dataNascimento"));
  const telefoneContato = optionalString(formData.get("telefoneContato"));
  const documentoIdentificacao = optionalString(
    formData.get("documentoIdentificacao")
  );
  const fieldErrors: Record<string, string> = {};

  if (nome.length < 2 || nome.length > 200) {
    fieldErrors.nome = "Informe um nome entre 2 e 200 caracteres.";
  }

  if (dataNascimento) {
    const parsed = /^\d{4}-\d{2}-\d{2}$/.test(dataNascimento)
      ? new Date(`${dataNascimento}T00:00:00Z`)
      : null;
    const today = new Date();
    const todayUtc = Date.UTC(
      today.getUTCFullYear(),
      today.getUTCMonth(),
      today.getUTCDate()
    );

    if (!parsed || Number.isNaN(parsed.getTime())) {
      fieldErrors.dataNascimento = "Informe uma data válida.";
    } else if (parsed.toISOString().slice(0, 10) !== dataNascimento) {
      fieldErrors.dataNascimento = "Informe uma data válida.";
    } else if (parsed.getTime() > todayUtc) {
      fieldErrors.dataNascimento = "A data de nascimento não pode estar no futuro.";
    }
  }

  if (telefoneContato && telefoneContato.length > 30) {
    fieldErrors.telefoneContato = "O telefone deve ter no máximo 30 caracteres.";
  }

  if (documentoIdentificacao && documentoIdentificacao.length > 80) {
    fieldErrors.documentoIdentificacao =
      "O documento deve ter no máximo 80 caracteres.";
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { success: false, fieldErrors };
  }

  return {
    success: true,
    data: {
      nome,
      dataNascimento,
      telefoneContato,
      documentoIdentificacao,
    },
  };
}

export function validateClinicalAlertsFormData(
  formData: FormData
): ValidationResult<PatientClinicalAlertValues> {
  const data: PatientClinicalAlertValues = {
    alergias: optionalString(formData.get("alergias")),
    intolerancias: optionalString(formData.get("intolerancias")),
    medicamentosEmUso: optionalString(formData.get("medicamentosEmUso")),
  };
  const fieldErrors: Record<string, string> = {};

  for (const [field, value] of Object.entries(data)) {
    if (value && value.length > 2000) {
      fieldErrors[field] = "Use no máximo 2.000 caracteres.";
    }
  }

  return Object.keys(fieldErrors).length > 0
    ? { success: false, fieldErrors }
    : { success: true, data };
}
