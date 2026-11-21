import { afterEach, describe, expect, it, vi } from "vitest";
import { isPaymentReferenceAvailable, loadPaymentReferences } from "./payment-reference-loader";

const patientId = "11111111-1111-4111-8111-111111111111";
const reference = { tipo: "orcamento" as const, id: "22222222-2222-4222-8222-222222222222", descricao: "Orçamento fictício" };
const signal = new AbortController().signal;

afterEach(() => vi.unstubAllGlobals());

describe("carregamento de referências de pagamento", () => {
  it("mantém a seleção válida quando os dados são atualizados", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ references: [reference] }), { status: 200 })));
    const result = await loadPaymentReferences(patientId, signal);
    expect(result).toEqual({ status: "success", references: [reference] });
    expect(isPaymentReferenceAvailable(`orcamento:${reference.id}`, result.references)).toBe(true);
    expect(isPaymentReferenceAvailable("atendimento:33333333-3333-4333-8333-333333333333", result.references)).toBe(false);
  });

  it("distingue lista vazia de falha HTTP e de rede", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ references: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockRejectedValueOnce(new TypeError("offline"));
    vi.stubGlobal("fetch", fetchMock);
    expect((await loadPaymentReferences(patientId, signal)).status).toBe("empty");
    expect((await loadPaymentReferences(patientId, signal)).status).toBe("http");
    expect((await loadPaymentReferences(patientId, signal)).status).toBe("network");
  });

  it("identifica perda de sessão, inclusive redirecionamento do proxy, e resposta inválida", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce({ status: 200, redirected: true })
      .mockResolvedValueOnce(new Response("<html>login</html>", { status: 200 })));
    expect((await loadPaymentReferences(patientId, signal)).status).toBe("session");
    expect((await loadPaymentReferences(patientId, signal)).status).toBe("session");
    expect((await loadPaymentReferences(patientId, signal)).status).toBe("http");
  });
});
