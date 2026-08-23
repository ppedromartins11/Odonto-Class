import { describe, expect, it } from "vitest";
import { validateEvolution, validateProcedureFormData } from "./validation";

describe("validacao clinica minima", () => {
  it("exige evolucao apenas ao finalizar", () => {
    expect(validateEvolution("", false).success).toBe(true);
    expect(validateEvolution("", true).success).toBe(false);
    expect(validateEvolution("Evolução fictícia", true).success).toBe(true);
  });

  it("aceita procedimento sem dente e normaliza opcionais", () => {
    const form = new FormData();
    form.set("descricao", "Profilaxia fictícia");
    form.set("dente", "");
    const result = validateProcedureFormData(form);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.dente).toBeNull();
  });
});
