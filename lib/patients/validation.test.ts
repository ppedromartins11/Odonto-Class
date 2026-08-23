import { describe, expect, it } from "vitest";
import {
  isValidUuid,
  normalizePhoneSearch,
  normalizeSearchInput,
  validateClinicalAlertsFormData,
  validatePatientFormData,
} from "./validation";

function patientForm(values: Record<string, string>) {
  const formData = new FormData();
  for (const [key, value] of Object.entries(values)) formData.set(key, value);
  return formData;
}

describe("validacao de pacientes", () => {
  it("normaliza campos opcionais sem impor formato de telefone ou documento", () => {
    const result = validatePatientFormData(
      patientForm({
        nome: "  Paciente Fictício  ",
        telefoneContato: "  +00 (65) 90000-0000  ",
        documentoIdentificacao: "  DOC-ficticio/1  ",
      })
    );

    expect(result).toEqual({
      success: true,
      data: {
        nome: "Paciente Fictício",
        dataNascimento: null,
        telefoneContato: "+00 (65) 90000-0000",
        documentoIdentificacao: "DOC-ficticio/1",
      },
    });
  });

  it("rejeita nome curto e data futura", () => {
    const result = validatePatientFormData(
      patientForm({ nome: "A", dataNascimento: "2999-01-01" })
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.fieldErrors.nome).toBeDefined();
      expect(result.fieldErrors.dataNascimento).toBeDefined();
    }
  });

  it("rejeita data de calendario inexistente", () => {
    const result = validatePatientFormData(
      patientForm({ nome: "Paciente Fictício", dataNascimento: "2025-02-31" })
    );
    expect(result.success).toBe(false);
  });

  it("limita textos clinicos sem exigir preenchimento", () => {
    const empty = validateClinicalAlertsFormData(patientForm({}));
    expect(empty).toEqual({
      success: true,
      data: { alergias: null, intolerancias: null, medicamentosEmUso: null },
    });

    const tooLong = validateClinicalAlertsFormData(
      patientForm({ alergias: "x".repeat(2001) })
    );
    expect(tooLong.success).toBe(false);
  });

  it("normaliza telefone e limita a entrada de busca", () => {
    expect(normalizePhoneSearch("+00 (65) 90000-1234")).toBe("0065900001234");
    expect(normalizeSearchInput(`  ${"a".repeat(120)}  `)).toHaveLength(100);
  });

  it("valida UUID sem aceitar texto arbitrario", () => {
    expect(isValidUuid("6ba7b810-9dad-41d1-80b4-00c04fd430c8")).toBe(true);
    expect(isValidUuid("nao-e-uuid")).toBe(false);
  });
});
