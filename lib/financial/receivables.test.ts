import { describe, expect, it } from "vitest";
import { installmentVisualStatus, receivableStatus, splitInstallments } from "./receivables";

describe("receivables domain", () => {
  it("distributes residual cents deterministically without floating point", () => {
    expect(splitInstallments(10_000, 3)).toEqual([3334, 3333, 3333]);
    expect(splitInstallments(100, 3)?.reduce((total, value) => total + value, 0)).toBe(100);
  });

  it("rejects invalid installment plans", () => {
    expect(splitInstallments(0, 1)).toBeNull();
    expect(splitInstallments(100, 0)).toBeNull();
    expect(splitInstallments(100, 121)).toBeNull();
  });

  it("derives receivable and overdue statuses", () => {
    expect(receivableStatus(1000, 0)).toBe("pendente");
    expect(receivableStatus(1000, 500)).toBe("parcialmente_pago");
    expect(receivableStatus(1000, 1000)).toBe("pago");
    expect(receivableStatus(1000, 1000, true)).toBe("cancelado");
    expect(installmentVisualStatus("pendente", "2026-09-01", "2026-09-02")).toBe("vencida");
    expect(installmentVisualStatus("paga", "2026-09-01", "2026-09-02")).toBe("paga");
  });
});
