import { readFile } from "node:fs/promises";
import { readDatabasePreflight, readFixtureRows, withReadOnlyDatabase } from "./lib/database.mjs";
import { ARTIFACT_ROOT, EXPECTED_BRANCH, currentGitState, harnessRevision, inspectProjectGuard, maskedProjectRef, readLinkedProjectRef, requiredEnvironment } from "./config.mjs";
import { mergePriorScenarioResults } from "./lib/safe.mjs";

const FIXTURES = [
  { key: "QA_ADMIN", role: "administrador", emailVariable: "HOMOLOGATION_ADMIN_EMAIL", strictName: false },
  { key: "QA_DENTISTA_A", role: "dentista", emailVariable: "HOMOLOGATION_DENTIST_A_EMAIL" },
  { key: "QA_DENTISTA_B", role: "dentista", emailVariable: "HOMOLOGATION_DENTIST_B_EMAIL" },
  { key: "QA_RECEPCAO", role: "recepcao", emailVariable: "HOMOLOGATION_RECEPTION_EMAIL" },
];

const elevatedValues = new Set(["admin", "administrator", "administrador", "superadmin", "owner", "root"]);
const elevatedKeys = new Set(["perfil", "role", "app_role", "role_name", "is_admin", "admin", "permissions", "permission", "privileges"]);

export function metadataHasElevatedRole(metadata, parentKey = "") {
  if (Array.isArray(metadata)) return metadata.some((item) => metadataHasElevatedRole(item, parentKey));
  if (typeof metadata === "string") return elevatedKeys.has(parentKey.toLowerCase()) && elevatedValues.has(metadata.toLowerCase());
  if (!metadata || typeof metadata !== "object") return elevatedKeys.has(parentKey.toLowerCase()) && metadata === true;
  for (const [key, value] of Object.entries(metadata)) {
    if (elevatedKeys.has(key.toLowerCase())) {
      if (typeof value === "boolean" && value) return true;
      if (typeof value === "string" && elevatedValues.has(value.toLowerCase())) return true;
      if (Array.isArray(value) && value.some((item) => typeof item === "string" && elevatedValues.has(item.toLowerCase()))) return true;
    }
    if (value && typeof value === "object" && metadataHasElevatedRole(value, key)) return true;
  }
  return false;
}

export function checkMigrationGate(database) {
  return {
    migration0030Applied: database?.migration0030 === "APPLIED",
    migration0031Applied: database?.migration0031 === "APPLIED",
  };
}

export function validateFixtureRows(rows, env = process.env) {
  return Object.fromEntries(FIXTURES.map((fixture) => {
    const configuredEmail = env[fixture.emailVariable]?.toLowerCase();
    const matches = fixture.key === "QA_ADMIN"
      ? configuredEmail
        ? rows.filter((row) => row.email?.toLowerCase() === configuredEmail)
        : rows.filter((row) => row.nome.startsWith("QA_") && row.perfil === "administrador" && row.status === "ativo")
      : rows.filter((row) => row.nome.startsWith(fixture.key) || (configuredEmail && row.email?.toLowerCase() === configuredEmail));
    if (matches.length === 0) return [fixture.key, { status: "ACTION_REQUIRED", reason: fixture.key === "QA_ADMIN" ? "configure_existing_QA_admin_identity" : `ACCEPT_INVITE:${fixture.key}` }];
    if (matches.length !== 1) return [fixture.key, { status: "FAIL", reason: "duplicate_identity" }];
    const row = matches[0];
    let reason = null;
    if ((fixture.strictName !== false && !row.nome.startsWith(fixture.key)) || !row.nome.startsWith("QA_")) reason = "qa_name_mismatch";
    else if (row.perfil !== fixture.role) reason = "profile_role_mismatch";
    else if (row.status !== "ativo") reason = "profile_inactive";
    else if (!row.email_confirmed_at) reason = "email_unconfirmed";
    else if (metadataHasElevatedRole(row.raw_user_meta_data)) reason = "client_user_metadata_has_privileged_role";
    return [fixture.key, { status: reason ? "FAIL" : "PASS", reason: reason ?? undefined }];
  }));
}

async function readSignupConfig(url, anonKey) {
  try {
    const response = await fetch(new URL("/auth/v1/settings", url), {
      headers: { apikey: anonKey, authorization: `Bearer ${anonKey}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return null;
    const settings = await response.json();
    if (typeof settings.disable_signup === "boolean") return settings.disable_signup;
    if (typeof settings.disable_signups === "boolean") return settings.disable_signups;
    return null;
  } catch {
    return null;
  }
}

function buildInitialReport() {
  return {
    timestamp: new Date().toISOString(),
    git: null,
    projectRefMasked: null,
    harnessRevision: null,
    preflight: { status: "BLOCKED", checks: {} },
    database: { migration0030: "UNKNOWN", migration0031: "UNKNOWN", authWithoutProfile: null, profileWithoutAuth: null },
    auth: { signupDisabled: null },
    fixtures: Object.fromEntries(FIXTURES.map(({ key }) => [key, { status: "UNKNOWN" }])),
    actorLoginReady: {
      QA_ADMIN: !!(process.env.HOMOLOGATION_ADMIN_EMAIL?.trim() && process.env.HOMOLOGATION_ADMIN_PASSWORD?.trim()),
      QA_DENTISTA_A: !!(process.env.HOMOLOGATION_DENTIST_A_EMAIL?.trim() && process.env.HOMOLOGATION_DENTIST_A_PASSWORD?.trim()),
      QA_DENTISTA_B: !!(process.env.HOMOLOGATION_DENTIST_B_EMAIL?.trim() && process.env.HOMOLOGATION_DENTIST_B_PASSWORD?.trim()),
      QA_RECEPCAO: !!(process.env.HOMOLOGATION_RECEPTION_EMAIL?.trim() && process.env.HOMOLOGATION_RECEPTION_PASSWORD?.trim()),
    },
    scenarios: Object.fromEntries([
      ...["H01-A", "H01-B", "H01-C", "H01-D", "H01-E"],
      ...["H02-A", "H02-B", "H02-C", "H02-D", "H02-E", "H02-F"],
    ].map((name) => [name, { status: "BLOCKED", evidence: "not_executed_preflight_blocked" }])),
    knownResults: {
      H03: "PASS (informado pelo solicitante; não reexecutado)",
      H04: "PASS (informado pelo solicitante; não reexecutado)",
      H05: "PASS (informado pelo solicitante; não reexecutado)",
    },
    findings: [{ id: "AUTH_GETSESSION", status: "SEPARATE_FINDING", file: "tests/integration/release-highs.authorization.test.ts:122", detail: "Somente o teste de integração usa getSession() para transferir a sessão autenticada ao cliente SSR de teste. O aviso é pertinente se esse padrão for usado para decisões de autorização no servidor; nenhum uso em app/ ou lib/ foi encontrado. Não alterado." }],
    final: { homologation: "BLOCKED", migration0031Gate: "BLOCKED" },
  };
}

export async function runPreflight() {
  const previousReport = await readFile(`${ARTIFACT_ROOT}/0030-report.json`, "utf8").then((data) => JSON.parse(data)).catch(() => null);
  const report = buildInitialReport();
  report.harnessRevision = harnessRevision();
  try { report.git = currentGitState(); } catch { report.preflight.checks.gitAvailable = false; }
  if (report.git) {
    report.preflight.checks.branch = report.git.branch === EXPECTED_BRANCH;
    report.preflight.checks.dirtyTreeAllowed = true;
    report.preflight.checks.headRecorded = !!report.git.head;
  }
  const missing = requiredEnvironment();
  report.preflight.checks.requiredEnvironment = missing.length === 0;
  report.preflight.missingVariableNames = missing;
  if (missing.length) {
    report.preflight.reason = "required_configuration_missing";
    return finalize(report, previousReport);
  }
  if (!report.git || !report.preflight.checks.branch) {
    report.preflight.reason = "expected_branch_required";
    return finalize(report, previousReport);
  }

  const linkedRef = readLinkedProjectRef();
  const guard = inspectProjectGuard(process.env, linkedRef);
  report.projectRefMasked = maskedProjectRef(guard.expectedRef);
  report.preflight.checks.projectGuard = guard.checks;
  if (!guard.pass) {
    report.preflight.reason = "project_guard_failed";
    return finalize(report, previousReport);
  }

  const [signupDisabled, database] = await Promise.all([
    readSignupConfig(process.env.SUPABASE_TEST_URL, process.env.SUPABASE_TEST_ANON_KEY),
    withReadOnlyDatabase(process.env.SUPABASE_TEST_DB_URL, readDatabasePreflight),
  ]).catch(() => [null, null]);
  report.auth.signupDisabled = signupDisabled;
  report.database = database ?? report.database;
  if (!database) report.preflight.reason = "read_only_database_query_failed";
  if (!database || signupDisabled === null) return finalize(report, previousReport);

  const migrationGate = checkMigrationGate(database);
  report.preflight.checks.migration0030Applied = migrationGate.migration0030Applied;
  report.preflight.checks.migration0031Applied = migrationGate.migration0031Applied;
  report.preflight.checks.signupDisabled = signupDisabled === true;
  report.preflight.checks.authProfileOrphansZero = database.authWithoutProfile === 0;
  report.preflight.checks.profileAuthOrphansZero = database.profileWithoutAuth === 0;

  try {
    const rows = await withReadOnlyDatabase(process.env.SUPABASE_TEST_DB_URL, (client) => readFixtureRows(client, FIXTURES.map(({ key }) => key), Object.fromEntries(FIXTURES.map(({ key, emailVariable }) => [key, process.env[emailVariable]]))));
    report.fixtures = validateFixtureRows(rows);
  } catch {
    report.fixtures = Object.fromEntries(FIXTURES.map(({ key }) => [key, { status: "BLOCKED", reason: "fixture_query_failed" }]));
  }

  const coreChecks = [
    report.preflight.checks.requiredEnvironment,
    report.preflight.checks.branch,
    guard.pass,
    report.preflight.checks.migration0030Applied,
    report.preflight.checks.migration0031Applied,
    report.preflight.checks.signupDisabled,
    report.preflight.checks.authProfileOrphansZero,
    report.preflight.checks.profileAuthOrphansZero,
  ];
  const fixtureChecks = Object.values(report.fixtures).every((fixture) => fixture.status === "PASS");
  report.preflight.checks.fixturesReady = fixtureChecks;
  report.preflight.status = coreChecks.every(Boolean) && fixtureChecks ? "PASS" : "BLOCKED";
  if (report.preflight.status !== "PASS") report.preflight.reason ??= "one_or_more_read_only_gates_failed";
  return finalize(report, previousReport);
}

async function finalize(report, previousReport) {
  mergePriorScenarioResults(report, previousReport);
  // H01/H02 alone cannot certify cleanup or the complete remote QA suite.
  report.final = { homologation: "BLOCKED", migration0031Gate: "BLOCKED" };
  const { saveReport } = await import("./lib/safe.mjs");
  const paths = await saveReport(report);
  return { report, paths };
}
