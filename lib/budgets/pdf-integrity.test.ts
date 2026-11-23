import { describe, expect, it, vi } from "vitest";
import { reconcileFailedBudgetPdfRegistration, verifyBudgetPdfObject } from "./pdf-integrity";

const budgetId = "11111111-1111-4111-8111-111111111111";
const path = `${budgetId}/orcamentos/22222222-2222-4222-8222-222222222222.pdf`;
const bytes = new TextEncoder().encode("%PDF-1.7\\nconteudo ficticio");
const info = () => ({
  id: "object-id", version: "object-version", bucketId: "arquivos-paciente",
  name: path, size: bytes.length, contentType: "application/pdf",
  metadata: { size: bytes.length, mimetype: "application/pdf" },
});
const data = (binary = bytes) => new Blob([new Uint8Array(binary)], { type: "application/pdf" });
const reads = () => ({
  readInfo: async () => ({ data: info(), error: null }),
  readBytes: async () => ({ data: data(), error: null }),
});

describe("integridade das versoes PDF de orcamento", () => {
  it("confirma caminho, metadata, bytes e versao estavel", async () => {
    expect(await verifyBudgetPdfObject({ budgetId, path, expectedBytes: bytes, ...reads() })).toBe(true);
  });

  it("nega objeto pertencente a outro orcamento", async () => {
    expect(await verifyBudgetPdfObject({
      budgetId: "33333333-3333-4333-8333-333333333333", path, expectedBytes: bytes, ...reads(),
    })).toBe(false);
  });

  it("nega bytes trocados mesmo quando tamanho e MIME sao iguais", async () => {
    const invalid = new Uint8Array(bytes);
    invalid[invalid.length - 1] ^= 1;
    expect(await verifyBudgetPdfObject({
      budgetId, path, expectedBytes: bytes,
      ...reads(), readBytes: async () => ({ data: data(invalid), error: null }),
    })).toBe(false);
  });

  it("nega versao alterada entre verificacoes", async () => {
    let calls = 0;
    expect(await verifyBudgetPdfObject({
      budgetId, path, expectedBytes: bytes,
      ...reads(),
      readInfo: async () => ({ data: { ...info(), version: String(++calls) }, error: null }),
    })).toBe(false);
  });

  it("preserva PDF quando resultado SQL e inconclusivo ou metadata existe", async () => {
    const removeObject = vi.fn(async () => ({ error: null }));
    const metadataForPath = vi.fn(async () => ({ data: { id: "saved" }, error: null }));
    expect(await reconcileFailedBudgetPdfRegistration({
      rpcError: new Error("network"), metadataForPath, removeObject,
    })).toBe("preserved");
    expect(metadataForPath).not.toHaveBeenCalled();
    expect(await reconcileFailedBudgetPdfRegistration({
      rpcError: { code: "23514" }, metadataForPath, removeObject,
    })).toBe("preserved");
    expect(removeObject).not.toHaveBeenCalled();
  });

  it("so remove objeto apos falha SQL definitiva e ausencia de registro", async () => {
    const removeObject = vi.fn(async () => ({ error: null }));
    const metadataForPath = vi.fn(async () => ({ data: null, error: null }));
    expect(await reconcileFailedBudgetPdfRegistration({
      rpcError: { code: "23514" }, metadataForPath, removeObject,
    })).toBe("removed");
    expect(removeObject).toHaveBeenCalledTimes(1);
  });
});
