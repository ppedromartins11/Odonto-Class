import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const mocks = vi.hoisted(() => ({
  requireAdminAal2: vi.fn(),
  rpc: vi.fn(),
  updateUserById: vi.fn(),
  revalidatePath: vi.fn(),
  recordAuditEvent: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/auth/session", () => ({ requireAdminAal2: mocks.requireAdminAal2 }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(async () => ({ rpc: mocks.rpc })),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: vi.fn(() => ({
    auth: { admin: { updateUserById: mocks.updateUserById, inviteUserByEmail: vi.fn() } },
  })),
}));
vi.mock("@/lib/audit/server", () => ({ recordAuditEvent: mocks.recordAuditEvent }));
vi.mock("@/lib/config/site", () => ({ getSiteUrl: vi.fn(() => "https://example.test") }));
vi.mock("@/lib/users/profile", () => ({ normalizeUserProfileInput: vi.fn() }));

import { updateUsuarioAccess } from "./actions";

const actorId = "10000000-0000-4000-8000-000000000001";
const targetId = "20000000-0000-4000-8000-000000000002";

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
