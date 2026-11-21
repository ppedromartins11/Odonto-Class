import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createQaAdmin } from "./integration/helpers";

const { client } = vi.hoisted(() => ({ client: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: client }));

function fixture() {
  vi.stubEnv("SUPABASE_TEST_HOMOLOGATION", "I_ACKNOWLEDGE_FAKE_DATA_ONLY");
  const factors = new Set(["preexisting", "owned"]);
  const mfa = {
    enroll: vi.fn().mockResolvedValue({ data: { id: "owned", totp: { secret: Array.from(randomBytes(32), b => "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"[b % 32]).join("") } }, error: null }),
    challenge: vi.fn().mockResolvedValue({ data: { id: "challenge" }, error: null }),
    verify: vi.fn().mockResolvedValue({ error: null }),
    getAuthenticatorAssuranceLevel: vi.fn().mockResolvedValue({ data: { currentLevel: "aal2" }, error: null }),
    unenroll: vi.fn().mockImplementation(async ({ factorId }: { factorId: string }) => { factors.delete(factorId); return { error: null }; }),
  };
  const profile = vi.fn().mockResolvedValue({ data: { nome: "QA_BOOTSTRAP", perfil: "administrador", status: "ativo" }, error: null });
  const prepare = vi.fn().mockResolvedValue({ data: { id: "invitation", token: "synthetic" }, error: null });
  const bootstrap = {
    auth: { mfa, signInWithPassword: vi.fn().mockResolvedValue({ data: { user: { id: "bootstrap" } }, error: null }) },
    from: () => ({ select: () => ({ eq: () => ({ single: profile }) }) }), rpc: prepare,
  };
  const update = vi.fn().mockResolvedValue({ data: { user: { id: "created" } }, error: null });
  const remove = vi.fn().mockResolvedValue({ error: null });
  const deleteUser = vi.fn().mockResolvedValue({ error: null });
  const service = {
    auth: { admin: { generateLink: vi.fn().mockResolvedValue({ data: { user: { id: "created" } }, error: null }), updateUserById: update, deleteUser } },
    from: () => ({ delete: () => ({ eq: remove }) }),
  } as unknown as SupabaseClient;
  const login = vi.fn().mockResolvedValue({ error: null });
  const session = { auth: { signInWithPassword: login, mfa: { ...mfa, enroll: vi.fn().mockResolvedValue({ data: { id: "new-admin-owned", totp: { secret: "A".repeat(32) } }, error: null }) } } };
  client.mockReturnValueOnce(bootstrap).mockReturnValueOnce(session);
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  return { service, factors, mfa, prepare, update, profile, remove, deleteUser, login, log };
}
const run = (f: ReturnType<typeof fixture>) => createQaAdmin(f.service, "http://localhost", "synthetic");
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); client.mockReset(); });

describe("F02: cleanup externo de createQaAdmin", () => {
  it.each(["success", "returned", "transport"])("erro principal preservado com cleanup %s", async cleanup => {
    const f = fixture(), root = new Error("root"), primary = new Error("primary", { cause: root });
    f.prepare.mockRejectedValue(primary);
    if (cleanup === "returned") f.mfa.unenroll.mockResolvedValue({ error: new Error("sensitive") });
    if (cleanup === "transport") f.mfa.unenroll.mockRejectedValue(new Error("sensitive"));
    const error = await run(f).catch(error => error);
    expect(error).toBe(primary); expect(error.cause).toBe(root);
    expect(f.mfa.unenroll).toHaveBeenCalledExactlyOnceWith({ factorId: "owned" });
    expect(f.factors.has("preexisting")).toBe(true);
    if (cleanup === "success") expect(f.log).not.toHaveBeenCalled();
    else expect(f.log).toHaveBeenCalledExactlyOnceWith("QA_MFA_CLEANUP_FAILED: falha ao remover fator desta execucao.");
  });
  it.each([false, true])("sucesso principal reporta cleanup como unico erro (throw=%s)", async throws => {
    const f = fixture();
    if (throws) f.mfa.unenroll.mockRejectedValue(new Error("sensitive"));
    else f.mfa.unenroll.mockResolvedValue({ error: new Error("sensitive") });
    const error = await run(f).catch(error => error);
    expect(error.message).toBe("Falha ao remover fator temporario do bootstrap QA.");
    expect(error.cause).toBeUndefined();
    expect(f.mfa.unenroll).toHaveBeenCalledExactlyOnceWith({ factorId: "owned" });
  });
  it("erro retornado da operacao principal preserva cause mesmo se cleanup falhar", async () => {
    const f = fixture(), primary = new Error("update failed");
    f.update.mockResolvedValue({ data: { user: null }, error: primary });
    f.mfa.unenroll.mockRejectedValue(new Error("sensitive"));
    await expect(run(f)).rejects.toMatchObject({ message: "Falha ao criar administrador QA.", cause: primary });
  });
  it("sucesso remove apenas fator proprio e preserva preexistente", async () => {
    const f = fixture(); await expect(run(f)).resolves.toMatchObject({ identity: { id: "created" } });
    expect(f.mfa.unenroll).toHaveBeenCalledExactlyOnceWith({ factorId: "owned" });
    expect([...f.factors]).toEqual(["preexisting"]);
  });
  it("nao enroll/unenroll em usuario sem marcador QA", async () => {
    const f = fixture(); f.profile.mockResolvedValue({ data: { nome: "Real", perfil: "administrador", status: "ativo" }, error: null });
    await expect(run(f)).rejects.toThrow("explicitamente reservado a QA");
    expect(f.mfa.enroll).not.toHaveBeenCalled(); expect(f.mfa.unenroll).not.toHaveBeenCalled();
  });
  it.each([false, true])("cleanup da identidade tambem preserva erro de transporte principal (throw=%s)", async throws => {
    const f = fixture(), primary = new Error("login transport");
    f.login.mockRejectedValue(primary);
    // Primeira chamada limpa convite; as seguintes limpam somente a identidade propria.
    f.remove.mockResolvedValueOnce({ error: null });
    if (throws) { f.remove.mockRejectedValue(new Error("sensitive")); f.deleteUser.mockRejectedValue(new Error("sensitive")); }
    else { f.remove.mockResolvedValue({ error: new Error("sensitive") }); f.deleteUser.mockResolvedValue({ error: new Error("sensitive") }); }
    await expect(run(f)).rejects.toBe(primary);
    expect(f.deleteUser).toHaveBeenCalledExactlyOnceWith("created");
    expect(f.log.mock.calls).toEqual(Array(3).fill(["QA_USER_CLEANUP_FAILED: falha ao remover identidade desta execucao."]));
  });
});
