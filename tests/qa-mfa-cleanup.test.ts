import { afterEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { elevateQaAdminToAal2 } from "./integration/helpers";

function fixture() {
  const factors = new Set(["preexisting", "owned"]);
  const mfa = {
    enroll: vi.fn().mockResolvedValue({ data: { id: "owned", totp: { secret: Array.from(randomBytes(32), byte => "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"[byte % 32]).join("") } }, error: null }),
    challenge: vi.fn().mockResolvedValue({ data: { id: "challenge" }, error: null }),
    verify: vi.fn().mockResolvedValue({ error: null }),
    getAuthenticatorAssuranceLevel: vi.fn().mockResolvedValue({ data: { currentLevel: "aal2" }, error: null }),
    unenroll: vi.fn().mockImplementation(async ({ factorId }: { factorId: string }) => {
      factors.delete(factorId); return { error: null };
    }),
  };
  return { mfa, factors, session: { auth: { mfa } } as unknown as SupabaseClient };
}

afterEach(() => vi.restoreAllMocks());
describe("R02: ownership do fator MFA QA", () => {
  it.each(["challenge", "verify", "getAuthenticatorAssuranceLevel"] as const)("remove somente fator novo quando %s retorna erro", async stage => {
    const f = fixture(), original = new Error("original");
    f.mfa[stage].mockResolvedValue({ data: null, error: original });
    await expect(elevateQaAdminToAal2(f.session)).rejects.toMatchObject({ cause: original });
    expect(f.mfa.unenroll).toHaveBeenCalledExactlyOnceWith({ factorId: "owned" });
    expect([...f.factors]).toEqual(["preexisting"]);
  });
  it.each(["challenge", "verify", "getAuthenticatorAssuranceLevel"] as const)("preserva erro de rede em %s e remove fator", async stage => {
    const f = fixture(), original = new Error("network");
    f.mfa[stage].mockRejectedValue(original);
    await expect(elevateQaAdminToAal2(f.session)).rejects.toBe(original);
    expect([...f.factors]).toEqual(["preexisting"]);
  });
  it("sucesso transfere ownership ao cleanup normal do chamador", async () => {
    const f = fixture();
    const factorId = await elevateQaAdminToAal2(f.session);
    expect(f.mfa.unenroll).not.toHaveBeenCalled();
    await f.session.auth.mfa.unenroll({ factorId });
    expect([...f.factors]).toEqual(["preexisting"]);
  });
  it.each([false, true])("cleanup falha (throw=%s): preserva causa e sanitiza registro", async throws => {
    const f = fixture(), original = new Error("original"), sensitive = new Error("sensitive Auth response");
    f.mfa.verify.mockResolvedValue({ error: original });
    if (throws) f.mfa.unenroll.mockRejectedValue(sensitive);
    else f.mfa.unenroll.mockResolvedValue({ error: sensitive });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(elevateQaAdminToAal2(f.session)).rejects.toMatchObject({ cause: original });
    expect(log).toHaveBeenCalledExactlyOnceWith("QA_MFA_CLEANUP_FAILED: falha ao remover fator desta execucao.");
    expect(f.mfa.unenroll).toHaveBeenCalledExactlyOnceWith({ factorId: "owned" });
  });
  it("enroll com ID mas sem secret ainda pertence ao cleanup", async () => {
    const f = fixture(); f.mfa.enroll.mockResolvedValue({ data: { id: "owned" }, error: null });
    await expect(elevateQaAdminToAal2(f.session)).rejects.toThrow("preparar MFA");
    expect([...f.factors]).toEqual(["preexisting"]);
  });
  it("AAL1 apos verify tambem remove fator", async () => {
    const f = fixture(); f.mfa.getAuthenticatorAssuranceLevel.mockResolvedValue({ data: { currentLevel: "aal1" }, error: null });
    await expect(elevateQaAdminToAal2(f.session)).rejects.toThrow("nao atingiu AAL2");
    expect([...f.factors]).toEqual(["preexisting"]);
  });
  it("enroll sem ID nao remove qualquer fator", async () => {
    const f = fixture(); f.mfa.enroll.mockResolvedValue({ data: null, error: new Error("enroll") });
    await expect(elevateQaAdminToAal2(f.session)).rejects.toThrow("preparar MFA");
    expect(f.mfa.unenroll).not.toHaveBeenCalled();
  });
});
