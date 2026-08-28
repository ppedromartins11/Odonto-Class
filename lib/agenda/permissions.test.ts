import { describe, expect, it } from "vitest";
import { canCreateAppointment } from "./permissions";

describe("permissao visual para criar agendamento", () => {
  it.each(["administrador", "recepcao"] as const)(
    "exibe o CTA para %s",
    (profile) => expect(canCreateAppointment(profile)).toBe(true)
  );

  it("mantem o CTA indisponivel para dentista", () => {
    expect(canCreateAppointment("dentista")).toBe(false);
  });
});
