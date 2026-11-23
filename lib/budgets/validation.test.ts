import { describe, expect, it } from "vitest";
import { isBudgetStatus, parseBudgetItems, parseCents, parseReaisToCents } from "./validation";

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
    expect(parseCents(null)).toBeNull();
    expect(parseCents("")).toBeNull();
    expect(parseCents("20000")).toBeNull();
    expect(parseCents(Number.NaN)).toBeNull();
  });
});

describe("orçamento em reais no Safari e no Brasil", () => {
  it.each([
    ["200,00", 20000],
    ["200.00", 20000],
    ["200", 20000],
    ["1.234,56", 123456],
    ["R$ 200,00", 20000],
    ["0,99", 99],
    ["0", 0],
  ])("converte %s em centavos inteiros sem erro de ponto flutuante", (raw, cents) => {
    expect(parseReaisToCents(raw)).toBe(cents);
  });

  it.each(["", "-", "abc", "200,000", "1,2,3", "-20,00", "1000001,00", "1e3"])(
    "rejeita valor monetário inválido %s", (raw) => {
      expect(parseReaisToCents(raw)).toBeNull();
    }
  );
});

describe("validação dos itens antes de salvar", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  const filled = { descricao: "Clareamento", quantidade: 1, valorUnitarioCentavos: 20000 };

  it("aceita o item preenchido do print", () => {
    expect(parseBudgetItems(JSON.stringify([filled]))).toMatchObject({
      error: null,
      items: [{ descricao: "Clareamento", quantidade: 1, valorUnitarioCentavos: 20000 }],
    });
  });

  it("ignora item novo removido mesmo com campos vazios", () => {
    const removed = { descricao: "", quantidade: 0, valorUnitarioCentavos: null, removed: true };
    expect(parseBudgetItems(JSON.stringify([filled, removed]))).toMatchObject({ error: null, items: [filled] });
  });

  it("preserva remoção de item salvo sem exigir seus campos antigos", () => {
    const removed = { id, descricao: "", quantidade: 0, valorUnitarioCentavos: null, removed: true };
    const result = parseBudgetItems(JSON.stringify([filled, removed]));
    expect(result.error).toBeNull();
    expect(result.items?.[1]).toMatchObject({ id, removed: true });
  });

  it.each([
    [{ ...filled, valorUnitarioCentavos: null }, /valor unitário inválido/],
    [{ ...filled, valorUnitarioCentavos: "200,00" }, /valor unitário inválido/],
    [{ ...filled, descricao: " " }, /descrição/],
    [{ ...filled, quantidade: 0 }, /quantidade/],
    [{ ...filled, quantidade: 1.5 }, /quantidade/],
  ])("indica o campo que realmente está inválido", (item, pattern) => {
    expect(parseBudgetItems(JSON.stringify([item])).error).toMatch(pattern);
  });

  it("exige ao menos um item ativo e rejeita JSON malformado", () => {
    expect(parseBudgetItems("[]").error).toMatch(/pelo menos um item/);
    expect(parseBudgetItems("not json").error).toMatch(/interpretar/);
    expect(parseBudgetItems("null").error).toMatch(/itens válidos/);
  });
});
