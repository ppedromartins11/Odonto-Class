import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const mocks = vi.hoisted(() => ({
  requireAdminAal2: vi.fn(),
  rpc: vi.fn(),
  updateUserById: vi.fn(),
  revalidatePath: vi.fn(),
  recordAuditEvent: vi.fn(),
  inviteUserByEmail: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/auth/session", () => ({ requireAdminAal2: mocks.requireAdminAal2 }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(async () => ({ rpc: mocks.rpc })),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: vi.fn(() => ({
    auth: { admin: { updateUserById: mocks.updateUserById, inviteUserByEmail: mocks.inviteUserByEmail } },
  })),
}));
vi.mock("@/lib/audit/server", () => ({ recordAuditEvent: mocks.recordAuditEvent }));
vi.mock("@/lib/config/site", () => ({ getSiteUrl: vi.fn(() => "https://example.test") }));
vi.mock("@/lib/users/profile", () => ({ normalizeUserProfileInput: vi.fn() }));

import { createUsuario, updateUsuarioAccess } from "./actions";

const actorId = "10000000-0000-4000-8000-000000000001";
const targetId = "20000000-0000-4000-8000-000000000002";

describe("convite administrativo com autorizacao SQL", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.requireAdminAal2.mockResolvedValue({ id: actorId, perfil: "administrador" });
  });
  function form() {
    const value = new FormData(); value.set("nome", "QA"); value.set("email", " QA@EXAMPLE.TEST "); value.set("perfil", "dentista"); return value;
  }
  it("autoriza com a sessao e transporta apenas token opaco ao Auth", async () => {
    mocks.rpc.mockResolvedValue({ data: { id: targetId, token: "opaque-fixture" }, error: null });
    mocks.inviteUserByEmail.mockResolvedValue({ data: { user: { id: targetId } }, error: null });
    expect(await createUsuario({ error: null, success: false }, form())).toEqual({ error: null, success: true });
    expect(mocks.rpc).toHaveBeenCalledWith("prepare_user_invitation", { p_email: "qa@example.test", p_nome: "QA", p_perfil: "dentista" });
    expect(mocks.inviteUserByEmail).toHaveBeenCalledWith("qa@example.test", { data: { provisioning_token: "opaque-fixture" }, redirectTo: "https://example.test/auth/confirm" });
  });
  it("negacao SQL impede chamada privilegiada e falha de envio revoga so o convite pendente", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "42501" } });
    expect((await createUsuario({ error: null, success: false }, form())).success).toBe(false);
    expect(mocks.inviteUserByEmail).not.toHaveBeenCalled();
    mocks.rpc.mockResolvedValue({ data: { id: targetId, token: "opaque-fixture" }, error: null });
    mocks.inviteUserByEmail.mockRejectedValue(new Error("transport"));
    expect((await createUsuario({ error: null, success: false }, form())).success).toBe(false);
    expect(mocks.rpc).toHaveBeenLastCalledWith("revoke_user_invitation", { p_convite_id: targetId });
  });

  it("registra etapas e erro sanitizado sem dados de convite", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    mocks.rpc
      .mockResolvedValueOnce({ data: { id: targetId, token: "opaque-fixture" }, error: null })
      .mockResolvedValueOnce({ error: null });
    mocks.inviteUserByEmail.mockResolvedValue({
      data: { user: null },
      error: {
        name: "AuthApiError",
        code: "email_address_invalid",
        status: 422,
        message: "qa@example.test opaque-fixture must not be logged",
      },
    });

    await expect(createUsuario({ error: null, success: false }, form())).resolves.toMatchObject({
      success: false,
    });

    const events = info.mock.calls.map(([, entry]) => entry as Record<string, unknown>);
    expect(events.map((entry) => entry.event)).toEqual([
      "validation",
      "prepare_invitation_start",
      "prepare_invitation_success",
      "invite_auth_start",
      "create_user_failure",
      "cleanup_start",
      "cleanup_success",
    ]);
    expect(events[3]).toMatchObject({ redirectOrigin: "https://example.test" });
    expect(events[4]).toMatchObject({
      stage: "invite_auth_start",
      name: "AuthApiError",
      code: "email_address_invalid",
      status: 422,
    });

    const output = JSON.stringify(info.mock.calls);
    expect(output).not.toContain("qa@example.test");
    expect(output).not.toContain("opaque-fixture");
    expect(output).not.toContain("must not be logged");
    info.mockRestore();
  });

  it("omite códigos de erro externos fora da lista segura", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: {
        name: "refresh_token_opaque_fixture",
        code: "access_token_opaque_fixture",
        status: 400,
        message: "qa@example.test opaque-fixture",
      },
    });

    await expect(createUsuario({ error: null, success: false }, form())).resolves.toMatchObject({
      success: false,
    });

    const failure = info.mock.calls
      .map(([, entry]) => entry as Record<string, unknown>)
      .find((entry) => entry.event === "create_user_failure");
    expect(failure).toMatchObject({ status: 400, stage: "prepare_invitation_start" });
    expect(failure).not.toHaveProperty("name");
    expect(failure).not.toHaveProperty("code");
    expect(JSON.stringify(info.mock.calls)).not.toContain("access_token_opaque_fixture");
    expect(JSON.stringify(info.mock.calls)).not.toContain("refresh_token_opaque_fixture");
    expect(JSON.stringify(info.mock.calls)).not.toContain("qa@example.test");
    expect(JSON.stringify(info.mock.calls)).not.toContain("opaque-fixture");
    info.mockRestore();
  });
});

function accessForm(status: "ativo" | "inativo", usuarioId = targetId) {
  const form = new FormData();
  form.set("usuarioId", usuarioId);
  form.set("status", status);
  return form;
}

describe("updateUsuarioAccess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdminAal2.mockResolvedValue({ id: actorId, perfil: "administrador", status: "ativo" });
    mocks.rpc.mockResolvedValue({ error: null });
    mocks.updateUserById.mockResolvedValue({ error: null });
    mocks.recordAuditEvent.mockResolvedValue(true);
  });

  it("desativa e revalida a lista quando a operacao conclui", async () => {
    await expect(updateUsuarioAccess(accessForm("inativo"))).resolves.toEqual({ error: null, success: true });
    expect(mocks.rpc).toHaveBeenCalledWith("update_user_access", {
      p_usuario_id: targetId,
      p_perfil: null,
      p_status: "inativo",
    });
    expect(mocks.updateUserById).toHaveBeenCalledWith(targetId, { ban_duration: "876000h" });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/usuarios");
  });

  it("converte excecao da RPC em estado amigavel", async () => {
    mocks.rpc.mockRejectedValue(new TypeError("fetch failed"));
    await expect(updateUsuarioAccess(accessForm("inativo"))).resolves.toEqual({
      error: "Não foi possível alterar o acesso agora. Tente novamente.",
      success: false,
    });
  });

  it("preserva o bloqueio de dados quando a suspensao Auth lanca excecao", async () => {
    mocks.updateUserById.mockRejectedValue(new TypeError("fetch failed"));
    await expect(updateUsuarioAccess(accessForm("inativo"))).resolves.toEqual({
      error: "O acesso aos dados foi bloqueado, mas a suspensão da conta precisa ser tentada novamente.",
      success: false,
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/usuarios");
  });

  it("mantem sucesso quando somente a revalidacao lanca excecao", async () => {
    mocks.revalidatePath.mockImplementation(() => {
      throw new Error("revalidate unavailable");
    });
    await expect(updateUsuarioAccess(accessForm("inativo"))).resolves.toEqual({
      error: null,
      success: true,
    });
  });

  it("bloqueia autodesativacao com mensagem explicita antes da RPC", async () => {
    await expect(updateUsuarioAccess(accessForm("inativo", actorId))).resolves.toEqual({
      error: "Sua própria conta administrativa não pode ser desativada ou rebaixada.",
      success: false,
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("nao converte o redirect de AAL1 em erro de dominio", async () => {
    mocks.requireAdminAal2.mockRejectedValue(new Error("NEXT_REDIRECT"));
    await expect(updateUsuarioAccess(accessForm("inativo"))).rejects.toThrow("NEXT_REDIRECT");
  });

  it("mantem a rejeicao de transporte dentro do controle da tela", () => {
    const source = readFileSync("app/(app)/usuarios/UsuarioAccessControls.tsx", "utf8");
    const transition = source.indexOf("startTransition(async () =>");
    const guardedCall = source.indexOf("await updateUsuarioAccess", transition);
    const catchBlock = source.indexOf("} catch {", guardedCall);
    expect(transition).toBeGreaterThan(-1);
    expect(guardedCall).toBeGreaterThan(transition);
    expect(catchBlock).toBeGreaterThan(guardedCall);
  });
});
