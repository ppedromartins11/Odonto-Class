import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { withReadOnlyDatabase, readDatabasePreflight, readFixtureRows } from "./0030/lib/database.mjs";
import { validateFixtureRows } from "./0030/preflight.mjs";

const FIXTURES = [
  ["QA_ADMIN", "HOMOLOGATION_ADMIN_EMAIL", "administrador"],
  ["QA_DENTISTA_A", "HOMOLOGATION_DENTIST_A_EMAIL", "dentista"],
  ["QA_DENTISTA_B", "HOMOLOGATION_DENTIST_B_EMAIL", "dentista"],
  ["QA_RECEPCAO", "HOMOLOGATION_RECEPTION_EMAIL", "recepcao"],
];

/** Exclude only the four configured permanent identities, never every QA admin. */
export function permanentFixtureIds(rows, env) {
  const ids = [];
  for (const [name, variable, role] of FIXTURES) {
    const expectedEmail = env[variable]?.toLowerCase();
    if (!expectedEmail) continue;
    const matches = rows.filter(row => row.email?.toLowerCase() === expectedEmail
      && (row.nome === name || row.nome.startsWith(`${name}_`))
      && row.perfil === role && row.status === "ativo");
    if (matches.length === 1) ids.push(matches[0].id);
  }
  return ids;
}

export function compareMigrationVersions(local, remote) {
  const localSet = new Set(local);
  const remoteSet = new Set(remote);
  const missing = [...localSet].filter((version) => !remoteSet.has(version)).sort();
  const unexpected = [...remoteSet].filter((version) => !localSet.has(version)).sort();
  const valid = local.length > 0 && localSet.size === local.length && remoteSet.size === remote.length
    && local.every((version) => /^\d+$/.test(version)) && remote.every((version) => /^\d+$/.test(version));
  return { status: valid && missing.length === 0 && unexpected.length === 0 ? "PASS" : "FAIL",
    localCount: local.length, remoteCount: remote.length, missing, unexpected };
}

async function readLocalVersions(root) {
  const files = await readdir(join(root, "supabase", "migrations"));
  const versions = files.filter((name) => name.endsWith(".sql")).map((name) => /^(\d+)_.*\.sql$/.exec(name)?.[1]);
  if (versions.some((version) => !version)) throw new Error("MIGRATION_FILE_NAME_INVALID");
  return versions.sort();
}

export async function readSignupStatus(env) {
  try {
    const response = await fetch(new URL("/auth/v1/settings", env.SUPABASE_TEST_URL), {
      headers: { apikey: env.SUPABASE_TEST_ANON_KEY, authorization: `Bearer ${env.SUPABASE_TEST_ANON_KEY}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return null;
    const settings = await response.json();
    const flags = [settings.disable_signup, settings.disable_signups].filter((value) => typeof value === "boolean");
    if (!flags.length || flags.some((value) => value !== flags[0])) return null;
    return flags[0];
  } catch { return null; }
}

async function readRemoteInventory(client, env) {
  const database = await readDatabasePreflight(client);
  const migrationResult = await client.query("select version::text as version from supabase_migrations.schema_migrations order by version");
  const fixtureRows = await readFixtureRows(client, FIXTURES.map(([name]) => name),
    Object.fromEntries(FIXTURES.map(([name, variable]) => [name, env[variable]])));
  const fixtureStatus = validateFixtureRows(fixtureRows, env);
  const protectedIds = permanentFixtureIds(fixtureRows, env);
  const bootstrapTable = await client.query("select to_regclass('bootstrap_private.initial_admin_authorization') as relation");
  let bootstrapStatus = "BLOCKED";
  if (bootstrapTable.rows[0]?.relation) {
    const bootstrap = await client.query(`select b.usuario_id, b.consumed_at, b.email, b.nome,
      a.email auth_email, a.raw_app_meta_data ? 'initial_admin_bootstrap_token' token_present,
      u.email profile_email, u.nome profile_name, u.perfil::text perfil, u.status::text status
      from bootstrap_private.initial_admin_authorization b
      left join auth.users a on a.id=b.usuario_id
      left join public.usuarios u on u.id=b.usuario_id`);
    const row = bootstrap.rows[0];
    if (bootstrap.rowCount === 1 && row.usuario_id && row.consumed_at
      && row.email === row.auth_email && row.email === row.profile_email
      && row.nome === row.profile_name && row.nome.startsWith("QA_")
      && row.perfil === "administrador" && row.status === "ativo" && row.token_present === false) {
      protectedIds.push(row.usuario_id);
      bootstrapStatus = "PASS";
    }
  }
  const residualResult = await client.query(`
    select
      (select count(*) from public.pacientes where nome ~ '^QA_')::integer as patients,
      (select count(*) from public.servicos where nome ~ '^QA_')::integer as services,
      (select count(*) from public.materiais_estoque where nome ~ '^QA_')::integer as materials,
      (select count(*) from public.documentos where nome_arquivo ~ '^QA_')::integer as documents,
      (select count(*) from public.agendamentos where observacoes_administrativas ~ '^QA_')::integer as appointments,
      (select count(*) from public.usuarios where nome ~ '^QA_'
        and not (id = any($1::uuid[])))::integer as disposable_profiles
  `, [protectedIds]);
  const legacyGrants = await client.query(`
    select count(*)::integer as executable_overloads from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'update_budget_status'
      and (has_function_privilege('anon', p.oid, 'EXECUTE')
        or has_function_privilege('authenticated', p.oid, 'EXECUTE')
        or has_function_privilege('service_role', p.oid, 'EXECUTE')
        or exists(select 1 from aclexplode(coalesce(p.proacl, acldefault('f',p.proowner))) acl
          where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'))
  `);
  return { database, remoteVersions: migrationResult.rows.map((row) => row.version),
    fixtures: fixtureStatus, bootstrapStatus, residualCounts: residualResult.rows[0],
    executableLegacyOverloads: legacyGrants.rows[0]?.executable_overloads ?? null };
}

/** Read-only remote checkpoint; never logs credentials, row identifiers, or fixture content. */
export async function runRemoteChecks({ env = process.env, linkedRef, guard, root } = {}) {
  if (guard?.pass !== true) {
    return { status: "BLOCKED", checks: [{ name: "project_guard", status: "BLOCKED", reason: "target_project_guard_failed" }] };
  }
  const checks = [{ name: "project_guard", status: "PASS" }];
  if (!linkedRef || linkedRef !== env.SUPABASE_TEST_PROJECT_REF) {
    return { status: "BLOCKED", checks: [...checks, { name: "linked_project", status: "BLOCKED", reason: "linked_project_identity_not_confirmed" }] };
  }
  if (!["SUPABASE_TEST_DB_URL", "SUPABASE_TEST_URL", "SUPABASE_TEST_ANON_KEY"].every((name) => env[name]?.trim())) {
    return { status: "BLOCKED", checks: [...checks, { name: "remote_configuration", status: "BLOCKED", reason: "required_environment_missing" }] };
  }
  let localVersions;
  try { localVersions = await readLocalVersions(root); } catch {
    return { status: "BLOCKED", checks: [...checks, { name: "local_migrations", status: "BLOCKED", reason: "local_migration_inventory_failed" }] };
  }
  const outcomes = await Promise.allSettled([
    withReadOnlyDatabase(env.SUPABASE_TEST_DB_URL, (client) => readRemoteInventory(client, env)),
    readSignupStatus(env),
  ]);
  const signupDisabled = outcomes[1].status === "fulfilled" ? outcomes[1].value : null;
  checks.push({ name: "signup_disabled", status: signupDisabled === true ? "PASS" : signupDisabled === false ? "FAIL" : "BLOCKED",
    ...(signupDisabled === null ? { reason: "auth_settings_not_confirmed" } : {}) });
  if (outcomes[0].status !== "fulfilled") {
    return { status: "BLOCKED", checks: [...checks, { name: "remote_database", status: "BLOCKED", reason: "read_only_remote_inventory_failed" }], signupDisabled };
  }
  const inventory = outcomes[0].value;
  const migrations = compareMigrationVersions(localVersions, inventory.remoteVersions);
  checks.push({ name: "migrations", status: migrations.status },
    { name: "bootstrap_provisioner", status: inventory.bootstrapStatus },
    { name: "auth_profile_orphans", status: inventory.database.authWithoutProfile === 0 ? "PASS" : "FAIL" },
    { name: "profile_auth_orphans", status: inventory.database.profileWithoutAuth === 0 ? "PASS" : "FAIL" },
    { name: "known_residual_fixtures", status: Object.values(inventory.residualCounts ?? {}).length > 0
      && Object.values(inventory.residualCounts).every((value) => value === 0) ? "PASS" : "FAIL" },
    { name: "deprecated_rpc_grants", status: inventory.executableLegacyOverloads === 0 ? "PASS" : "FAIL" });
  for (const [name, fixture] of Object.entries(inventory.fixtures)) {
    checks.push({ name, status: fixture.status === "PASS" ? "PASS" : fixture.status === "FAIL" ? "FAIL" : "BLOCKED",
      ...(fixture.reason ? { reason: fixture.reason } : {}) });
  }
  return { status: checks.some((check) => check.status === "FAIL") ? "FAIL"
    : checks.some((check) => check.status === "BLOCKED") ? "BLOCKED" : "PASS",
    checks, migrations, database: inventory.database, signupDisabled,
    fixtures: inventory.fixtures, residualCounts: inventory.residualCounts,
    executableLegacyOverloads: inventory.executableLegacyOverloads };
}
