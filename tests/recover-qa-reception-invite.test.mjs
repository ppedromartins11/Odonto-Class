import { describe, expect, it, vi } from "vitest";
import {
  InviteRecoveryError,
  runInviteRecovery,
  safeErrorMessage,
  validateLocalConfig,
  validateRemoteTarget,
} from "../scripts/homologacao/0030/recover-qa-reception-invite.mjs";

const projectRef = "zxvpyxvhymuibaxgxetf";
const observedProductionRef = "sqouddqzpmkofenyufuj";
const baseConfig = {
  SUPABASE_TEST_HOMOLOGATION: "I_ACKNOWLEDGE_FAKE_DATA_ONLY",
  SUPABASE_TEST_ENVIRONMENT: "homologation",
  SUPABASE_TEST_PROJECT_REF: projectRef,
  QA_SUPABASE_PROJECT_REF: projectRef,
  PRODUCTION_SUPABASE_PROJECT_REF: "sqouddqzpmkofenyufuj",
  DR_SUPABASE_PROJECT_REF: "qprzxkolbbnqfopamfhj",
  VERCEL_PREVIEW_SUPABASE_PROJECT_REF: projectRef,
  VERCEL_PRODUCTION_SUPABASE_PROJECT_REF: "sqouddqzpmkofenyufuj",
  SUPABASE_TEST_URL: `https://${projectRef}.supabase.co`,
  SUPABASE_TEST_DB_URL: `postgresql://postgres.${projectRef}:db-password-test@aws-0-sa-east-1.pooler.supabase.com:6543/postgres`,
  NEXT_PUBLIC_SUPABASE_URL: `https://${projectRef}.supabase.co`,
  SUPABASE_TEST_SERVICE_ROLE_KEY: "service-role-test-secret",
  HOMOLOGATION_RECEPTION_EMAIL: "qa-reception@example.test",
  HOMOLOGATION_BASE_URL: "https://odonto-preview.example.test/",
};

function validRemoteState(overrides = {}) {
  return {
    migration0030: "APPLIED",
    migration0031: "APPLIED",
    targets: [{
      auth_id: "qa-reception-id",
      auth_email: "qa-reception@example.test",
      email_confirmed_at: null,
      invited_at: "2026-10-01T12:00:00.000Z",
      raw_user_meta_data: {},
      profile_id: "qa-reception-id",
      nome: "QA_RECEPCAO",
      perfil: "recepcao",
      status: "ativo",
      ...overrides,
    }],
  };
}

function mockedDependencies({ state = validRemoteState(), generatedLink = `https://${projectRef}.supabase.co/auth/v1/verify?token=test-invite-token&type=invite`, events = [] } = {}) {
  const generateLink = vi.fn(async () => {
    events.push("generateLink");
    return { data: { user: { id: "qa-reception-id", email: "qa-reception@example.test" }, properties: { action_link: generatedLink } }, error: null };
  });
  const getUserById = vi.fn(async () => {
    events.push("getUserById");
    return { data: { user: { id: "qa-reception-id", email: "qa-reception@example.test", email_confirmed_at: null, invited_at: "2026-10-01T12:00:00.000Z", user_metadata: {} } }, error: null };
  });
  const createUser = vi.fn();
  const updateUserById = vi.fn();
  const readRemoteState = vi.fn(async () => {
    events.push("readRemoteState");
    return state;
  });
  const showActionLink = vi.fn(() => events.push("showActionLink"));
  return {
    deps: {
      linkedRef: projectRef,
      confirm: vi.fn(async () => { events.push("confirm"); return true; }),
      readRemoteState,
      createAdminClient: vi.fn(() => ({ auth: { admin: { generateLink, getUserById, createUser, updateUserById } } })),
      showActionLink,
      writeReport: vi.fn(),
      generateLink,
      getUserById,
      createUser,
      updateUserById,
      events,
    },
    generatedLink,
  };
}

describe("recover-qa-reception-invite: guards", () => {
  it("blocks the observed Production project before link generation", async () => {
    const config = { ...baseConfig, SUPABASE_TEST_PROJECT_REF: observedProductionRef,
      QA_SUPABASE_PROJECT_REF: observedProductionRef,
      VERCEL_PREVIEW_SUPABASE_PROJECT_REF: observedProductionRef,
      SUPABASE_TEST_URL: `https://${observedProductionRef}.supabase.co`,
      NEXT_PUBLIC_SUPABASE_URL: `https://${observedProductionRef}.supabase.co`,
      SUPABASE_TEST_DB_URL: `postgresql://postgres.${observedProductionRef}:fictional@aws-0-sa-east-1.pooler.supabase.com:6543/postgres` };
    const { deps } = mockedDependencies();
    deps.linkedRef = observedProductionRef;
    await expect(runInviteRecovery(config, deps)).rejects.toThrowError(InviteRecoveryError);
    expect(deps.generateLink).not.toHaveBeenCalled();
  });
  it("aceita somente o project ref QA esperado e URLs correspondentes", () => {
    expect(validateLocalConfig(baseConfig, projectRef).redirectTo).toBe("https://odonto-preview.example.test/auth/confirm");
    expect(() => validateLocalConfig({ ...baseConfig, SUPABASE_TEST_URL: "https://zyxwvutsrqponmlkjihg.supabase.co" }, projectRef))
      .toThrowError(InviteRecoveryError);
    expect(() => validateLocalConfig({ ...baseConfig, SUPABASE_TEST_DB_URL: "postgresql://postgres.zyxwvutsrqponmlkjihg:pw@aws-0-sa-east-1.pooler.supabase.com:6543/postgres" }, projectRef))
      .toThrowError(InviteRecoveryError);
    expect(() => validateLocalConfig({ ...baseConfig, SUPABASE_TEST_HOMOLOGATION: "true" }, projectRef))
      .toThrowError(InviteRecoveryError);
  });

  it("bloqueia migration 0031 ausente e não chama generateLink", async () => {
    const { deps } = mockedDependencies({ state: { ...validRemoteState(), migration0031: "ABSENT" } });
    await expect(runInviteRecovery(baseConfig, deps)).rejects.toThrowError(InviteRecoveryError);
    expect(deps.generateLink).not.toHaveBeenCalled();
    expect(deps.showActionLink).not.toHaveBeenCalled();
  });

  it("bloqueia migration 0030 ausente", () => {
    expect(() => validateRemoteTarget({ ...validRemoteState(), migration0030: "ABSENT" }, baseConfig.HOMOLOGATION_RECEPTION_EMAIL))
      .toThrowError(InviteRecoveryError);
  });

  it("bloqueia perfil diferente de recepcao", () => {
    expect(() => validateRemoteTarget(validRemoteState({ perfil: "administrador" }), baseConfig.HOMOLOGATION_RECEPTION_EMAIL))
      .toThrowError(InviteRecoveryError);
  });

  it("bloqueia metadata privilegiada", () => {
    expect(() => validateRemoteTarget(validRemoteState({ raw_user_meta_data: { nested: { role: "admin" } } }), baseConfig.HOMOLOGATION_RECEPTION_EMAIL))
      .toThrowError(InviteRecoveryError);
  });

  it("bloqueia usuário já confirmado", () => {
    expect(() => validateRemoteTarget(validRemoteState({ email_confirmed_at: "2026-10-02T00:00:00.000Z" }), baseConfig.HOMOLOGATION_RECEPTION_EMAIL))
      .toThrowError(InviteRecoveryError);
  });

  it("bloqueia usuário sem convite pendente, inativo ou sem perfil correspondente", () => {
    for (const overrides of [
      { invited_at: null },
      { status: "inativo" },
      { profile_id: "different-profile-id" },
      { auth_email: "another-qa@example.test" },
    ]) {
      expect(() => validateRemoteTarget(validRemoteState(overrides), baseConfig.HOMOLOGATION_RECEPTION_EMAIL))
        .toThrowError(InviteRecoveryError);
    }
  });

  it("aceita somente a identidade e perfil do fixture QA_RECEPCAO existente", () => {
    expect(validateRemoteTarget(validRemoteState(), baseConfig.HOMOLOGATION_RECEPTION_EMAIL).id).toBe("qa-reception-id");
    expect(() => validateRemoteTarget(validRemoteState({ nome: "QA_DENTISTA_A" }), baseConfig.HOMOLOGATION_RECEPTION_EMAIL))
      .toThrowError(InviteRecoveryError);
    expect(() => validateRemoteTarget({ ...validRemoteState(), targets: [] }, baseConfig.HOMOLOGATION_RECEPTION_EMAIL))
      .toThrowError(InviteRecoveryError);
    expect(() => validateRemoteTarget({ ...validRemoteState(), targets: [...validRemoteState().targets, ...validRemoteState().targets] }, baseConfig.HOMOLOGATION_RECEPTION_EMAIL))
      .toThrowError(InviteRecoveryError);
  });

  it("não chama generateLink sem confirmação exata", async () => {
    const { deps } = mockedDependencies();
    deps.confirm = vi.fn(async () => false);
    await expect(runInviteRecovery(baseConfig, deps)).rejects.toThrowError(InviteRecoveryError);
    expect(deps.readRemoteState).not.toHaveBeenCalled();
    expect(deps.generateLink).not.toHaveBeenCalled();
  });

  it("revalida a identidade Auth existente imediatamente antes de gerar e aborta se sumiu", async () => {
    const { deps } = mockedDependencies();
    deps.getUserById = vi.fn(async () => ({ data: { user: null }, error: { message: "missing" } }));
    deps.createAdminClient = vi.fn(() => ({ auth: { admin: {
      generateLink: deps.generateLink,
      getUserById: deps.getUserById,
      createUser: deps.createUser,
      updateUserById: deps.updateUserById,
    } } }));
    await expect(runInviteRecovery(baseConfig, deps)).rejects.toThrowError(InviteRecoveryError);
    expect(deps.getUserById).toHaveBeenCalledOnce();
    expect(deps.generateLink).not.toHaveBeenCalled();
    expect(deps.showActionLink).not.toHaveBeenCalled();
  });
});

describe("recover-qa-reception-invite: emissão e sigilo", () => {
  it("gera um único link depois de confirmação e todos os guards", async () => {
    const { deps, generatedLink } = mockedDependencies();
    const result = await runInviteRecovery(baseConfig, deps);
    expect(deps.events).toEqual(["confirm", "readRemoteState", "getUserById", "generateLink", "showActionLink"]);
    expect(deps.generateLink).toHaveBeenCalledOnce();
    expect(deps.getUserById).toHaveBeenCalledExactlyOnceWith("qa-reception-id");
    expect(deps.generateLink).toHaveBeenCalledWith({
      type: "invite",
      email: "qa-reception@example.test",
      options: { redirectTo: "https://odonto-preview.example.test/auth/confirm" },
    });
    expect(deps.showActionLink).toHaveBeenCalledExactlyOnceWith(generatedLink);
    expect(JSON.stringify(result)).not.toContain("test-invite-token");
    expect(deps.writeReport).not.toHaveBeenCalled();
    expect(deps.createUser).not.toHaveBeenCalled();
    expect(deps.updateUserById).not.toHaveBeenCalled();
  });

  it("não imprime segredos nem o link quando generateLink falha", async () => {
    const { deps } = mockedDependencies();
    deps.createAdminClient = vi.fn(() => ({ auth: { admin: {
      generateLink: vi.fn(async () => { throw new Error("service-role-test-secret https://example.test/?token=raw-link-token"); }),
      getUserById: deps.getUserById,
      createUser: deps.createUser,
      updateUserById: deps.updateUserById,
    } } }));
    let failure;
    try { await runInviteRecovery(baseConfig, deps); } catch (error) { failure = error; }
    const safeMessage = safeErrorMessage(failure);
    expect(safeMessage).not.toContain("service-role-test-secret");
    expect(safeMessage).not.toContain("raw-link-token");
    expect(safeMessage).not.toContain("qa-reception@example.test");
    expect(deps.showActionLink).not.toHaveBeenCalled();
    expect(deps.writeReport).not.toHaveBeenCalled();
  });
});
