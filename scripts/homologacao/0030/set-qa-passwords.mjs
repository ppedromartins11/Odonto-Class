import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { createClient } from "@supabase/supabase-js";
import { ROOT, readLinkedProjectRef } from "./config.mjs";
import { projectGuard } from "../lib/safety.mjs";
import { withReadOnlyDatabase } from "./lib/database.mjs";
import { metadataHasElevatedRole } from "./preflight.mjs";
import { pathToFileURL } from "node:url";

const ENV_KEYS = [
  "SUPABASE_TEST_HOMOLOGATION",
  "SUPABASE_TEST_PROJECT_REF",
  "QA_SUPABASE_PROJECT_REF",
  "PRODUCTION_SUPABASE_PROJECT_REF",
  "DR_SUPABASE_PROJECT_REF",
  "SUPABASE_PRODUCTION_PROJECT_REFS",
  "VERCEL_PREVIEW_SUPABASE_PROJECT_REF",
  "VERCEL_PRODUCTION_SUPABASE_PROJECT_REF",
  "SUPABASE_TEST_ENVIRONMENT",
  "SUPABASE_TEST_URL",
  "SUPABASE_TEST_DB_URL",
  "SUPABASE_TEST_ANON_KEY",
  "SUPABASE_TEST_SERVICE_ROLE_KEY",
  "NEXT_PUBLIC_SUPABASE_URL",
  "HOMOLOGATION_ADMIN_EMAIL",
  "HOMOLOGATION_ADMIN_PASSWORD",
  "HOMOLOGATION_DENTIST_A_EMAIL",
  "HOMOLOGATION_DENTIST_A_PASSWORD",
  "HOMOLOGATION_DENTIST_B_EMAIL",
  "HOMOLOGATION_DENTIST_B_PASSWORD",
  "HOMOLOGATION_RECEPTION_EMAIL",
  "HOMOLOGATION_RECEPTION_PASSWORD",
];

const ACTOR_DEFINITIONS = [
  { key: "QA_ADMIN", label: "QA Admin", emailKey: "HOMOLOGATION_ADMIN_EMAIL", passwordKey: "HOMOLOGATION_ADMIN_PASSWORD", profile: "administrador", namePrefix: "QA_" },
  { key: "QA_DENTISTA_A", label: "Dentist A", emailKey: "HOMOLOGATION_DENTIST_A_EMAIL", passwordKey: "HOMOLOGATION_DENTIST_A_PASSWORD", profile: "dentista", namePrefix: "QA_DENTISTA_A" },
  { key: "QA_DENTISTA_B", label: "Dentist B", emailKey: "HOMOLOGATION_DENTIST_B_EMAIL", passwordKey: "HOMOLOGATION_DENTIST_B_PASSWORD", profile: "dentista", namePrefix: "QA_DENTISTA_B" },
  // O enum public.perfil_usuario usa o valor interno `recepcao`.
  { key: "QA_RECEPCAO", label: "Reception", emailKey: "HOMOLOGATION_RECEPTION_EMAIL", passwordKey: "HOMOLOGATION_RECEPTION_PASSWORD", profile: "recepcao", namePrefix: "QA_RECEPCAO" },
];

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class PasswordSetupError extends Error {
  constructor(code, actorKey = null) {
    super(code);
    this.name = "PasswordSetupError";
    this.code = code;
    this.actorKey = actorKey;
  }
}

export function safeFailureMessage(error) {
  if (!(error instanceof PasswordSetupError)) return "falha interna; detalhes ocultos";
  const messages = {
    local_config_unavailable: "arquivo .env.homologacao.local ausente ou inválido",
    required_configuration_missing: "configuração local obrigatória ausente",
    project_guard_failed: "projeto Supabase não corresponde ao projeto QA esperado",
    remote_guard_failed: "guards remotos de migration/identidade não passaram",
    confirmation_required: "confirmação interativa exata não recebida; nenhuma senha alterada",
    password_update_failed: "não foi possível definir a senha QA",
    password_login_failed: "login normal da identidade QA falhou após a definição da senha",
    session_discard_failed: "não foi possível descartar a sessão de teste",
  };
  const baseMessage = messages[error.code] ?? "operação bloqueada; detalhes ocultos";
  if (error.code === "required_configuration_missing" && error.missingKeys?.length) {
    return `${baseMessage}: ${error.missingKeys.join(", ")}`;
  }
  return baseMessage;
}

export async function readHomologationConfig({ root = ROOT, read = readFile } = {}) {
  let source;
  try {
    source = await read(`${root}/.env.homologacao.local`, "utf8");
  } catch {
    throw new PasswordSetupError("local_config_unavailable");
  }
  let parsed;
  try {
    parsed = parseEnv(source);
  } catch {
    throw new PasswordSetupError("local_config_unavailable");
  }
  return Object.fromEntries(ENV_KEYS.filter((key) => Object.hasOwn(parsed, key)).map((key) => [key, parsed[key]]));
}

export function validateLocalConfig(config, linkedRef = readLinkedProjectRef()) {
  const requiredKeys = [
    "SUPABASE_TEST_HOMOLOGATION", "SUPABASE_TEST_PROJECT_REF", "SUPABASE_TEST_URL",
    "SUPABASE_TEST_DB_URL", "SUPABASE_TEST_ANON_KEY", "SUPABASE_TEST_SERVICE_ROLE_KEY",
    ...ACTOR_DEFINITIONS.flatMap(({ emailKey, passwordKey }) => [emailKey, passwordKey]),
  ];
  const missing = requiredKeys.filter((key) => !config[key]?.trim());
  if (missing.length) {
    const error = new PasswordSetupError("required_configuration_missing");
    error.missingKeys = missing;
    throw error;
  }
  if (!projectGuard(config, linkedRef).pass)
    throw new PasswordSetupError("project_guard_failed");
  const expectedRef = config.SUPABASE_TEST_PROJECT_REF.trim();

  const emailOwners = new Set();
  const actors = ACTOR_DEFINITIONS.map((definition) => {
    const email = config[definition.emailKey].trim();
    const password = config[definition.passwordKey];
    if (!EMAIL_PATTERN.test(email) || !password.trim()) {
      const error = new PasswordSetupError("required_configuration_missing");
      error.missingKeys = [!EMAIL_PATTERN.test(email) ? definition.emailKey : definition.passwordKey];
      throw error;
    }
    const normalizedEmail = email.toLowerCase();
    if (emailOwners.has(normalizedEmail)) throw new PasswordSetupError("remote_guard_failed");
    emailOwners.add(normalizedEmail);
    return { ...definition, email: normalizedEmail, password };
  });
  return { ...config, SUPABASE_TEST_URL: config.SUPABASE_TEST_URL.trim(), expectedRef, actors };
}

async function readRemoteState(config, actors) {
  return withReadOnlyDatabase(config.SUPABASE_TEST_DB_URL, async (client) => {
    const migrations = await client.query(
      "select version::text as version from supabase_migrations.schema_migrations where version::text in ('0030', '0031')",
    );
    const actorRows = await client.query(
      `with expected(fixture, email) as (
         select * from unnest($1::text[], $2::text[])
       )
       select expected.fixture, auth_user.id as auth_id, auth_user.email as auth_email,
              auth_user.email_confirmed_at, auth_user.raw_user_meta_data,
              profile.id as profile_id, profile.nome, profile.perfil::text as perfil,
              profile.status::text as status
         from expected
         left join auth.users as auth_user on lower(auth_user.email) = lower(expected.email)
         left join public.usuarios as profile on profile.id = auth_user.id
        order by expected.fixture`,
      [actors.map(({ key }) => key), actors.map(({ email }) => email)],
    );
    return {
      migration0030: migrations.rows.some(({ version }) => version === "0030") ? "APPLIED" : "ABSENT",
      migration0031: migrations.rows.some(({ version }) => version === "0031") ? "APPLIED" : "ABSENT",
      actors: actorRows.rows,
    };
  });
}

export function validateRemoteState(state, actors) {
  if (state?.migration0030 !== "APPLIED" || state?.migration0031 !== "APPLIED" || !Array.isArray(state.actors)) {
    throw new PasswordSetupError("remote_guard_failed");
  }
  const ids = new Set();
  for (const actor of actors) {
    const matches = state.actors.filter((row) => row.fixture === actor.key);
    if (matches.length !== 1) throw new PasswordSetupError("remote_guard_failed", actor.key);
    const row = matches[0];
    if (!row.auth_id || !row.profile_id || row.profile_id !== row.auth_id
      || row.auth_email?.toLowerCase() !== actor.email
      || row.perfil !== actor.profile || row.status !== "ativo"
      || !row.email_confirmed_at || !row.nome?.startsWith(actor.namePrefix)
      || metadataHasElevatedRole(row.raw_user_meta_data) || ids.has(row.auth_id)) {
      throw new PasswordSetupError("remote_guard_failed", actor.key);
    }
    ids.add(row.auth_id);
    actor.userId = row.auth_id;
  }
  return actors;
}

export async function confirmPasswordSetup({ stdin = process.stdin, stdout = process.stdout } = {}) {
  if (!stdin.isTTY || !stdout.isTTY) throw new PasswordSetupError("confirmation_required");
  const { createInterface } = await import("node:readline/promises");
  const terminal = createInterface({ input: stdin, output: stdout });
  try {
    const answer = await terminal.question("Você está prestes a definir senhas somente para fixtures QA existentes. Digite DEFINIR-SENHAS-QA para continuar.\n");
    if (answer !== "DEFINIR-SENHAS-QA") throw new PasswordSetupError("confirmation_required");
    return true;
  } finally {
    terminal.close();
  }
}

function createPasswordAdminClient(config) {
  return createClient(config.SUPABASE_TEST_URL, config.SUPABASE_TEST_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}

function createPasswordAnonClient(config) {
  return createClient(config.SUPABASE_TEST_URL, config.SUPABASE_TEST_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}

async function setAndVerifyPassword(actor, adminClient, config, dependencies) {
  let updateResult;
  try {
    updateResult = await adminClient.auth.admin.updateUserById(actor.userId, { password: actor.password });
  } catch {
    throw new PasswordSetupError("password_update_failed", actor.key);
  }
  if (updateResult?.error || updateResult?.data?.user?.id !== actor.userId) {
    throw new PasswordSetupError("password_update_failed", actor.key);
  }

  const anonClient = dependencies.createAnonClient(config);
  let hasSession = false;
  let loginPassed = false;
  try {
    const result = await anonClient.auth.signInWithPassword({ email: actor.email, password: actor.password });
    hasSession = !!result?.data?.session;
    loginPassed = !result?.error && hasSession && result?.data?.user?.id === actor.userId;
  } catch {
    loginPassed = false;
  } finally {
    if (hasSession) {
      let signOutResult;
      try {
        signOutResult = await anonClient.auth.signOut({ scope: "local" });
      } catch {
        throw new PasswordSetupError("session_discard_failed", actor.key);
      }
      if (signOutResult?.error) throw new PasswordSetupError("session_discard_failed", actor.key);
    }
  }
  if (!loginPassed) throw new PasswordSetupError("password_login_failed", actor.key);
}

export async function runPasswordSetup(config, dependencies = {}) {
  const validatedConfig = validateLocalConfig(config, dependencies.linkedRef ?? readLinkedProjectRef());
  const loadRemoteState = dependencies.readRemoteState ?? readRemoteState;
  const targets = validateRemoteState(await loadRemoteState(validatedConfig, validatedConfig.actors), validatedConfig.actors);
  const confirm = dependencies.confirm ?? (() => confirmPasswordSetup());
  if (await confirm() !== true) throw new PasswordSetupError("confirmation_required");

  const adminClient = (dependencies.createAdminClient ?? createPasswordAdminClient)(validatedConfig);
  for (const [index, actor] of targets.entries()) {
    try {
      await setAndVerifyPassword(actor, adminClient, validatedConfig, {
        createAnonClient: dependencies.createAnonClient ?? createPasswordAnonClient,
      });
    } catch (error) {
      if (error instanceof PasswordSetupError) {
        error.stage = index + 1;
        throw error;
      }
      throw new PasswordSetupError("password_update_failed", actor.key);
    }
    dependencies.onStage?.(index + 1, actor, "PASS");
  }
  return { count: targets.length };
}

function printStage(index, actor, status) {
  const name = actor?.label ?? ACTOR_DEFINITIONS[index - 1]?.label ?? "QA fixture";
  const dots = ".".repeat(Math.max(1, 18 - name.length));
  console.log(`[${index}/4] ${name} ${dots} ${status}`);
}

async function main() {
  const config = await readHomologationConfig();
  try {
    await runPasswordSetup(config, { onStage: printStage });
  } catch (error) {
    if (error instanceof PasswordSetupError && error.stage) printStage(error.stage, ACTOR_DEFINITIONS[error.stage - 1], "FAIL");
    console.error(`BLOCKED: ${safeFailureMessage(error)}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`BLOCKED: ${safeFailureMessage(error)}`);
    process.exitCode = 1;
  });
}
