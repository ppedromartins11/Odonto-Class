/** Local-only disposable recovery rehearsal. Default mode prints a plan, never starts resources. */
import { spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, writeFile, realpath, stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LABEL = 'odonto.recovery.rehearsal';
const IMAGES = {
  database: 'public.ecr.aws/supabase/postgres:17.6.1.165',
  auth: 'public.ecr.aws/supabase/gotrue:v2.196.0',
  storage: 'public.ecr.aws/supabase/storage-api:v1.71.0',
};
const BASELINE_TRIGGERS = {
  on_auth_user_created: 'CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user()',
  on_auth_user_email_updated: 'CREATE TRIGGER on_auth_user_email_updated AFTER UPDATE OF email ON auth.users FOR EACH ROW EXECUTE FUNCTION public.sync_auth_user_email()',
};
const KEYS = ['publicTables', 'functions', 'triggers', 'policies', 'tableGrants', 'constraints', 'indexes', 'sequences', 'authUserColumns', 'authIdentityColumns', 'managedSecurity'];
const AUTH_JSON_POLICY = {
  users: { raw_user_meta_data: [], raw_app_meta_data: ['provider', 'providers'] },
  identities: { identity_data: ['sub', 'email', 'phone', 'provider_id', 'email_verified', 'phone_verified'] },
};
function fail(code) { throw new Error(code); }
function sanitizedError(error) { return /^[A-Z0-9_]+$/.test(error.message) || /^(LOCAL_DOCKER_EXIT_[0-9]+|RESTORE_SQL_EXIT_[0-9]+)_DIAGNOSTIC_SHA256_[a-f0-9]{64}$/.test(error.message) ? error.message : error instanceof SyntaxError ? 'LOCAL_QUERY_RESPONSE_NOT_JSON' : 'RESTORE_REHEARSAL_FAILED'; }
function digest(value) { return createHash('sha256').update(value).digest('hex'); }
function environment() {
  const allow = ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATHEXT', 'USERPROFILE', 'HOME', 'TEMP', 'TMP', 'APPDATA', 'LOCALAPPDATA', 'DOCKER_CONFIG'];
  return Object.fromEntries(allow.filter((key) => process.env[key]).map((key) => [key, process.env[key]]));
}
function startDocker(args, input = null, { discardOutput = false } = {}) {
  const child = spawn('docker', args, { shell: false, windowsHide: true, env: environment(), stdio: ['pipe', 'pipe', 'pipe'] });
  const stdout = [], stderr = [];
  child.stdout.on('data', (b) => { if (!discardOutput) stdout.push(b); });
  child.stderr.on('data', (b) => stderr.push(b));
  const done = new Promise((resolve, reject) => {
    child.on('error', () => reject(new Error('DOCKER_UNAVAILABLE')));
    child.on('close', (code) => code === 0 ? resolve(Buffer.concat(stdout).toString('utf8')) : reject(new Error(`LOCAL_DOCKER_EXIT_${code}_DIAGNOSTIC_SHA256_${digest(Buffer.concat(stderr))}`)));
  });
  if (input && typeof input.pipe === 'function') input.on('error', () => child.stdin.destroy()).pipe(child.stdin);
  else child.stdin.end(input ?? undefined);
  child.stdin.on('error', () => {});
  // Attach a rejection handler immediately, including for the long-running local database.
  done.catch(() => {});
  return { child, done };
}
function docker(args, input = null) { return startDocker(args, input).done; }
async function json(file) { return JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, '')); }
async function shaFile(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
function identifier(value) {
  if (typeof value !== 'string' || value.includes('\0')) fail('INVALID_CATALOG_IDENTIFIER');
  return `"${value.replaceAll('"', '""')}"`;
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}
function same(a, b) { return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b)); }

export function validateBackupManifest(manifest) {
  if (manifest.sourceProjectRef !== 'sqouddqzpmkofenyufuj' || manifest.authBackupStrategy !== 'REDUCED AUTH BACKUP' || manifest.migrationMax !== '0031' || manifest.migrationCount !== 31 || manifest.tlsMode !== 'verify-full' || manifest.connectionMode !== 'SESSION_POOLER') fail('DATABASE_BACKUP_GATE_MISMATCH');
  if (!Array.isArray(manifest.files) || manifest.files.length !== 3 || new Set(manifest.files.map((entry) => entry.filename)).size !== 3) fail('DATABASE_FILE_SET_MISMATCH');
  for (const filename of ['roles.sql', 'schema.sql', 'data.sql']) {
    const entry = manifest.files.find((item) => item.filename === filename);
    if (!entry || !Number.isSafeInteger(entry.size) || entry.size <= 0 || !/^[a-f0-9]{64}$/.test(entry.sha256 ?? '')) fail('DATABASE_INTEGRITY_EVIDENCE_REQUIRED');
  }
}

export function validateAuthReduction(reduction, source) {
  if (reduction.strategy !== 'REDUCED AUTH BACKUP' || !same(reduction.jsonPolicy, AUTH_JSON_POLICY)) fail('AUTH_REDUCTION_EVIDENCE_REQUIRED');
  if (!Array.isArray(reduction.scrubbedAuthUserColumns) || !reduction.scrubbedAuthUserColumns.length || reduction.scrubbedAuthUserColumns.some((name) => !/^[a-z_][a-z0-9_]*$/.test(name))) fail('AUTH_REDUCTION_EVIDENCE_REQUIRED');
  if (!Array.isArray(source.authTables) || !same(reduction.excludedAuthTables, source.authTables.filter((name) => !['users', 'identities'].includes(name)))) fail('AUTH_EXCLUSION_SET_MISMATCH');
  const expectedCounts = [...source.publicTables.map((table) => `public.${table.name}`), 'auth.users', 'auth.identities', 'storage.buckets', 'storage.objects'];
  return expectedCounts;
}

export function validateAuthTriggers(triggers, bindings, sourceFunctions) {
  if (!Array.isArray(triggers) || triggers.length !== 2 || new Set(triggers.map((item) => item.name)).size !== 2 || !Array.isArray(bindings) || bindings.length !== 2 || new Set(bindings.map((item) => item.name)).size !== 2) fail('APP_AUTH_TRIGGER_BINDING_EVIDENCE_REQUIRED');
  for (const trigger of triggers) {
    const expected = BASELINE_TRIGGERS[trigger.name];
    const functionName = trigger.name === 'on_auth_user_created' ? 'handle_new_auth_user' : 'sync_auth_user_email';
    const binding = bindings.find((item) => item.name === trigger.name);
    const candidates = sourceFunctions?.filter((item) => item.name === functionName && item.args === '') ?? [];
    const sourceFunction = candidates.length === 1 ? candidates[0] : null;
    // Only this qualification difference is accepted; event/timing/WHEN/arguments stay exact.
    if (!expected || trigger.schema !== 'auth' || trigger.table !== 'users' || trigger.enabled !== 'O' || ![expected, expected.replace(`public.${functionName}()`, `${functionName}()`)].includes(trigger.definition)) fail('APP_AUTH_TRIGGER_BASELINE_DRIFT');
    if (!binding || binding.schema !== trigger.schema || binding.table !== trigger.table || binding.definition !== trigger.definition || binding.enabled !== trigger.enabled || binding.functionSchema !== 'public' || binding.functionName !== functionName || binding.functionArgs !== '') fail('APP_AUTH_TRIGGER_BINDING_MISMATCH');
    if (!sourceFunction || !/^[a-f0-9]{32}$/.test(sourceFunction.definitionHash ?? '') || binding.functionDefinitionHash !== sourceFunction.definitionHash) fail('APP_AUTH_TRIGGER_FUNCTION_DRIFT');
  }
}

async function preflight(run) {
  if (!run || !path.isAbsolute(run)) fail('ABSOLUTE_SECURE_RUN_REQUIRED');
  if (await realpath(run) !== path.resolve(run) || /onedrive/i.test(run)) fail('UNSAFE_RUN_DIRECTORY');
  const manifestDir = path.join(run, 'manifests');
  const protection = await json(path.join(manifestDir, 'local-protection.json'));
  if (!protection.outsideOneDrive || protection.run?.path !== run || !protection.run?.inheritanceProtected || protection.parent?.untrustedMutationAllowed !== false || protection.root?.untrustedMutationAllowed !== false) fail('PRIVATE_BACKUP_EVIDENCE_REQUIRED');
  const manifest = await json(path.join(manifestDir, 'database-backup-manifest.json'));
  validateBackupManifest(manifest);
  for (const filename of ['roles.sql', 'schema.sql', 'data.sql']) {
    const entry = manifest.files?.find((item) => item.filename === filename);
    const file = path.join(run, 'database', filename);
    if (!entry || !entry.size || (await stat(file)).size !== entry.size || await shaFile(file) !== entry.sha256) fail('DATABASE_INTEGRITY_FAILED');
  }
  const source = await json(path.join(manifestDir, 'source-catalog.json'));
  const counts = await json(path.join(manifestDir, 'source-counts.json'));
  const authReduction = await json(path.join(manifestDir, 'auth-reduction.json'));
  if (!same(source.schemaMigrations, Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(4, '0')))) fail('SOURCE_MIGRATION_STATE_MISMATCH');
  if (!source.managedMigrations?.authMax || !Number.isSafeInteger(source.managedMigrations?.storageMax)) fail('MANAGED_MIGRATION_EVIDENCE_REQUIRED');
  for (const key of KEYS.filter((key) => key !== 'managedSecurity')) if (!Array.isArray(source[key])) fail('SOURCE_CATALOG_EVIDENCE_INCOMPLETE');
  for (const key of ['tables', 'policies', 'tableGrants', 'schemaGrants', 'functionGrants']) if (!Array.isArray(source.managedSecurity?.[key])) fail('SOURCE_MANAGED_SECURITY_EVIDENCE_INCOMPLETE');
  const expectedCounts = validateAuthReduction(authReduction, source);
  if (!same(Object.keys(counts), expectedCounts)) fail('CRITICAL_COUNT_EVIDENCE_INCOMPLETE');
  const authTriggers = source.triggers.filter((t) => t.schema === 'auth');
  const triggerBindings = await json(path.join(manifestDir, 'auth-trigger-bindings.json'));
  if (triggerBindings.sourceProjectRef !== manifest.sourceProjectRef || triggerBindings.triggerCount !== 2 || triggerBindings.sourceCatalogSha256 !== await shaFile(path.join(manifestDir, 'source-catalog.json'))) fail('APP_AUTH_TRIGGER_BINDING_CATALOG_MISMATCH');
  validateAuthTriggers(authTriggers, triggerBindings.triggers, source.functions);
  for (const [table, count] of Object.entries(counts)) if (!/^(public|auth|storage)\.[a-z_][a-z0-9_]*$/.test(table) || !Number.isSafeInteger(count) || count < 0) fail('INVALID_COUNT_EVIDENCE');
  const context = JSON.parse(await docker(['context', 'inspect']));
  if (!/^npipe:\/\/\/\/\.\/pipe\/[a-zA-Z0-9_-]+$/.test(context?.[0]?.Endpoints?.docker?.Host ?? '')) fail('DOCKER_CONTEXT_NOT_LOCAL');
  const pinned = {};
  let databaseEntrypoint;
  let databaseCommand;
  for (const [name, tag] of Object.entries(IMAGES)) {
    const info = JSON.parse(await docker(['image', 'inspect', tag]));
    const reference = info?.[0]?.RepoDigests?.find((d) => d.startsWith(`${tag.slice(0, tag.lastIndexOf(':'))}@sha256:`));
    if (!reference || !/@sha256:[0-9a-f]{64}$/.test(reference)) fail('PINNED_LOCAL_IMAGE_REQUIRED');
    pinned[name] = reference;
    if (name === 'database') {
      databaseEntrypoint = info[0].Config?.Entrypoint;
      databaseCommand = info[0].Config?.Cmd;
      if (!info[0].Config?.Env?.includes('PGDATA=/var/lib/postgresql/data') || !same(databaseCommand, ['postgres', '-D', '/etc/postgresql'])) fail('DATABASE_IMAGE_CONFIGURATION_UNPROVED');
    }
  }
  if (!Array.isArray(databaseEntrypoint) || !databaseEntrypoint.length || databaseEntrypoint.some((part) => typeof part !== 'string' || !part || part.includes('\0'))) fail('DATABASE_ENTRYPOINT_UNPROVED');
  const executor = await readFile(path.join(HERE, 'recovery-database-backup.mjs'), 'utf8');
  const catalogSql = executor.match(/const CATALOG = `([\s\S]*?)`;/)?.[1];
  if (!catalogSql) fail('SOURCE_CATALOG_QUERY_UNAVAILABLE');
  return { source, counts, authReduction, pinned, catalogSql, databaseEntrypoint, databaseCommand };
}

async function execute(run, evidence, { bootstrapOnly = false } = {}) {
  const id = randomUUID();
  const network = `odonto-recovery-${id}`;
  const database = `${network}-db`;
  const helpers = [`${network}-auth-migrate`, `${network}-storage-migrate`];
  const password = randomBytes(32).toString('hex');
  const localJwtSecret = randomBytes(40).toString('hex');
  const resultFile = path.join(run, 'manifests', `database-restore-rehearsal-${id}.json`);
  const result = { timestamp: new Date().toISOString(), runId: id, mode: bootstrapOnly ? 'BOOTSTRAP_DIAGNOSTIC' : 'RESTORE_REHEARSAL', authBackupStrategy: 'REDUCED AUTH BACKUP', authRecovery: 'PARTIAL — EXPECTED', recoveryGap: 'sessions/tokens/MFA; user metadata and non-identity/provider metadata omitted', images: evidence.pinned, isolation: { network: 'internal', publishedPorts: 0, dataStorage: 'tmpfs', services: 'database and migration-only helpers', productionConnections: 0 }, stages: {}, cleanup: 'PENDING', verdict: 'FAIL' };
  const owned = new Set();
  let networkCreated = false;
  let databaseProcess;
  const psql = (input) => docker(['exec', '-i', '--user', 'postgres', database, 'psql', '-X', '-qAt', '--no-password', '-U', 'supabase_admin', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-f', '-'], input);
  const query = async (sql) => JSON.parse((await psql(sql)).trim());
  async function helper(name, image, script, env = []) {
    owned.add(name);
    await docker(['run', '--name', name, '--network', network, '--label', `${LABEL}=${id}`, '--log-driver', 'none', '--read-only', '--cap-drop=ALL', '--security-opt', 'no-new-privileges', '--tmpfs', '/tmp:rw,noexec,nosuid,size=128m', '-i', ...env.flatMap((v) => ['--env', v]), '--entrypoint', 'sh', image, '-ceu', script], `${password}\n${localJwtSecret}\n`);
  }
  try {
    result.stage = 'NETWORK_CREATION';
    await docker(['network', 'create', '--internal', '--label', `${LABEL}=${id}`, network]);
    networkCreated = true;
    owned.add(database);
    result.stage = 'DATABASE_START';
    // The secret crosses stdin only; it is absent from files, Docker Config.Env and argv.
    // Keep Docker attached so stdin reaches the entrypoint before PostgreSQL starts.
    databaseProcess = startDocker(['run', '-i', '--sig-proxy=false', '--name', database, '--network', network, '--label', `${LABEL}=${id}`, '--log-driver', 'none', '--tmpfs', '/var/lib/postgresql/data:rw,nosuid,size=3g', '--tmpfs', '/tmp:rw,nosuid,size=128m', '--entrypoint', 'sh', evidence.pinned.database, '-ceu', 'IFS= read -r POSTGRES_PASSWORD; export POSTGRES_PASSWORD; exec "$@"', 'recovery', ...evidence.databaseEntrypoint, ...evidence.databaseCommand, '-c', 'log_statement=none', '-c', 'log_min_error_statement=panic', '-c', 'logging_collector=off'], `${password}\n`, { discardOutput: true });
    let ready = false;
    result.stage = 'DATABASE_READINESS';
    for (let i = 0; i < 90; i++) {
      try {
        // The pinned image entrypoint starts initdb's temporary server with
        // listen_addresses=''. Loopback TCP becomes ready only on the final server.
        await docker(['exec', database, 'pg_isready', '-h', '127.0.0.1', '-p', '5432', '-U', 'supabase_admin', '-d', 'postgres']); ready = true; break;
      } catch { await new Promise((resolve) => setTimeout(resolve, 1000)); }
    }
    if (!ready) fail('LOCAL_DATABASE_NOT_READY');
    result.stage = 'LOCAL_ISOLATION';
    const isolated = JSON.parse(await docker(['inspect', database]));
    const internalNetwork = JSON.parse(await docker(['network', 'inspect', network]));
    if (Object.keys(isolated[0].NetworkSettings.Ports ?? {}).some((key) => isolated[0].NetworkSettings.Ports[key]?.length) || Object.keys(isolated[0].NetworkSettings.Networks ?? {}).some((name) => name !== network) || internalNetwork[0]?.Internal !== true || isolated[0].HostConfig.LogConfig.Type !== 'none' || !isolated[0].HostConfig.Tmpfs?.['/var/lib/postgresql/data'] || (isolated[0].Mounts ?? []).some((mount) => mount.Type === 'bind' || mount.Type === 'volume')) fail('LOCAL_ISOLATION_NOT_PROVED');
    const databaseSettings = await query(`SELECT json_build_object('dataDirectory',current_setting('data_directory'),'logStatement',current_setting('log_statement'),'logMinErrorStatement',current_setting('log_min_error_statement'),'loggingCollector',current_setting('logging_collector'));`);
    if (databaseSettings.dataDirectory !== '/var/lib/postgresql/data' || databaseSettings.logStatement !== 'none' || databaseSettings.logMinErrorStatement !== 'panic' || databaseSettings.loggingCollector !== 'off') fail('LOCAL_DATABASE_SETTINGS_NOT_PROVED');
    result.isolation.databaseSettingsVerified = true;
    result.isolation.readiness = 'LOOPBACK_TCP_FINAL_SERVER';
    result.stage = 'HELPER_CREDENTIALS';
    await psql(`ALTER ROLE supabase_auth_admin PASSWORD '${password}'; ALTER ROLE supabase_storage_admin PASSWORD '${password}';`);
    result.stage = 'AUTH_BOOTSTRAP';
    await helper(helpers[0], evidence.pinned.auth, `read -r local_password; read -r local_jwt; export GOTRUE_DB_DATABASE_URL="postgres://supabase_auth_admin:$local_password@${database}:5432/postgres"; export GOTRUE_JWT_SECRET="$local_jwt"; exec auth migrate`, ['GOTRUE_DB_DRIVER=postgres', 'GOTRUE_DB_NAMESPACE=auth', 'GOTRUE_SITE_URL=http://127.0.0.1', 'API_EXTERNAL_URL=http://127.0.0.1', 'GOTRUE_API_EXTERNAL_URL=http://127.0.0.1']);
    result.stage = 'STORAGE_BOOTSTRAP';
    await helper(helpers[1], evidence.pinned.storage, `read -r local_password; read -r local_jwt; export DATABASE_URL="postgres://supabase_storage_admin:$local_password@${database}:5432/postgres"; export AUTH_JWT_SECRET="$local_jwt"; exec node dist/scripts/migrate-call.js`, ['MULTI_TENANT=false', 'DB_INSTALL_ROLES=false', 'DB_SUPER_USER=supabase_admin', 'PG_QUEUE_ENABLE=false', 'STORAGE_BACKEND=file', 'FILE_STORAGE_BACKEND_PATH=/tmp/storage']);
    result.stage = 'MANAGED_VERSION_QUERY';
    const managed = await query(`SELECT json_build_object('authMax',(SELECT max(version) FROM auth.schema_migrations),'storageMax',(SELECT max(id) FROM storage.migrations));`);
    const migrationVersions = (value) => ({ authMax: /^\d{1,20}$/.test(value.authMax ?? '') ? value.authMax : 'UNKNOWN', storageMax: Number.isSafeInteger(value.storageMax) && value.storageMax >= 0 ? value.storageMax : 'UNKNOWN' });
    result.managedMigrationVersions = { expected: migrationVersions(evidence.source.managedMigrations), observed: migrationVersions(managed) };
    result.stages.managedSchemaBootstrap = 'PASS';
    if (bootstrapOnly) result.verdict = 'NOT_RUN';
    else {
    if (!same(managed, evidence.source.managedMigrations)) fail('MANAGED_SCHEMA_VERSION_MISMATCH');
    result.stages.managedSchemas = 'PASS';
    result.stage = 'RESTORE_SQL';
    // No app services run. Restore all three files in one transaction using Docker stdin.
    const restore = spawn('docker', ['exec', '-i', '--user', 'postgres', database, 'psql', '-X', '-q', '--single-transaction', '--no-password', '-U', 'supabase_admin', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-f', '-'], { shell: false, windowsHide: true, env: environment(), stdio: ['pipe', 'ignore', 'pipe'] });
    const diagnostics = [];
    restore.stderr.on('data', (b) => diagnostics.push(b));
    const restored = new Promise((resolve, reject) => { restore.on('error', () => reject(new Error('RESTORE_EXECUTOR_UNAVAILABLE'))); restore.on('close', (code) => code === 0 ? resolve() : reject(new Error(`RESTORE_SQL_EXIT_${code}_DIAGNOSTIC_SHA256_${digest(Buffer.concat(diagnostics))}`))); });
    restored.catch(() => {});
    restore.stdin.on('error', () => {});
    async function* sqlFiles() {
      for (const name of ['roles.sql', 'schema.sql', 'data.sql']) {
        yield* createReadStream(path.join(run, 'database', name));
        yield '\n';
      }
    }
    await pipeline(Readable.from(sqlFiles()), restore.stdin);
    await restored;
    result.stages.restore = 'PASS';
    for (const trigger of evidence.source.triggers.filter((t) => t.schema === 'auth')) await psql(`${BASELINE_TRIGGERS[trigger.name]};`);
    // Reconcile only local migration metadata after schema restoration; no migrations re-executed.
    await psql(`CREATE SCHEMA IF NOT EXISTS supabase_migrations; CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations(version text PRIMARY KEY); INSERT INTO supabase_migrations.schema_migrations(version) VALUES ${evidence.source.schemaMigrations.map((v) => `('${v}')`).join(',')} ON CONFLICT DO NOTHING;`);
    const actualCatalog = await query(evidence.catalogSql);
    for (const key of KEYS) {
      if (!same(actualCatalog[key], evidence.source[key])) fail(`RESTORE_CATALOG_MISMATCH_${key.toUpperCase()}`);
      result.stages[key] = 'PASS';
    }
    result.stages.schema = 'PASS';
    const expectedCounts = Object.entries(evidence.counts);
    const counts = await query(`SELECT json_build_object(${expectedCounts.flatMap(([table]) => [`'${table}'`, `(SELECT count(*) FROM ${table.split('.').map(identifier).join('.')})`]).join(',')});`);
    if (!same(counts, evidence.counts)) fail('RESTORE_CRITICAL_COUNTS_MISMATCH');
    result.stages.criticalCounts = 'PASS';
    result.stages.authIdentities = 'PASS';
    result.stages.storageMetadata = 'PASS';
    result.stages.rls = 'PASS';
    const emptyTables = evidence.authReduction.excludedAuthTables;
    for (const name of emptyTables) {
      if (name === 'schema_migrations') continue;
      const count = await query(`SELECT to_json(count(*)) FROM auth.${identifier(name)};`);
      if (count !== 0) fail('EXCLUDED_AUTH_DATA_PRESENT');
    }
    const tokenWhere = evidence.authReduction.scrubbedAuthUserColumns.map((name) => `coalesce(${identifier(name)},'') <> ''`).join(' OR ');
    if (await query(`SELECT to_json(count(*)) FROM auth.users WHERE ${tokenWhere};`) !== 0) fail('AUTH_TEMPORARY_TOKEN_DATA_PRESENT');
    if (await query(`SELECT to_json(count(*)) FROM auth.users WHERE raw_user_meta_data IS DISTINCT FROM '{}'::jsonb;`) !== 0) fail('AUTH_USER_METADATA_NOT_REDUCED');
    if (await query(`SELECT to_json(count(*)) FROM auth.users WHERE raw_app_meta_data IS NULL OR jsonb_typeof(raw_app_meta_data) <> 'object' OR EXISTS (SELECT FROM jsonb_each(CASE WHEN jsonb_typeof(raw_app_meta_data)='object' THEN raw_app_meta_data ELSE '{}'::jsonb END) item(k,v) WHERE NOT ((k='provider' AND jsonb_typeof(v)='string' AND v #>> '{}' ~ '^[a-z][a-z0-9_-]{0,63}$') OR (k='providers' AND jsonb_typeof(v)='array' AND NOT EXISTS (SELECT FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v)='array' THEN v ELSE '[]'::jsonb END) p(value) WHERE jsonb_typeof(p.value)<>'string' OR p.value #>> '{}' !~ '^[a-z][a-z0-9_-]{0,63}$'))));`) !== 0) fail('AUTH_APP_METADATA_NOT_REDUCED');
    if (await query(`SELECT to_json(count(*)) FROM auth.identities WHERE identity_data IS NULL OR jsonb_typeof(identity_data)<>'object' OR EXISTS (SELECT FROM jsonb_each(CASE WHEN jsonb_typeof(identity_data)='object' THEN identity_data ELSE '{}'::jsonb END) item(k,v) WHERE NOT ((k IN ('sub','email','phone','provider_id') AND jsonb_typeof(v)='string') OR (k IN ('email_verified','phone_verified') AND jsonb_typeof(v)='boolean')));`) !== 0) fail('AUTH_IDENTITY_METADATA_NOT_REDUCED');
    result.stages.auth = 'PASS_WITH_DOCUMENTED_RECOVERY_GAP';
    result.stages.reducedAuthGap = 'EXPECTED';
    const fks = await query(`SELECT coalesce(json_agg(json_build_object('schema',ns.nspname,'table',c.relname,'parentSchema',np.nspname,'parent',p.relname,'match',k.confmatchtype,'keys',(SELECT json_agg(json_build_object('child',a.attname,'parent',b.attname) ORDER BY x.i) FROM generate_subscripts(k.conkey,1) x(i) JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=k.conkey[x.i] JOIN pg_attribute b ON b.attrelid=p.oid AND b.attnum=k.confkey[x.i])) ORDER BY ns.nspname,c.relname,k.conname),'[]'::json) FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace ns ON ns.oid=c.relnamespace JOIN pg_class p ON p.oid=k.confrelid JOIN pg_namespace np ON np.oid=p.relnamespace WHERE k.contype='f' AND ns.nspname IN ('public','auth','storage');`);
    for (const fk of fks) {
      const required = fk.keys.map((k) => `c.${identifier(k.child)} IS NOT NULL`).join(' AND ');
      const equality = fk.keys.map((k) => `c.${identifier(k.child)} = p.${identifier(k.parent)}`).join(' AND ');
      const partialNull = fk.match === 'f' ? ` OR ((${fk.keys.map((k) => `c.${identifier(k.child)} IS NULL`).join(' OR ')}) AND (${fk.keys.map((k) => `c.${identifier(k.child)} IS NOT NULL`).join(' OR ')}))` : '';
      if (await query(`SELECT to_json(count(*)) FROM ${identifier(fk.schema)}.${identifier(fk.table)} c WHERE ((${required}) AND NOT EXISTS (SELECT FROM ${identifier(fk.parentSchema)}.${identifier(fk.parent)} p WHERE ${equality}))${partialNull};`) !== 0) fail('RESTORE_FOREIGN_KEY_ORPHANS');
    }
    result.stages.foreignKeys = 'PASS';
    result.verdict = 'PASS';
    }
  } catch (error) {
    result.failure = sanitizedError(error);
    result.failureStage = result.stage;
  } finally {
    const cleanupErrors = [];
    for (const name of [...owned].reverse()) {
      try {
        const inspected = JSON.parse(await docker(['inspect', name]));
        if (inspected[0]?.Config?.Labels?.[LABEL] !== id || inspected[0]?.Name !== `/${name}`) fail('RESOURCE_OWNERSHIP_MISMATCH');
        await docker(['rm', '-f', '-v', name]);
      } catch { cleanupErrors.push('OWNED_CONTAINER_CLEANUP_UNPROVED'); }
    }
    if (networkCreated) {
      try {
        const inspected = JSON.parse(await docker(['network', 'inspect', network]));
        if (inspected[0]?.Labels?.[LABEL] !== id || inspected[0]?.Name !== network) fail('NETWORK_OWNERSHIP_MISMATCH');
        await docker(['network', 'rm', network]);
      } catch { cleanupErrors.push('OWNED_NETWORK_CLEANUP_UNPROVED'); }
    }
    if (databaseProcess && !cleanupErrors.length) await databaseProcess.done.catch(() => {});
    else if (databaseProcess) {
      // Stop only this attached CLI if ownership cleanup could not be proved.
      // --sig-proxy=false prevents signalling a container of uncertain ownership.
      databaseProcess.child.kill();
      await databaseProcess.done.catch(() => {});
    }
    result.cleanup = cleanupErrors.length ? 'FAIL' : 'PASS';
    if (cleanupErrors.length) { result.verdict = 'FAIL'; result.cleanupErrors = cleanupErrors; }
    await writeFile(resultFile, JSON.stringify(result, null, 2), { flag: 'wx', mode: 0o600 });
  }
  console.log(JSON.stringify({ databaseRestoreRehearsal: result.verdict, cleanup: result.cleanup, stages: result.stages, failure: result.failure ?? null, failureStage: result.failureStage, managedMigrationVersions: result.managedMigrationVersions, runId: id }));
  if (result.verdict === 'FAIL') process.exitCode = 1;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || same(args, ['--plan'])) {
    console.log(JSON.stringify({ mode: 'PLAN_ONLY', images: IMAGES, isolation: 'unique internal network; no published ports; tmpfs PGDATA; no app/Auth/email servers', order: ['managed-schema migration-only bootstrap', 'roles.sql', 'schema.sql', 'data.sql', 'baseline Auth triggers', 'catalog/count/Auth/FK validation', 'destroy owned resources'], prerequisite: 'private-run evidence, database hashes, same-snapshot source catalogs/counts, independent review before execute' }));
    return;
  }
  if (![3, 4].includes(args.length) || args[0] !== '--run' || args[2] !== '--execute' || (args.length === 4 && args[3] !== '--bootstrap-only')) fail('USAGE_RUN_ABSOLUTE_PATH_EXECUTE');
  const run = path.resolve(args[1]);
  const evidence = await preflight(run);
  await execute(run, evidence, { bootstrapOnly: args.includes('--bootstrap-only') });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(/^[A-Z0-9_]+$/.test(error.message) ? error.message : 'RESTORE_PREFLIGHT_FAILED'); process.exitCode = 1; });
