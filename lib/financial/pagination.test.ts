import { describe, expect, it, vi } from "vitest";
import { loadFinancialPage, parseFinancialPage } from "./pagination";

describe("paginação financeira", () => {
  it("recusa índices inválidos sem enviar valor negativo, fracionário ou fora da precisão segura", () => {
    for (const value of [undefined, "", "0", "-1", "1.5", "Infinity", "NaN", "2abc", "9007199254740992"]) {
      expect(parseFinancialPage(value)).toBe(1);
    }
    expect(parseFinancialPage("3")).toBe(3);
  });

  it("consulta apenas as páginas necessárias e limita à última com 55 registros", async () => {
    const records = Array.from({ length: 55 }, (_, i) => i + 1);
    const load = vi.fn(async (page: number) => ({ rows: records.slice((page - 1) * 20, page * 20), total: records.length, pageSize: 20 }));
    const hasRows = (result: { rows: number[] }) => result.rows.length > 0;
    expect((await loadFinancialPage(1, load, hasRows)).result.rows).toHaveLength(20);
    expect((await loadFinancialPage(2, load, hasRows)).result.rows).toEqual(records.slice(20, 40));
    const last = await loadFinancialPage(999999999, load, hasRows);
    expect(last.page).toBe(3);
    expect(last.pages).toBe(3);
    expect(last.result.rows).toEqual(records.slice(40));
    expect(load.mock.calls.map(([page]) => page)).toEqual([1, 1, 2, 1, 3]);
  });

  it("exibe primeira página vazia sem consultar página inexistente", async () => {
    const load = vi.fn(async () => ({ rows: [], total: 0, pageSize: 20 }));
    expect(await loadFinancialPage(5, load, (result) => result.rows.length > 0)).toEqual({ result: { rows: [], total: 0, pageSize: 20 }, page: 1, pages: 1 });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("recalcula a última página quando os registros mudam entre as consultas", async () => {
    const load = vi.fn<(page: number) => Promise<{ rows: number[]; total: number; pageSize: number }>>()
      .mockResolvedValueOnce({ rows: [1], total: 41, pageSize: 20 })
      .mockResolvedValueOnce({ rows: [], total: 0, pageSize: 20 })
      .mockResolvedValueOnce({ rows: [1], total: 39, pageSize: 20 })
      .mockResolvedValueOnce({ rows: [21], total: 39, pageSize: 20 });
    const result = await loadFinancialPage(3, load, (value) => value.rows.length > 0);
    expect(result).toEqual({ result: { rows: [21], total: 39, pageSize: 20 }, page: 2, pages: 2 });
    expect(load.mock.calls.map(([page]) => page)).toEqual([1, 3, 1, 2]);
  });
});
