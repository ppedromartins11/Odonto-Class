import { describe, expect, it } from "vitest";
import { isBudgetStatus, parseCents } from "./validation";

describe("budget validation", () => {
  it("accepts only the approved lifecycle statuses", () => {
    expect(isBudgetStatus("rascunho")).toBe(true);
    expect(isBudgetStatus("convertido")).toBe(true);
    expect(isBudgetStatus("cancelado")).toBe(false);
  });

  it("accepts safe non-negative cent amounts only", () => {
    expect(parseCents(0)).toBe(0);
    expect(parseCents(12345)).toBe(12345);
    expect(parseCents(-1)).toBeNull();
    expect(parseCents(12.5)).toBeNull();
    expect(parseCents(100_000_001)).toBeNull();
  });
});
