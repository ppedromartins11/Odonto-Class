import { describe, expect, it } from "vitest";
import { canTransitionCycle, daysUntil, packageEffectiveStatus, validityStatus } from "./logic";

describe("validade operacional", () => {
  const today = "2026-08-31";
  it("classifica fronteiras e precedências", () => {
    expect(validityStatus({ quantity: 1, active: true, validity: today, today })).toBe("proximo_do_vencimento");
    expect(validityStatus({ quantity: 1, active: true, validity: "2026-09-30", today })).toBe("proximo_do_vencimento");
    expect(validityStatus({ quantity: 1, active: true, validity: "2026-10-01", today })).toBe("valido");
    expect(validityStatus({ quantity: 1, active: true, validity: "2026-08-30", today })).toBe("vencido");
    expect(validityStatus({ quantity: 0, active: true, validity: "2026-08-30", today })).toBe("esgotado");
    expect(validityStatus({ quantity: 5, active: false, validity: "2027-01-01", today })).toBe("inativo");
  });
  it("rejeita datas inválidas", () => {
    expect(daysUntil("2026-02-30", today)).toBeNull();
    expect(validityStatus({ quantity: -1, active: true, validity: today, today })).toBeNull();
  });
});

describe("esterilização", () => {
  const today = "2026-08-31";
  it("preserva estado operacional antes da validade derivada", () => {
    expect(packageEffectiveStatus({ status: "utilizado", validity: "2027-01-01", today })).toBe("utilizado");
    expect(packageEffectiveStatus({ status: "descartado", validity: "2027-01-01", today })).toBe("descartado");
    expect(packageEffectiveStatus({ status: "ativo", validity: "2026-08-30", today })).toBe("vencido");
  });
  it("permite apenas transições finais a partir de em andamento", () => {
    expect(canTransitionCycle("em_andamento", "concluido")).toBe(true);
    expect(canTransitionCycle("concluido", "em_andamento")).toBe(false);
    expect(canTransitionCycle("reprovado", "concluido")).toBe(false);
  });
});
