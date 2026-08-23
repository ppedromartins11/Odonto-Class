import { describe, expect, it } from "vitest";
import { addDays, startOfClinicWeek } from "./dates";
import { isValidLocalDateTime, validateAppointmentFormData } from "./validation";

describe("validacao de agenda", () => {
  it("valida data local e intervalo", () => {
    expect(isValidLocalDateTime("2026-08-24T09:30")).toBe(true);
    expect(isValidLocalDateTime("2026-02-30T09:30")).toBe(false);

    const form = new FormData();
    form.set("pacienteId", "11111111-1111-4111-8111-111111111111");
    form.set("profissionalId", "22222222-2222-4222-8222-222222222222");
    form.set("inicioLocal", "2026-08-24T10:00");
    form.set("fimLocal", "2026-08-24T09:00");
    const result = validateAppointmentFormData(form);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.fieldErrors.fimLocal).toBeDefined();
  });

  it("calcula semana de segunda a domingo", () => {
    expect(startOfClinicWeek("2026-08-23")).toBe("2026-08-17");
    expect(addDays("2026-08-31", 1)).toBe("2026-09-01");
  });
});
