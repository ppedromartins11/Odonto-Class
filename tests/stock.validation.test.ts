import { describe, expect, it } from "vitest";
import { calculateStockBalance, stockAlerts } from "../lib/stock/logic";
import { isStockMovementType, isStockStatus, isStockUnit, parseStockQuantity } from "../lib/stock/validation";

describe("estoque: validações e cálculos", () => {
  it("aceita somente unidades, tipos e quantidades válidos", () => {
    expect(isStockUnit("caixa")).toBe(true); expect(isStockUnit("litro")).toBe(false);
    expect(isStockMovementType("entrada")).toBe(true); expect(isStockMovementType("remocao")).toBe(false);
    expect(isStockStatus("vencido")).toBe(true); expect(parseStockQuantity(0)).toBe(0); expect(parseStockQuantity(0, false)).toBeNull();
    expect(parseStockQuantity(-1)).toBeNull(); expect(parseStockQuantity(1.5)).toBeNull(); expect(parseStockQuantity(1_000_001)).toBeNull();
  });

  it("calcula entrada, saída e ajuste sem permitir saldo negativo", () => {
    expect(calculateStockBalance(10, "entrada", 5)).toBe(15);
    expect(calculateStockBalance(10, "saida", 2)).toBe(8);
    expect(calculateStockBalance(20, "ajuste", 18)).toBe(18);
    expect(calculateStockBalance(20, "ajuste", 0)).toBe(0);
    expect(calculateStockBalance(10, "saida", 20)).toBeNull();
    expect(calculateStockBalance(10, "entrada", 0)).toBeNull();
  });

  it("mantém alertas simultâneos de estoque e validade", () => {
    expect(stockAlerts({ active: true, quantity: 5, minimum: 5, validity: "2026-09-15", today: "2026-08-28" })).toEqual({ low: true, expiring: true, expired: false });
    expect(stockAlerts({ active: true, quantity: 5, minimum: 5, validity: "2026-08-27", today: "2026-08-28" })).toEqual({ low: true, expiring: false, expired: true });
    expect(stockAlerts({ active: false, quantity: 0, minimum: 5, validity: "2026-08-27", today: "2026-08-28" })).toEqual({ low: false, expiring: false, expired: false });
  });
});
