import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { createClient } from "@supabase/supabase-js";
import { ROOT, readLinkedProjectRef } from "./config.mjs";
import { projectGuard } from "../lib/safety.mjs";
import { withReadOnlyDatabase } from "./lib/database.mjs";
import { metadataHasElevatedRole } from "./preflight.mjs";
import { pathToFileURL } from "node:url";

export const INVITE_CONFIRMATION = "GERAR-NOVO-LINK-QA-RECEPCAO";
const FIXTURE_NAME = "QA_RECEPCAO";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LOCAL_ENV_KEYS = [
  "SUPABASE_TEST_HOMOLOGATION",
  "SUPABASE_TEST_ENVIRONMENT",
  "SUPABASE_TEST_PROJECT_REF",
  "QA_SUPABASE_PROJECT_REF",
  "PRODUCTION_SUPABASE_PROJECT_REF",
  "DR_SUPABASE_PROJECT_REF",
  "SUPABASE_PRODUCTION_PROJECT_REFS",
  "VERCEL_PREVIEW_SUPABASE_PROJECT_REF",
  "VERCEL_PRODUCTION_SUPABASE_PROJECT_REF",
  "SUPABASE_TEST_URL",
  "SUPABASE_TEST_DB_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_TEST_SERVICE_ROLE_KEY",
  "HOMOLOGATION_RECEPTION_EMAIL",
  "HOMOLOGATION_BASE_URL",
];

export class InviteRecoveryError extends Error {
  constructor(code) {
    super(code);
    this.name = "InviteRecoveryError";
    this.code = code;
  }
}

export function safeErrorMessage(error) {
  if (!(error instanceof InviteRecoveryError)) return "falha interna; detalhes ocultos";
  const messages = {
    local_config_unavailable: "arquivo .env.homologacao.local ausente ou inválido",
    required_configuration_missing: "configuração local obrigatória ausente",
    project_guard_failed: "project ref não corresponde ao projeto QA esperado",
    confirmation_required: "confirmação interativa exata não recebida; nenhum link gerado",
    remote_guard_failed: "guards remotos de migration/identidade não passaram",
    link_generation_failed: "não foi possível gerar o link temporário",
    link_target_mismatch: "a resposta do Auth não corresponde ao fixture QA esperado",
  };
  return messages[error.code] ?? "operação bloqueada; detalhes ocultos";
}

export async function readLocalConfig({ root = ROOT, read = readFile } = {}) {
  let text;
  try {
    text = await read(`${root}/.env.homologacao.local`, "utf8");
  } catch {
    throw new InviteRecoveryError("local_config_unavailable");
  }
  let parsed;
  try {
    parsed = parseEnv(text);
  } catch {
    throw new InviteRecoveryError("local_config_unavailable");
  }
  return Object.fromEntries(LOCAL_ENV_KEYS.filter((key) => Object.hasOwn(parsed, key)).map((key) => [key, parsed[key]]));
}

export function projectRefFromDatabaseUrl(value) {
  try {
    const url = new URL(value);
    if (!["postgres:", "postgresql:"].includes(url.protocol)) return null;
    const references = [];
    const directHost = url.hostname.toLowerCase().match(/^db\.([a-z0-9]{20})\.supabase\.co$/);
    if (directHost) references.push(directHost[1]);
    let username;
    try { username = decodeURIComponent(url.username); } catch { return null; }
    const poolerUser = username.match(/^postgres\.([a-z0-9]{20})$/i);
    if (poolerUser) references.push(poolerUser[1].toLowerCase());
    if (!references.length || new Set(references).size !== 1) return null;
    return references[0];
  } catch {
    return null;
  }
}

function redirectTargetFromBaseUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || !["", "/"].includes(url.pathname)) return null;
    return `${url.origin}/auth/confirm`;
  } catch {
    return null;
  }
}

export function validateLocalConfig(config, linkedRef = readLinkedProjectRef()) {
  const missing = LOCAL_ENV_KEYS.filter((key) => key !== "SUPABASE_PRODUCTION_PROJECT_REFS" && !config[key]?.trim());
  if (missing.length) throw new InviteRecoveryError("required_configuration_missing");
  if (!projectGuard(config, linkedRef).pass) {
    throw new InviteRecoveryError("project_guard_failed");
  }

  const email = config.HOMOLOGATION_RECEPTION_EMAIL.trim().toLowerCase();
  const redirectTo = redirectTargetFromBaseUrl(config.HOMOLOGATION_BASE_URL.trim());
  if (!EMAIL_PATTERN.test(email) || !redirectTo) throw new InviteRecoveryError("required_configuration_missing");
  return {
    SUPABASE_TEST_URL: config.SUPABASE_TEST_URL.trim(),
    SUPABASE_TEST_DB_URL: config.SUPABASE_TEST_DB_URL.trim(),
    SUPABASE_TEST_SERVICE_ROLE_KEY: config.SUPABASE_TEST_SERVICE_ROLE_KEY,
    email,
    redirectTo,
  };
}

async function readRemoteState(config) {
  return withReadOnlyDatabase(config.SUPABASE_TEST_DB_URL, async (client) => {
    const migrations = await client.query(
      "select version::text as version from supabase_migrations.schema_migrations where version::text in ('0030', '0031')",
    );
    const target = await client.query(
      `select auth_user.id as auth_id, auth_user.email as auth_email,
              auth_user.email_confirmed_at, auth_user.invited_at, auth_user.raw_user_meta_data,
              profile.id as profile_id, profile.nome, profile.perfil::text as perfil,
              profile.status::text as status
         from auth.users as auth_user
         left join public.usuarios as profile on profile.id = auth_user.id
        where lower(auth_user.email) = lower($1)`,
      [config.email],
    );
    return {
      migration0030: migrations.rows.some(({ version }) => version === "0030") ? "APPLIED" : "ABSENT",
      migration0031: migrations.rows.some(({ version }) => version === "0031") ? "APPLIED" : "ABSENT",
      targets: target.rows,
    };
  });
}

export function validateRemoteTarget(state, email) {
  if (state?.migration0030 !== "APPLIED" || state?.migration0031 !== "APPLIED" || !Array.isArray(state.targets)) {
    throw new InviteRecoveryError("remote_guard_failed");
  }
  const rows = state.targets;
  if (rows.length !== 1) throw new InviteRecoveryError("remote_guard_failed");
  const target = rows[0];
  if (!target.auth_id || target.profile_id !== target.auth_id
    || target.auth_email?.toLowerCase() !== email.toLowerCase()
    || !target.nome?.startsWith(FIXTURE_NAME)
    || target.perfil !== "recepcao" || target.status !== "ativo"
    || target.email_confirmed_at !== null || !target.invited_at
    || metadataHasElevatedRole(target.raw_user_meta_data)) {
    throw new InviteRecoveryError("remote_guard_failed");
  }
  return { id: target.auth_id, email: target.auth_email };
}

export async function confirmInviteRecovery({ stdin = process.stdin, stdout = process.stdout } = {}) {
  if (!stdin.isTTY || !stdout.isTTY) throw new InviteRecoveryError("confirmation_required");
  const { createInterface } = await import("node:readline/promises");
  const terminal = createInterface({ input: stdin, output: stdout });
  try {
    const answer = await terminal.question(`Gerar link somente para ${FIXTURE_NAME}. Digite ${INVITE_CONFIRMATION} para continuar.\n`);
    if (answer !== INVITE_CONFIRMATION) throw new InviteRecoveryError("confirmation_required");
    return true;
  } finally {
    terminal.close();
  }
}

function createAdminClient(config) {
  return createClient(config.SUPABASE_TEST_URL, config.SUPABASE_TEST_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}

export function displayActionLinkOnce(actionLink, stdout = process.stdout) {
  stdout.write("LINK QA TEMPORÁRIO — abra apenas uma vez e não compartilhe.\n");
  stdout.write(`${actionLink}\n`);
}

async function recheckAuthUser(admin, target) {
  let response;
  try {
    response = await admin.auth.admin.getUserById(target.id);
  } catch {
    throw new InviteRecoveryError("remote_guard_failed");
  }
  const user = response?.data?.user;
  if (response?.error || user?.id !== target.id || user?.email?.toLowerCase() !== target.email.toLowerCase()
    || user.email_confirmed_at || !user.invited_at || metadataHasElevatedRole(user.user_metadata)) {
    throw new InviteRecoveryError("remote_guard_failed");
  }
}

export async function runInviteRecovery(rawConfig, dependencies = {}) {
  const config = validateLocalConfig(rawConfig, dependencies.linkedRef ?? readLinkedProjectRef());
  const confirm = dependencies.confirm ?? (() => confirmInviteRecovery());
  if (await confirm() !== true) throw new InviteRecoveryError("confirmation_required");

  const loadRemoteState = dependencies.readRemoteState ?? readRemoteState;
  const target = validateRemoteTarget(await loadRemoteState(config), config.email);
  const admin = (dependencies.createAdminClient ?? createAdminClient)(config);
  await (dependencies.recheckAuthUser ?? recheckAuthUser)(admin, target);
  let result;
  try {
    result = await admin.auth.admin.generateLink({
      type: "invite",
      email: config.email,
      options: { redirectTo: config.redirectTo },
    });
  } catch {
    throw new InviteRecoveryError("link_generation_failed");
  }
  if (result?.error) throw new InviteRecoveryError("link_generation_failed");
  const returnedUser = result?.data?.user;
  const actionLink = result?.data?.properties?.action_link;
  if (returnedUser?.id !== target.id || returnedUser?.email?.toLowerCase() !== target.email.toLowerCase() || typeof actionLink !== "string" || !actionLink.startsWith("https://")) {
    throw new InviteRecoveryError("link_target_mismatch");
  }

  const showLink = dependencies.showActionLink ?? ((link) => displayActionLinkOnce(link));
  showLink(actionLink);
  return { status: "PASS", fixture: FIXTURE_NAME };
}

async function main() {
  const config = await readLocalConfig();
  try {
    await runInviteRecovery(config);
  } catch (error) {
    console.error(`BLOCKED: ${safeErrorMessage(error)}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`BLOCKED: ${safeErrorMessage(error)}`);
    process.exitCode = 1;
  });
}
