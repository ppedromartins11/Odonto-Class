import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getCurrentUserState: vi.fn(), listPaymentReferences: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getCurrentUserState: mocks.getCurrentUserState }));
vi.mock("@/lib/financial/queries", () => ({ listPaymentReferences: mocks.listPaymentReferences }));
vi.mock("@/lib/patients/validation", async () => vi.importActual("../../../../lib/patients/validation"));

import { GET } from "./route";

const patientId = "11111111-1111-4111-8111-111111111111";
const request = () => new Request(`https://example.test/api/financeiro/referencias?paciente=${patientId}`);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentUserState.mockResolvedValue({ kind: "authenticated", user: { perfil: "recepcao" } });
  mocks.listPaymentReferences.mockResolvedValue([]);
});

describe("API de referências financeiras", () => {
  it("retorna 401 para sessão perdida sem consultar referências", async () => {
    mocks.getCurrentUserState.mockResolvedValueOnce({ kind: "unauthenticated" });
    const response = await GET(request());
    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(mocks.listPaymentReferences).not.toHaveBeenCalled();
  });

  it("distingue falha da consulta de lista vazia", async () => {
    const empty = await GET(request());
    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual({ references: [] });
    mocks.listPaymentReferences.mockRejectedValueOnce(new Error("unavailable"));
    const failure = await GET(request());
    expect(failure.status).toBe(503);
    expect(await failure.json()).toEqual({ error: "references_unavailable" });
  });

  it("não consulta a RPC para paciente inválido", async () => {
    const response = await GET(new Request("https://example.test/api/financeiro/referencias?paciente=invalid"));
    expect(response.status).toBe(400);
    expect(mocks.listPaymentReferences).not.toHaveBeenCalled();
  });
});
