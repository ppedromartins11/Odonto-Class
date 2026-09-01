import { describe, expect, it } from "vitest";
import {
  FDI_TEETH,
  isValidFdiTooth,
  normalizeFdiTeeth,
  parseFdiTeeth,
  serializeFdiTeeth,
  toggleFdiTooth,
} from "./fdi";

describe("dominio FDI permanente", () => {
  it("aceita os 32 dentes permanentes e rejeita codigos fora do dominio", () => {
    expect(FDI_TEETH).toHaveLength(32);
    expect(FDI_TEETH.every(isValidFdiTooth)).toBe(true);
    for (const invalid of [10, 19, 20, 29, 30, 39, 40, 49, 99, 16.5, "16"]) {
      expect(isValidFdiTooth(invalid)).toBe(false);
    }
  });

  it("remove duplicidades e ordena a selecao", () => {
    expect(normalizeFdiTeeth([26, 16, 17, 16])).toEqual([16, 17, 26]);
    expect(normalizeFdiTeeth([])).toEqual([]);
  });

  it("falha integralmente quando qualquer codigo e invalido", () => {
    expect(() => normalizeFdiTeeth([16, 99])).toThrow("INVALID_FDI_TOOTH");
  });

  it("seleciona e deseleciona sem duplicidade", () => {
    expect(toggleFdiTooth([16], 17)).toEqual([16, 17]);
    expect(toggleFdiTooth([16, 17], 16)).toEqual([17]);
  });

  it("serializa e le o payload do formulario", () => {
    expect(serializeFdiTeeth([18, 16, 16])).toBe("[16,18]");
    expect(parseFdiTeeth("[18,16,16]")).toEqual([16, 18]);
    expect(parseFdiTeeth("")).toEqual([]);
    expect(() => parseFdiTeeth("[99]")).toThrow("INVALID_FDI_TOOTH");
    expect(() => parseFdiTeeth("nao-json")).toThrow("INVALID_FDI_PAYLOAD");
  });
});
