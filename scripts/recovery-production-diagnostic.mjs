/** Single-connection, read-only diagnostic. No dump, filesystem writes or retry path. */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { childEnvironment, WRAPPER, FIELDS } from './recovery-database-backup.mjs';

const PROD = 'sqouddqzpmkofenyufuj';
const QA = 'zxvpyxvhymuibaxgxetf';
const DR = 'qprzxkolbbnqfopamfhj';
const CA = 'C:\\Users\\ppedr\\supabase-certs\\prod-ca-2021.crt';
const IMAGE = 'postgres:17-bookworm@sha256:3645570cccdfa447589da9f57dd740faa29b30938e861289a5574b6ca6b03826';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const SQL = `\\conninfo
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT '__DIAGNOSTIC_JSON__' || json_build_object(
 'databaseExpected', current_database() = 'postgres',
 'serverVersion', regexp_replace(current_setting('server_version'), '[^0-9.].*$', ''),
 'serverExpected', current_setting('server_version') ~ '^17[.]6(\\s|$)',
 'backendTls', (SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()),
 'readOnly', current_setting('transaction_read_only') = 'on',
 'migrationCount', (SELECT count(*) FROM supabase_migrations.schema_migrations),
 'migrationMax', (SELECT CASE WHEN max(version) ~ '^[0-9]{4}$' THEN max(version) ELSE 'INVALID' END FROM supabase_migrations.schema_migrations),
 'migrations', (SELECT coalesce(json_agg(CASE WHEN version ~ '^[0-9]{4}$' THEN version ELSE 'INVALID' END ORDER BY version), '[]'::json) FROM supabase_migrations.schema_migrations)
)::text;
ROLLBACK;
`;

// Raw conninfo/diagnostics stay in container process memory, never Docker stdout/stderr.
// Only explicitly marked catalog JSON and a boolean TLS observation leave the container.
const INSIDE = `set -euo pipefail
if output=$(psql -X -qAt --no-password -v ON_ERROR_STOP=1 2>&1); then
  printf '%s\\n' "$output" | awk '
    /^SSL connection \\(/ { tls = 1 }
    /^__DIAGNOSTIC_JSON__/ { sub(/^__DIAGNOSTIC_JSON__/, ""); result = $0; count++ }
    END {
      if (count != 1) { print "SANITIZED_PROBE_OUTPUT_UNAVAILABLE"; exit 61 }
      print "CLIENT_TLS=" (tls ? "true" : "false"); print result
    }'
else
  printf '%s\\n' 'SANITIZED_PROBE_CONNECTION_FAILED'
  exit 60
fi`;

function credential(raw) {
  if (!raw) throw new Error('PRODUCTION_DB_URL_ABSENT');
  const u = new URL(raw);
  const host = u.hostname.toLowerCase();
  const user = decodeURIComponent(u.username);
  const password = decodeURIComponent(u.password);
  const qaExcluded = !raw.includes(QA);
  const productionTarget = ['postgres:', 'postgresql:'].includes(u.protocol)
    && ((host === `db.${PROD}.supabase.co` && user === 'postgres')
      || (/^[a-z0-9-]+\.pooler\.supabase\.com$/.test(host) && user === `postgres.${PROD}`))
    && qaExcluded && !raw.includes(DR);
  if (!productionTarget || decodeURIComponent(u.pathname) !== '/postgres' || u.hash
      || !password || [host, user, password].some((v) => v.includes('\0'))) throw new Error('CREDENTIAL_TARGET_REJECTED');
  for (const name of u.searchParams.keys()) {
    if (!['sslmode', 'sslrootcert', 'connect_timeout'].includes(name)) throw new Error('CONNECTION_OPTION_REJECTED');
  }
  // URI options are never forwarded; TLS and read-only options below are fixed.
  return { values: { PGHOST: host, PGPORT: u.port || '5432', PGUSER: user, PGPASSWORD: password, PGDATABASE: 'postgres' }, productionTarget, qaExcluded };
}

function invokeDocker(args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', args, { shell: false, windowsHide: true, env: childEnvironment(), stdio: ['pipe', 'pipe', 'pipe'] });
    const chunks = [];
    let length = 0;
    child.stdout.on('data', (chunk) => {
      length += chunk.length;
      if (length > 1048576) { child.kill(); reject(new Error('DIAGNOSTIC_OUTPUT_LIMIT')); }
      else chunks.push(chunk);
    });
    child.stderr.on('data', () => {}); // Never log raw Docker/libpq diagnostics.
    child.stdin.on('error', () => {});
    child.on('error', () => reject(new Error('DOCKER_UNAVAILABLE')));
    child.on('close', (code) => resolve({ code, output: Buffer.concat(chunks).toString('utf8') }));
    child.stdin.end(input);
  });
}

function evaluate(probe, clientTls, target, localVersions) {
  if (!probe || !Array.isArray(probe.migrations) || probe.migrations.some((v) => !/^(?:[0-9]{4}|INVALID)$/.test(v))
      || !Number.isSafeInteger(probe.migrationCount) || !/^(?:[0-9]{4}|INVALID)$/.test(probe.migrationMax)
      || typeof probe.serverVersion !== 'string' || probe.serverVersion.length > 64 || !/^[0-9]+(?:\.[0-9]+){1,7}$/.test(probe.serverVersion)
      || !['databaseExpected', 'serverExpected', 'readOnly'].every((key) => typeof probe[key] === 'boolean')
      || ![true, false, null].includes(probe.backendTls)) throw new Error('SANITIZED_PROBE_SHAPE_INVALID');
  const expectedMigrations = Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(4, '0'));
  const pending = localVersions.filter((v) => !probe.migrations.includes(v));
  const exactMigrations = JSON.stringify(probe.migrations) === JSON.stringify(expectedMigrations);
  const pendingMatch = JSON.stringify(pending) === JSON.stringify(['0032', '0033']);
  const flags = {
    CONNECTIVITY: true, TLS_VERIFY_FULL: clientTls, DATABASE_NAME: probe.databaseExpected,
    POSTGRES_SERVER_VERSION: probe.serverExpected, PRODUCTION_TARGET: target.productionTarget,
    QA_EXCLUDED: target.qaExcluded, MIGRATION_COUNT_MATCH: probe.migrationCount === 31,
    MAX_MIGRATION_MATCH: probe.migrationMax === '0031', PENDING_MATCH: pendingMatch,
    // Original compound conditions retained independently, without conflating backend/client TLS.
    'pg_stat_ssl.ssl': probe.backendTls === true,
    transaction_read_only: probe.readOnly,
    MIGRATION_SEQUENCE_MATCH: exactMigrations,
  };
  return { flags, pending, observed: probe, divergent: Object.entries(flags).filter(([, pass]) => !pass).map(([name]) => name) };
}

function render(result) {
  const { flags: f, observed: p, pending, divergent } = result;
  const status = (pass) => pass ? 'PASS' : 'FAIL';
  return `# PRODUCTION DIAGNOSTIC PROBE

CONNECTIVITY: ${status(f.CONNECTIVITY)}
TLS_VERIFY_FULL: ${status(f.TLS_VERIFY_FULL)}
DATABASE_NAME: ${f.DATABASE_NAME ? 'postgres' : 'OTHER'}
POSTGRES_SERVER_VERSION: ${p.serverVersion}
PRODUCTION_TARGET: ${status(f.PRODUCTION_TARGET)}
QA_EXCLUDED: ${status(f.QA_EXCLUDED)}
MIGRATION_COUNT: ${p.migrationCount}
EXPECTED_MIGRATION_COUNT: 31
MIGRATION_COUNT_MATCH: ${status(f.MIGRATION_COUNT_MATCH)}
MAX_MIGRATION: ${p.migrationMax}
EXPECTED_MAX_MIGRATION: 0031
MAX_MIGRATION_MATCH: ${status(f.MAX_MIGRATION_MATCH)}
PENDING_MIGRATIONS: ${pending.join(',') || 'NONE'}
EXPECTED_PENDING: 0032,0033
PENDING_MATCH: ${status(f.PENDING_MATCH)}

DIVERGENT_FIELD:
${divergent.join(', ') || 'NONE'}

DIAGNOSTIC RESULT:
${divergent.length ? 'BLOCKED' : 'PASS'}

ACTION_REQUIRED: ${divergent.length ? 'PRODUCTION_PROBE_DIVERGENCE_IDENTIFIED' : 'PRODUCTION_PROBE_DIVERGENCE_RESOLVED'}

ORIGINAL_CONDITION_FLAGS:
serverExpected: ${status(p.serverExpected)}
serverTlsFlag (pg_stat_ssl.ssl): ${p.backendTls === null ? 'UNKNOWN' : p.backendTls}
readOnlyExpected: ${status(p.readOnly)}
MIGRATION_SEQUENCE_MATCH: ${status(f.MIGRATION_SEQUENCE_MATCH)}`;
}

async function main() {
  if (process.argv.slice(2).join(' ') !== '--execute-once') throw new Error('EXPLICIT_SINGLE_PROBE_REQUIRED');
  const target = credential(process.env.PRODUCTION_DB_URL);
  if (!existsSync(CA)) throw new Error('CA_ABSENT');
  const localVersions = (await readdir(path.join(ROOT, 'supabase', 'migrations')))
    .map((name) => name.match(/^([0-9]{4})_.+\.sql$/)?.[1]).filter(Boolean).sort();
  const context = await invokeDocker(['context', 'inspect']);
  if (context.code !== 0) throw new Error('LOCAL_DOCKER_UNAVAILABLE');
  const endpoint = JSON.parse(context.output)?.[0]?.Endpoints?.docker?.Host;
  if (!/^npipe:\/\/\/\/\.\/pipe\/[a-zA-Z0-9_-]+$/.test(endpoint || '')) throw new Error('LOCAL_DOCKER_REQUIRED');
  const args = ['run', '--rm', '--pull=never', '-i', '--log-driver=none', '--read-only', '--cap-drop=ALL', '--security-opt', 'no-new-privileges',
    '--tmpfs', '/tmp:rw,noexec,nosuid,size=16m', '--env', 'LC_ALL=C',
    '--env', 'PGSSLMODE=verify-full', '--env', 'PGSSLROOTCERT=/certs/prod-ca-2021.crt',
    '--env', 'PGOPTIONS=-c default_transaction_read_only=on', '--env', 'PGCONNECT_TIMEOUT=20',
    '--mount', `type=bind,source=${CA},target=/certs/prod-ca-2021.crt,readonly`,
    IMAGE, 'bash', '-c', WRAPPER, 'diagnostic', 'bash', '-c', INSIDE];
  // Exactly one psql invocation/connection. No loop, reconnect command, fallback or dump mode.
  const input = Buffer.from(FIELDS.map((name) => target.values[name] || '').join('\0') + '\0' + SQL, 'utf8');
  const response = await invokeDocker(args, input);
  input.fill(0);
  if (response.code !== 0) throw new Error('SINGLE_PROBE_FAILED_NO_RETRY');
  const lines = response.output.trim().split(/\r?\n/);
  if (lines.length !== 2 || !/^CLIENT_TLS=(?:true|false)$/.test(lines[0])) throw new Error('DIAGNOSTIC_OUTPUT_INVALID');
  const result = evaluate(JSON.parse(lines[1]), lines[0] === 'CLIENT_TLS=true', target, localVersions);
  console.log(render(result));
}

export { credential, evaluate, render, SQL, INSIDE };
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    // Fixed diagnostic only: never output raw exceptions, host, conninfo, SQL errors or secrets.
    console.error('DIAGNOSTIC RESULT: BLOCKED\nACTION_REQUIRED: PRODUCTION_PROBE_DIVERGENCE_IDENTIFIED\nSINGLE_PROBE_FAILED_OR_UNAVAILABLE: no retry performed');
    process.exitCode = 1;
  });
}
