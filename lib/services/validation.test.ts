import { describe, expect, it } from "vitest";
import { parseCents, parsePositiveInteger } from "./validation";

describe("serviços: valores e quantidades", () => {
  it("converte valor decimal em centavos sem usar float persistido", () => {
    expect(parseCents("180")).toBe(18000);
    expect(parseCents("180,50")).toBe(18050);
    expect(parseCents("0")).toBe(0);
    expect(parseCents("1.999")).toBeNull();
  });
  it("aceita somente quantidade inteira positiva", () => {
    expect(parsePositiveInteger("1")).toBe(1);
    expect(parsePositiveInteger("0")).toBeNull();
    expect(parsePositiveInteger("-1")).toBeNull();
    expect(parsePositiveInteger("1.5")).toBeNull();
  });
});
