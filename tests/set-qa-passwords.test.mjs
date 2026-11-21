import { describe, expect, it, vi } from "vitest";
import {
  PasswordSetupError,
  readHomologationConfig,
  runPasswordSetup,
  safeFailureMessage,
  validateLocalConfig,
  validateRemoteState,
} from "../scripts/homologacao/0030/set-qa-passwords.mjs";

const projectRef = "zxvpyxvhymuibaxgxetf";
const observedProductionRef = "sqouddqzpmkofenyufuj";
const baseConfig = {
  SUPABASE_TEST_HOMOLOGATION: "I_ACKNOWLEDGE_FAKE_DATA_ONLY",
  SUPABASE_TEST_PROJECT_REF: projectRef,
  QA_SUPABASE_PROJECT_REF: projectRef,
  PRODUCTION_SUPABASE_PROJECT_REF: "sqouddqzpmkofenyufuj",
  DR_SUPABASE_PROJECT_REF: "qprzxkolbbnqfopamfhj",
  VERCEL_PREVIEW_SUPABASE_PROJECT_REF: projectRef,
  VERCEL_PRODUCTION_SUPABASE_PROJECT_REF: "sqouddqzpmkofenyufuj",
  SUPABASE_TEST_ENVIRONMENT: "homologation",
  SUPABASE_TEST_URL: `https://${projectRef}.supabase.co`,
  SUPABASE_TEST_DB_URL: `postgresql://postgres:fictional@db.${projectRef}.supabase.co:5432/postgres`,
  NEXT_PUBLIC_SUPABASE_URL: `https://${projectRef}.supabase.co`,
  SUPABASE_TEST_ANON_KEY: "anon-test-key",
  SUPABASE_TEST_SERVICE_ROLE_KEY: "service-role-test-key",
  HOMOLOGATION_ADMIN_EMAIL: "admin@qa.example.test",
  HOMOLOGATION_ADMIN_PASSWORD: "admin-password-test",
  HOMOLOGATION_DENTIST_A_EMAIL: "dentist-a@qa.example.test",
  HOMOLOGATION_DENTIST_A_PASSWORD: "dentist-a-password-test",
  HOMOLOGATION_DENTIST_B_EMAIL: "dentist-b@qa.example.test",
  HOMOLOGATION_DENTIST_B_PASSWORD: "dentist-b-password-test",
  HOMOLOGATION_RECEPTION_EMAIL: "reception@qa.example.test",
  HOMOLOGATION_RECEPTION_PASSWORD: "reception-password-test",
};

function remoteState(overrides = {}) {
  const actors = [
    { fixture: "QA_ADMIN", auth_id: "id-admin", auth_email: "admin@qa.example.test", email_confirmed_at: "2026-01-01", raw_user_meta_data: {}, profile_id: "id-admin", nome: "QA_Admin_Harness", perfil: "administrador", status: "ativo" },
    { fixture: "QA_DENTISTA_A", auth_id: "id-dentist-a", auth_email: "dentist-a@qa.example.test", email_confirmed_at: "2026-01-01", raw_user_meta_data: {}, profile_id: "id-dentist-a", nome: "QA_DENTISTA_A_Harness", perfil: "dentista", status: "ativo" },
    { fixture: "QA_DENTISTA_B", auth_id: "id-dentist-b", auth_email: "dentist-b@qa.example.test", email_confirmed_at: "2026-01-01", raw_user_meta_data: {}, profile_id: "id-dentist-b", nome: "QA_DENTISTA_B_Harness", perfil: "dentista", status: "ativo" },
    { fixture: "QA_RECEPCAO", auth_id: "id-reception", auth_email: "reception@qa.example.test", email_confirmed_at: "2026-01-01", raw_user_meta_data: {}, profile_id: "id-reception", nome: "QA_RECEPCAO_Harness", perfil: "recepcao", status: "ativo" },
  ];
  return { migration0030: "APPLIED", migration0031: "APPLIED", actors: actors.map((row) => ({ ...row, ...(overrides[row.fixture] ?? {}) })) };
}

function successfulDependencies(overrides = {}) {
  const updateUserById = vi.fn(async (id) => ({ data: { user: { id } }, error: null }));
  const createUser = vi.fn();
  const signOut = vi.fn(async () => ({ error: null }));
  const deps = {
    linkedRef: projectRef,
    readRemoteState: vi.fn(async () => remoteState()),
    confirm: vi.fn(async () => true),
    createAdminClient: vi.fn(() => ({ auth: { admin: { updateUserById, createUser } } })),
    createAnonClient: vi.fn(() => ({ auth: {
      signInWithPassword: vi.fn(async ({ email }) => ({ data: { user: { id: ({ "admin@qa.example.test": "id-admin", "dentist-a@qa.example.test": "id-dentist-a", "dentist-b@qa.example.test": "id-dentist-b", "reception@qa.example.test": "id-reception" })[email] }, session: { access_token: "session-token-test", refresh_token: "refresh-token-test" } }, error: null })),
      signOut,
    } })),
    updateUserById,
    createUser,
    signOut,
    ...overrides,
  };
  return deps;
}

describe("set-qa-passwords: configuração e guards", () => {
  it("blocks the observed Production project before any Auth mutation", async () => {
    const config = { ...baseConfig, SUPABASE_TEST_PROJECT_REF: observedProductionRef,
      QA_SUPABASE_PROJECT_REF: observedProductionRef,
      VERCEL_PREVIEW_SUPABASE_PROJECT_REF: observedProductionRef,
      SUPABASE_TEST_URL: `https://${observedProductionRef}.supabase.co`,
      NEXT_PUBLIC_SUPABASE_URL: `https://${observedProductionRef}.supabase.co`,
      SUPABASE_TEST_DB_URL: `postgresql://postgres:fictional@db.${observedProductionRef}.supabase.co:5432/postgres` };
    const deps = successfulDependencies({ linkedRef: observedProductionRef });
    await expect(runPasswordSetup(config, deps)).rejects.toThrowError(PasswordSetupError);
    expect(deps.updateUserById).not.toHaveBeenCalled();
  });
  it("lê apenas as chaves permitidas do arquivo homologação local", async () => {
    const read = vi.fn(async () => "HOMOLOGATION_ADMIN_EMAIL=qa@example.test\nUNRELATED_SECRET=must-not-escape\nHOMOLOGATION_ADMIN_PASSWORD=local-test-password\n");
    const config = await readHomologationConfig({ root: "C:/repo", read });
    expect(read).toHaveBeenCalledWith("C:/repo/.env.homologacao.local", "utf8");
    expect(config).toEqual({ HOMOLOGATION_ADMIN_EMAIL: "qa@example.test", HOMOLOGATION_ADMIN_PASSWORD: "local-test-password" });
    expect(config).not.toHaveProperty("UNRELATED_SECRET");
  });

  it("bloqueia divergência do projeto QA esperado", () => {
    expect(() => validateLocalConfig({ ...baseConfig, SUPABASE_TEST_URL: "https://zyxwvutsrqponmlkjihg.supabase.co" }, projectRef))
      .toThrowError(PasswordSetupError);
  });

  it("rejeita `true` como substituto do acknowledgement do harness", () => {
    expect(() => validateLocalConfig({ ...baseConfig, SUPABASE_TEST_HOMOLOGATION: "true" }, projectRef))
      .toThrowError(PasswordSetupError);
  });

  it("aceita somente o acknowledgement padronizado do harness", () => {
    expect(validateLocalConfig(baseConfig, projectRef).expectedRef).toBe(projectRef);
  });

  it("bloqueia senha ausente antes de consultar ou alterar qualquer usuário", async () => {
    const deps = successfulDependencies();
    await expect(runPasswordSetup({ ...baseConfig, HOMOLOGATION_DENTIST_A_PASSWORD: "" }, deps)).rejects.toThrowError(PasswordSetupError);
    expect(deps.readRemoteState).not.toHaveBeenCalled();
    expect(deps.updateUserById).not.toHaveBeenCalled();
  });

  it("bloqueia migration 0031 ausente antes da primeira alteração", async () => {
    const deps = successfulDependencies({ readRemoteState: vi.fn(async () => ({ ...remoteState(), migration0031: "ABSENT" })) });
    await expect(runPasswordSetup(baseConfig, deps)).rejects.toThrowError(PasswordSetupError);
    expect(deps.confirm).not.toHaveBeenCalled();
    expect(deps.updateUserById).not.toHaveBeenCalled();
  });

  it("bloqueia conta QA inexistente antes da primeira alteração", async () => {
    const state = remoteState({ QA_DENTISTA_A: { auth_id: null, auth_email: null, email_confirmed_at: null, profile_id: null, nome: null, perfil: null, status: null } });
    const deps = successfulDependencies({ readRemoteState: vi.fn(async () => state) });
    await expect(runPasswordSetup(baseConfig, deps)).rejects.toThrowError(PasswordSetupError);
    expect(deps.confirm).not.toHaveBeenCalled();
    expect(deps.updateUserById).not.toHaveBeenCalled();
  });

  it("bloqueia perfil incompatível antes da primeira alteração", async () => {
    const deps = successfulDependencies({ readRemoteState: vi.fn(async () => remoteState({ QA_DENTISTA_B: { perfil: "administrador" } })) });
    await expect(runPasswordSetup(baseConfig, deps)).rejects.toThrowError(PasswordSetupError);
    expect(deps.updateUserById).not.toHaveBeenCalled();
  });

  it("bloqueia user_metadata com papel privilegiado", async () => {
    const state = remoteState({ QA_DENTISTA_A: { raw_user_meta_data: { nested: { role: "admin" } } } });
    expect(() => validateRemoteState(state, validateLocalConfig(baseConfig, projectRef).actors)).toThrowError(PasswordSetupError);
  });

  it("bloqueia usuários que não correspondem aos nomes QA esperados", async () => {
    const state = remoteState({ QA_RECEPCAO: { nome: "Recepcionista Clínica" } });
    expect(() => validateRemoteState(state, validateLocalConfig(baseConfig, projectRef).actors)).toThrowError(PasswordSetupError);
  });

  it("redige detalhes de erros que poderiam conter credenciais", () => {
    const error = new PasswordSetupError("password_login_failed");
    error.message += " admin-password-test eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature0123456789";
    const output = safeFailureMessage(error);
    expect(output).not.toContain("admin-password-test");
    expect(output).not.toContain("eyJ");
    expect(output).not.toContain("signature0123456789");
  });
});

describe("set-qa-passwords: execução confirmada", () => {
  it("somente chama updateUserById com { password }, verifica login anon e descarta sessões", async () => {
    const deps = successfulDependencies();
    const stages = [];
    await expect(runPasswordSetup(baseConfig, { ...deps, onStage: (...args) => stages.push(args) })).resolves.toEqual({ count: 4 });
    expect(deps.confirm).toHaveBeenCalledOnce();
    expect(deps.createUser).not.toHaveBeenCalled();
    expect(deps.updateUserById).toHaveBeenCalledTimes(4);
    expect(deps.updateUserById.mock.calls.map(([, payload]) => Object.keys(payload))).toEqual([ ["password"], ["password"], ["password"], ["password"] ]);
    expect(deps.updateUserById.mock.calls.map(([, payload]) => payload.password)).toEqual([
      baseConfig.HOMOLOGATION_ADMIN_PASSWORD,
      baseConfig.HOMOLOGATION_DENTIST_A_PASSWORD,
      baseConfig.HOMOLOGATION_DENTIST_B_PASSWORD,
      baseConfig.HOMOLOGATION_RECEPTION_PASSWORD,
    ]);
    expect(deps.createAnonClient).toHaveBeenCalledTimes(4);
    expect(deps.signOut).toHaveBeenCalledTimes(4);
    expect(stages.map(([, actor, status]) => [actor.label, status])).toEqual([
      ["QA Admin", "PASS"], ["Dentist A", "PASS"], ["Dentist B", "PASS"], ["Reception", "PASS"],
    ]);
  });

  it("aborta sem alterações se a confirmação não for concedida", async () => {
    const deps = successfulDependencies({ confirm: vi.fn(async () => { throw new PasswordSetupError("confirmation_required"); }) });
    await expect(runPasswordSetup(baseConfig, deps)).rejects.toThrowError(PasswordSetupError);
    expect(deps.createAdminClient).not.toHaveBeenCalled();
    expect(deps.updateUserById).not.toHaveBeenCalled();
  });

  it("encerra com falha sanitizada se login normal falhar", async () => {
    const deps = successfulDependencies({
      createAnonClient: vi.fn(() => ({ auth: {
        signInWithPassword: vi.fn(async () => ({ data: { session: null, user: null }, error: { message: "raw error with dentist-a-password-test" } })),
        signOut: vi.fn(async () => ({ error: null })),
      } })),
    });
    let failure;
    try { await runPasswordSetup(baseConfig, deps); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(PasswordSetupError);
    expect(failure.actorKey).toBe("QA_ADMIN");
    expect(safeFailureMessage(failure)).not.toContain("dentist-a-password-test");
    expect(deps.updateUserById).toHaveBeenCalledTimes(1);
  });
});
