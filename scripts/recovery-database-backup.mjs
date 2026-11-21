/** Recovery executor. No dotenv loading, shell interpolation, remote writes or raw diagnostics. */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { readFile, writeFile, stat, realpath, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCES = path.join(HERE, 'recovery');
const PROD = 'sqouddqzpmkofenyufuj';
const QA = 'zxvpyxvhymuibaxgxetf';
const DR = 'qprzxkolbbnqfopamfhj';
const IMAGE = 'postgres:17-bookworm';
const DIGEST = 'sha256:3645570cccdfa447589da9f57dd740faa29b30938e861289a5574b6ca6b03826';
const CA = 'C:\\Users\\ppedr\\supabase-certs\\prod-ca-2021.crt';
const STRATEGY = 'REDUCED AUTH BACKUP';
const GAP = 'Sessions, refresh tokens, temporary links, MFA/TOTP challenges and WebAuthn are excluded; users must authenticate again and enroll MFA. User metadata and non-identity/provider metadata are omitted to prevent embedded tokens. Auth recovery is partial, as expected.';
const TOKEN_COLUMNS = new Set(['confirmation_token', 'recovery_token', 'email_change_token_new', 'email_change_token_current', 'phone_change_token', 'reauthentication_token']);
const FIELDS = ['PGHOST', 'PGPORT', 'PGUSER', 'PGPASSWORD', 'PGDATABASE', 'EXCLUDED_SCHEMAS', 'INCLUDED_SCHEMAS', 'RESERVED_ROLES', 'ALLOWED_CONFIGS', 'EXTRA_FLAGS', 'EXTRA_SED'];
const WRAPPER = `set -euo pipefail
umask 077
for name in ${FIELDS.join(' ')}; do
  IFS= read -r -d '' value || exit 90
  printf -v "$name" '%s' "$value"
  export "$name"
done
unset value name
exec "$@"`;
let stage = 'INITIALIZATION';

function fail(code) { throw new Error(code); }
function sha(value) { return createHash('sha256').update(value).digest('hex'); }
function parseCredential(raw = process.env.PRODUCTION_DB_URL) {
  if (!raw) fail('ACTION_REQUIRED: PRODUCTION_DB_URL');
  let u;
  try { u = new URL(raw); } catch { fail('INVALID_PRODUCTION_CREDENTIAL'); }
  if (!['postgres:', 'postgresql:'].includes(u.protocol)) fail('INVALID_DATABASE_PROTOCOL');
  const host = u.hostname.toLowerCase();
  const user = decodeURIComponent(u.username);
  const pooled = /^[a-z0-9-]+\.pooler\.supabase\.com$/.test(host) && user === `postgres.${PROD}`;
  if (!pooled || (u.port || '5432') !== '5432' || raw.includes(QA) || raw.includes(DR)) fail('PRODUCTION_SESSION_POOLER_TARGET_MISMATCH');
  if (decodeURIComponent(u.pathname) !== '/postgres' || u.hash) fail('DATABASE_TARGET_MISMATCH');
  for (const key of u.searchParams.keys()) {
    if (!['sslmode', 'sslrootcert', 'connect_timeout'].includes(key)) fail('UNSUPPORTED_CONNECTION_OPTION');
  }
  // URL TLS options are not forwarded: executor always forces verify-full and the reviewed CA.
  const password = decodeURIComponent(u.password);
  if (!password || [host, user, password].some((v) => v.includes('\0'))) fail('INVALID_CREDENTIAL_COMPONENT');
  return { PGHOST: host, PGPORT: u.port || '5432', PGUSER: user, PGPASSWORD: password, PGDATABASE: 'postgres' };
}

function childEnvironment() {
  // Docker receives no application/database/service credentials through its host environment.
  const allowed = ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATHEXT', 'USERPROFILE', 'HOME', 'TEMP', 'TMP', 'APPDATA', 'LOCALAPPDATA', 'DOCKER_CONFIG'];
  return Object.fromEntries(allowed.filter((k) => process.env[k]).map((k) => [k, process.env[k]]));
}

function docker(args, values = null, { stream = false, requireEmptyStderr = false } = {}) {
  const child = spawn('docker', args, { shell: false, windowsHide: true, env: childEnvironment(), stdio: ['pipe', 'pipe', 'pipe'] });
  const output = [];
  const errors = [];
  child.stdout.on('data', (b) => { if (!stream) output.push(b); });
  child.stderr.on('data', (b) => errors.push(b));
  const done = new Promise((resolve, reject) => {
    child.on('error', () => reject(new Error('DOCKER_EXECUTOR_UNAVAILABLE')));
    child.on('close', (code) => {
      const error = Buffer.concat(errors);
      if (code !== 0 || (requireEmptyStderr && error.length)) {
        const diagnostic = error.toString('utf8');
        const category = /certificate|ssl|tls/i.test(diagnostic) ? 'TLS' : /password authentication failed/i.test(diagnostic) ? 'AUTHENTICATION' : /timeout|could not connect|network is unreachable/i.test(diagnostic) ? 'CONNECTIVITY' : /permission denied/i.test(diagnostic) ? 'PERMISSION' : 'OTHER';
        reject(new Error(`DOCKER_OPERATION_FAILED_EXIT_${code}_CLASS_${category}_STDERR_SHA256_${sha(error)}`));
      }
      else resolve(Buffer.concat(output).toString('utf8'));
    });
  });
  child.stdin.on('error', () => {});
  if (values) child.stdin.write(Buffer.from(FIELDS.map((k) => values[k] || '').join('\0') + '\0', 'utf8'));
  return { child, done };
}

function connection(run, values, command, options = {}) {
  const args = ['run', '--rm', '--pull=never', '-i', '--log-driver=none', '--read-only', '--cap-drop=ALL', '--security-opt', 'no-new-privileges', '--tmpfs', '/tmp:rw,noexec,nosuid,size=64m', '--env', 'LC_ALL=C',
    '--env', 'PGSSLMODE=verify-full', '--env', 'PGSSLROOTCERT=/certs/prod-ca-2021.crt',
    '--env', 'PGOPTIONS=-c default_transaction_read_only=on', '--env', 'PGCONNECT_TIMEOUT=20',
    '--mount', `type=bind,source=${CA},target=/certs/prod-ca-2021.crt,readonly`,
    '--mount', `type=bind,source=${SOURCES},target=/official,readonly`];
  if (options.backup) args.push('--mount', `type=bind,source=${path.join(run, 'database')},target=/backup`);
  args.push(`${IMAGE}@${DIGEST}`, 'bash', '-c', WRAPPER, 'recovery', ...command);
  return docker(args, values, { ...options, requireEmptyStderr: true });
}

async function query(run, values, sql, { probe = false } = {}) {
  const op = connection(run, values, probe ? ['bash', '-c', PROBE_INSIDE] : ['psql', '-X', '-qAt', '--no-password', '-v', 'ON_ERROR_STOP=1']);
  op.child.stdin.end(sql + '\n');
  const value = (await op.done).trim();
  try {
    if (!probe) return JSON.parse(value);
    const lines = value.split(/\r?\n/);
    if (lines.length !== 2 || lines[0] !== 'CLIENT_TLS=true') fail('CLIENT_TLS_VERIFY_FULL_FAILED');
    return { ...JSON.parse(lines[1]), clientTls: true };
  } catch (error) { if (error.message === 'CLIENT_TLS_VERIFY_FULL_FAILED') throw error; fail('INVALID_SANITIZED_QUERY_RESPONSE'); }
}

async function snapshot(run, values) {
  const op = connection(run, values, ['psql', '-X', '-qAt', '--no-password', '-v', 'ON_ERROR_STOP=1'], { stream: true });
  let line = '';
  const ready = new Promise((resolve, reject) => {
    op.child.stdout.on('data', (b) => {
      line += b.toString('utf8');
      if (line.includes('\n')) {
        const token = line.trim();
        if (!/^[0-9A-F]+-[0-9A-F]+-[0-9]+$/i.test(token)) reject(new Error('INVALID_SNAPSHOT_RESPONSE'));
        else resolve(token);
      }
    });
    op.done.catch(reject);
  });
  op.child.stdin.write('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SELECT pg_export_snapshot();\n');
  const token = await ready;
  return { token, close: async () => { op.child.stdin.end('ROLLBACK;\n'); await op.done; } };
}

async function sourceConfig() {
  const provenance = JSON.parse((await readFile(path.join(SOURCES, 'source-provenance.json'), 'utf8')).replace(/^\uFEFF/, ''));
  if (provenance.commit !== '997a1e69a4a83466964ed874d3a604c88a7b3866') fail('OFFICIAL_SOURCE_COMMIT_MISMATCH');
  if (provenance.files?.length !== 4 || new Set(provenance.files.map((f) => f.filename)).size !== 4) fail('OFFICIAL_SOURCE_FILE_SET_MISMATCH');
  for (const file of provenance.files) {
    if (!['dump_data.sh','dump_schema.sh','dump_role.sh','legacy-pg-dump.env.ts.txt'].includes(file.filename) || sha(await readFile(path.join(SOURCES,file.filename))) !== file.sha256) fail('OFFICIAL_SOURCE_HASH_MISMATCH');
  }
  const source = await readFile(path.join(SOURCES, 'legacy-pg-dump.env.ts.txt'), 'utf8');
  const result = {};
  for (const [key, exported] of Object.entries({ schema: 'LEGACY_INTERNAL_SCHEMAS', data: 'LEGACY_EXCLUDED_SCHEMAS', roles: 'LEGACY_RESERVED_ROLES', configs: 'LEGACY_ALLOWED_CONFIGS' })) {
    const body = source.match(new RegExp(`export const ${exported}: ReadonlyArray<string> = \\[([\\s\\S]*?)\\];`))?.[1];
    if (!body) fail('OFFICIAL_CONFIGURATION_UNAVAILABLE');
    result[key] = [...body.replace(/\/\/[^\n]*/g, '').matchAll(/"([^"]+)"/g)].map((m) => m[1]).join('|');
  }
  return result;
}

async function assertLocalDocker() {
  const op = docker(['context', 'inspect']);
  op.child.stdin.end();
  let context;
  try { context = JSON.parse(await op.done); } catch { fail('DOCKER_CONTEXT_UNVERIFIED'); }
  const endpoint = context?.[0]?.Endpoints?.docker?.Host;
  if (!/^npipe:\/\/\/\/\.\/pipe\/[a-zA-Z0-9_-]+$/.test(endpoint || '')) fail('DOCKER_CONTEXT_NOT_LOCAL');
}

const AUTH_JSON_POLICY = {
  users: { raw_user_meta_data: [], raw_app_meta_data: ['provider', 'providers'] },
  identities: { identity_data: ['sub', 'email', 'phone', 'provider_id', 'email_verified', 'phone_verified'] },
};
function metadataProjection(column, table) {
  const name = `"${column.name}"`;
  if (table === 'users' && column.name === 'raw_user_meta_data') return `'{}'::jsonb AS ${name}`;
  if (table === 'users' && column.name === 'raw_app_meta_data') return `(SELECT coalesce(jsonb_object_agg(k,v), '{}'::jsonb) FROM jsonb_each(CASE WHEN jsonb_typeof(${name})='object' THEN ${name} ELSE '{}'::jsonb END) AS item(k,v) WHERE (k='provider' AND jsonb_typeof(v)='string' AND v #>> '{}' ~ '^[a-z][a-z0-9_-]{0,63}$') OR (k='providers' AND jsonb_typeof(v)='array' AND NOT EXISTS (SELECT FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v)='array' THEN v ELSE '[]'::jsonb END) AS p(value) WHERE jsonb_typeof(p.value)<>'string' OR p.value #>> '{}' !~ '^[a-z][a-z0-9_-]{0,63}$'))) AS ${name}`;
  if (table === 'identities' && column.name === 'identity_data') return `(SELECT coalesce(jsonb_object_agg(k,v), '{}'::jsonb) FROM jsonb_each(CASE WHEN jsonb_typeof(${name})='object' THEN ${name} ELSE '{}'::jsonb END) AS item(k,v) WHERE (k IN ('sub','email','phone','provider_id') AND jsonb_typeof(v)='string') OR (k IN ('email_verified','phone_verified') AND jsonb_typeof(v)='boolean')) AS ${name}`;
  fail('ACTION_REQUIRED: AUTH_BACKUP_STRATEGY');
}

function authProjection(columns, table = 'users') {
  if (!Array.isArray(columns) || !columns.length) fail('AUTH_COLUMNS_MISSING');
  if (!Object.hasOwn(AUTH_JSON_POLICY, table)) fail('ACTION_REQUIRED: AUTH_BACKUP_STRATEGY');
  const scrubbed = [];
  for (const column of columns) if (!['ALWAYS','NEVER'].includes(column.generated)) fail('UNREVIEWED_AUTH_GENERATED_COLUMN_METADATA');
  const insertable = columns.filter((column) => column.generated === 'NEVER');
  const projected = insertable.map((column) => {
    if (!/^[a-z_][a-z0-9_]*$/.test(column.name)) fail('UNSUPPORTED_AUTH_COLUMN');
    if (['json','jsonb'].includes(column.type)) {
      if (column.type !== 'jsonb' || !Object.hasOwn(AUTH_JSON_POLICY[table], column.name)) fail('ACTION_REQUIRED: AUTH_BACKUP_STRATEGY');
      return metadataProjection(column, table);
    }
    if (/(?:token|secret|nonce|challenge|code)/i.test(column.name)) {
      if (table !== 'users' || !TOKEN_COLUMNS.has(column.name) || !['text','character varying'].includes(column.type)) fail('ACTION_REQUIRED: AUTH_BACKUP_STRATEGY');
      scrubbed.push(column.name);
      return `''::${column.type} AS "${column.name}"`;
    }
    return `"${column.name}"`;
  });
  return { projected: projected.join(','), columns: insertable.map((c) => `"${c.name}"`).join(','), scrubbed, jsonPolicy:AUTH_JSON_POLICY[table] };
}

async function appendReducedAuth(run, values, token, projection, table) {
  const command = 'set -euo pipefail; printf \'\\nSET session_replication_role = replica;\\nCOPY "auth"."%s" (%s) FROM stdin;\\n\' "$1" "$2" >> /backup/data.sql; psql -X -qAt --no-password -v ON_ERROR_STOP=1 >> /backup/data.sql; printf \'\\\\.\\nRESET ALL;\\n\' >> /backup/data.sql';
  const op = connection(run, values, ['bash','-c',command,'auth-projection',table,projection.columns], { backup:true });
  op.child.stdin.end(snapshotSql(token, `COPY (SELECT ${projection.projected} FROM auth."${table}") TO STDOUT;`) + '\n');
  await op.done;
}

const PROBE = `\\conninfo
BEGIN READ ONLY;
SELECT '__PROBE_JSON__' || json_build_object('database', current_database(), 'server', regexp_replace(current_setting('server_version'), '[^0-9.].*$', ''),
 'tls', (SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()),
 'readOnly', current_setting('transaction_read_only'),
 'migrations', (SELECT json_agg(CASE WHEN version ~ '^[0-9]{4}$' THEN version ELSE 'INVALID' END ORDER BY version) FROM supabase_migrations.schema_migrations))::text;
ROLLBACK;`;

// Conninfo may include host/user; it stays only in container memory. Only TLS boolean and marked JSON leave it.
const PROBE_INSIDE = `set -euo pipefail
if output=$(psql -X -qAt --no-password -v ON_ERROR_STOP=1); then
  printf '%s\\n' "$output" | awk '
    /^SSL connection \\(/ { tls = 1 }
    /^__PROBE_JSON__/ { sub(/^__PROBE_JSON__/, ""); result = $0; count++ }
    END { if (count != 1) exit 61; print "CLIENT_TLS=" (tls ? "true" : "false"); print result }'
else exit 60; fi`;

function validateProbe(probe, localVersions) {
  const expected = Array.from({ length:31 }, (_,i) => String(i+1).padStart(4,'0'));
  if (probe.database !== 'postgres' || probe.server !== '17.6' || probe.clientTls !== true || probe.readOnly !== 'on') fail('PRODUCTION_PROBE_MISMATCH');
  // pg_stat_ssl is endpoint->backend, distinct from libpq->endpoint TLS at the approved session pooler.
  if (![true,false].includes(probe.tls)) fail('BACKEND_TLS_EVIDENCE_MISSING');
  if (JSON.stringify(probe.migrations) !== JSON.stringify(expected)) fail('MIGRATION_STATE_MISMATCH');
  if (JSON.stringify(localVersions.filter((v) => !expected.includes(v))) !== JSON.stringify(['0032','0033']) || !expected.every((v) => localVersions.includes(v))) fail('PENDING_MIGRATION_STATE_MISMATCH');
}

const AUTH_TRIGGER_BINDING_SQL = `BEGIN READ ONLY;
SELECT json_build_object(
 'totalUserTriggers',(SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='auth' AND c.relname='users' AND NOT t.tgisinternal),
 'triggers',(SELECT json_agg(json_build_object('schema',n.nspname,'table',c.relname,'name',t.tgname,'definition',pg_get_triggerdef(t.oid),'enabled',t.tgenabled,'functionSchema',np.nspname,'functionName',p.proname,'functionArgs',pg_get_function_identity_arguments(p.oid),'functionDefinitionHash',md5(pg_get_functiondef(p.oid))) ORDER BY t.tgname) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace np ON np.oid=p.pronamespace WHERE n.nspname='auth' AND c.relname='users' AND NOT t.tgisinternal AND t.tgname IN ('on_auth_user_created','on_auth_user_email_updated')));
ROLLBACK;`;

function validateAuthTriggerBindings(source,current) {
  const functions={on_auth_user_created:'handle_new_auth_user',on_auth_user_email_updated:'sync_auth_user_email'};
  if (current?.totalUserTriggers!==2 || !Array.isArray(current.triggers) || current.triggers.length!==2 || new Set(current.triggers.map((t)=>t.name)).size!==2) fail('AUTH_TRIGGER_BINDING_MISMATCH');
  const sourceTriggers=source.triggers.filter((t)=>t.schema==='auth');
  if (sourceTriggers.length!==2) fail('AUTH_TRIGGER_BINDING_MISMATCH');
  for (const trigger of current.triggers) {
    const expected=sourceTriggers.find((t)=>t.name===trigger.name);
    const sourceFunctions=source.functions.filter((f)=>f.name===functions[trigger.name] && f.args==='');
    const event=trigger.name==='on_auth_user_created'?'INSERT':'UPDATE OF email';
    const template=new RegExp(`^CREATE TRIGGER ${trigger.name} AFTER ${event} ON auth[.]users FOR EACH ROW EXECUTE FUNCTION (public[.])?${functions[trigger.name]}\\(\\)$`);
    if (!expected || sourceFunctions.length!==1 || trigger.schema!=='auth' || trigger.table!=='users' || trigger.enabled!=='O' || expected.enabled!==trigger.enabled || expected.table!==trigger.table || expected.definition!==trigger.definition || !template.test(trigger.definition) || trigger.functionSchema!=='public' || trigger.functionName!==functions[trigger.name] || trigger.functionArgs!=='' || !/^[a-f0-9]{32}$/.test(trigger.functionDefinitionHash) || sourceFunctions[0].definitionHash!==trigger.functionDefinitionHash) fail('AUTH_TRIGGER_BINDING_MISMATCH');
  }
  return current.triggers;
}

function snapshotSql(token, body) { return `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET TRANSACTION SNAPSHOT '${token}'; ${body} ROLLBACK;`; }

const CATALOG = `SELECT json_build_object(
 'managedSecurity', json_build_object(
   'tables', (SELECT coalesce(json_agg(json_build_object('schema',n.nspname,'name',c.relname,'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,'acl',c.relacl::text) ORDER BY n.nspname,c.relname),'[]'::json) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('auth','storage') AND c.relkind IN ('r','p')),
   'policies', (SELECT coalesce(json_agg(json_build_object('schema',schemaname,'table',tablename,'name',policyname,'roles',roles,'command',cmd,'permissive',permissive,'usingHash',md5(coalesce(qual,'')),'checkHash',md5(coalesce(with_check,''))) ORDER BY schemaname,tablename,policyname),'[]'::json) FROM pg_policies WHERE schemaname IN ('auth','storage')),
   'tableGrants', (SELECT coalesce(json_agg(json_build_object('schema',table_schema,'table',table_name,'grantee',grantee,'privilege',privilege_type,'grantable',is_grantable) ORDER BY table_schema,table_name,grantee,privilege_type),'[]'::json) FROM information_schema.role_table_grants WHERE table_schema IN ('auth','storage')),
   'schemaGrants', (SELECT json_agg(json_build_object('schema',nspname,'acl',nspacl::text) ORDER BY nspname) FROM pg_namespace WHERE nspname IN ('auth','storage')),
   'functionGrants', (SELECT coalesce(json_agg(json_build_object('schema',n.nspname,'name',p.proname,'args',pg_get_function_identity_arguments(p.oid),'acl',p.proacl::text) ORDER BY n.nspname,p.proname,p.oid),'[]'::json) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('auth','storage') AND p.prokind='f')),
 'unsafeRoleConfigCount', (SELECT count(*) FROM pg_db_role_setting s CROSS JOIN LATERAL unnest(s.setconfig) AS x(setting) WHERE s.setdatabase=0 AND EXISTS(SELECT FROM pg_roles r WHERE r.oid=s.setrole AND r.rolname !~ '^pg_') AND (strpos(setting,chr(10))>0 OR strpos(setting,chr(13))>0 OR split_part(setting,'=',1) ~* '(password|token|secret|jwt|credential|claims|headers|conninfo|dsn|uri|url|private_key)' OR setting ~* '(postgres(ql)?://|Bearer[[:space:]]|eyJ[A-Za-z0-9_-]+[.][A-Za-z0-9_-]+[.][A-Za-z0-9_-]+)' OR (position('.' in split_part(setting,'=',1))>0 AND split_part(setting,'=',1) !~ '^(pgaudit[.].+|pgrst[.](db_schemas|db_extra_search_path|db_pre_request|db_anon_role|db_plan_enabled|db_tx_end|db_prepared_statements|db_pool|db_pool_size|db_config|db_channel|db_channel_enabled|max_rows|server_timing_enabled))$'))),
 'foreignObjectCount', (SELECT count(*) FROM pg_foreign_server),
 'dataTables', (SELECT coalesce(json_agg(json_build_object('schema',n.nspname,'name',c.relname) ORDER BY n.nspname,c.relname),'[]'::json) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','p') AND n.nspname <> 'information_schema' AND n.nspname !~ '^pg_'),
 'publicTables', (SELECT coalesce(json_agg(json_build_object('schema','public','name',c.relname,'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,'columns',(SELECT json_agg(json_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,'defaultHash',md5(pg_get_expr(d.adbin,d.adrelid))) ORDER BY a.attnum) FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped)) ORDER BY c.relname),'[]'::json) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p')),
 'functions', (SELECT coalesce(json_agg(json_build_object('name',p.proname,'args',pg_get_function_identity_arguments(p.oid),'definitionHash',md5(pg_get_functiondef(p.oid)),'acl',p.proacl::text) ORDER BY p.proname, p.oid),'[]'::json) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind='f'),
 'triggers', (SELECT coalesce(json_agg(json_build_object('schema',n.nspname,'table',c.relname,'name',t.tgname,'definition',pg_get_triggerdef(t.oid),'enabled',t.tgenabled) ORDER BY n.nspname,c.relname,t.tgname),'[]'::json) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE NOT t.tgisinternal AND (n.nspname='public' OR (n.nspname='auth' AND c.relname='users' AND t.tgname IN ('on_auth_user_created','on_auth_user_email_updated')))),
 'policies', (SELECT coalesce(json_agg(json_build_object('table',tablename,'name',policyname,'roles',roles,'command',cmd,'permissive',permissive,'usingHash',md5(coalesce(qual,'')),'checkHash',md5(coalesce(with_check,''))) ORDER BY tablename,policyname),'[]'::json) FROM pg_policies WHERE schemaname='public'),
 'tableGrants', (SELECT coalesce(json_agg(json_build_object('table',table_name,'grantee',grantee,'privilege',privilege_type,'grantable',is_grantable) ORDER BY table_name,grantee,privilege_type),'[]'::json) FROM information_schema.role_table_grants WHERE table_schema='public'),
 'constraints', (SELECT coalesce(json_agg(json_build_object('table',c.relname,'name',k.conname,'definition',pg_get_constraintdef(k.oid),'validated',k.convalidated) ORDER BY c.relname,k.conname),'[]'::json) FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'),
 'indexes', (SELECT coalesce(json_agg(json_build_object('table',tablename,'name',indexname,'definition',indexdef) ORDER BY tablename,indexname),'[]'::json) FROM pg_indexes WHERE schemaname='public'),
 'sequences', (SELECT coalesce(json_agg(json_build_object('name',sequencename,'type',data_type::text,'start',start_value,'min',min_value,'max',max_value,'increment',increment_by,'cycle',cycle,'cache',cache_size) ORDER BY sequencename),'[]'::json) FROM pg_sequences WHERE schemaname='public'),
 'authTables', (SELECT json_agg(c.relname ORDER BY c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='auth' AND c.relkind IN ('r','p')),
 'authUserColumns', (SELECT json_agg(json_build_object('name',column_name,'type',data_type,'nullable',is_nullable,'generated',is_generated,'generationExpression',generation_expression) ORDER BY ordinal_position) FROM information_schema.columns WHERE table_schema='auth' AND table_name='users'),
 'authIdentityColumns', (SELECT json_agg(json_build_object('name',column_name,'type',data_type,'nullable',is_nullable,'generated',is_generated,'generationExpression',generation_expression) ORDER BY ordinal_position) FROM information_schema.columns WHERE table_schema='auth' AND table_name='identities'),
 'extensions', (SELECT json_agg(json_build_object('name',extname,'version',extversion,'schema',n.nspname) ORDER BY extname) FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace),
 'managedMigrations', json_build_object('authMax',(SELECT max(version) FROM auth.schema_migrations),'storageMax',(SELECT max(id) FROM storage.migrations)),
 'schemaMigrations', (SELECT json_agg(version ORDER BY version) FROM supabase_migrations.schema_migrations)
);`;

async function validateRun(run) {
  if (!run || !path.isAbsolute(run)) fail('ABSOLUTE_SECURE_RUN_REQUIRED');
  const resolved = await realpath(run);
  if (resolved !== path.resolve(run) || /onedrive/i.test(resolved)) fail('UNSAFE_BACKUP_LOCATION');
  const protection = JSON.parse((await readFile(path.join(run, 'manifests', 'local-protection.json'), 'utf8')).replace(/^\uFEFF/, ''));
  if (!protection.outsideOneDrive || protection.run?.path !== run || !protection.run?.inheritanceProtected || protection.run?.untrustedMutationAllowed !== false || protection.root?.untrustedMutationAllowed !== false || protection.parent?.untrustedMutationAllowed !== false) fail('ACL_EVIDENCE_REQUIRED');
  if (!/^PASS\b/.test(protection.bitlocker || '')) fail('BITLOCKER_CHECKPOINT_REQUIRED');
  if (!existsSync(CA)) fail('CA_ABSENT');
  return resolved;
}

async function verifyLocalProtection(run) {
  const child = spawn('powershell.exe', ['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(SOURCES,'verify-local-protection.ps1'),'-Run',run], { shell:false, windowsHide:true, env:childEnvironment(), stdio:['ignore','pipe','pipe'] });
  const chunks = [];
  child.stdout.on('data', (chunk) => chunks.push(chunk));
  child.stderr.on('data', () => {});
  const code = await new Promise((resolve,reject) => { child.on('error', () => reject(new Error('LOCAL_PROTECTION_CHECK_UNAVAILABLE'))); child.on('close',resolve); });
  if (code !== 0) fail('LOCAL_PROTECTION_CHECK_FAILED');
  let evidence;
  try { evidence=JSON.parse(Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/,'')); } catch { fail('LOCAL_PROTECTION_CHECK_INVALID'); }
  if (!['parentAcl','backupAcl','outsideOneDrive','reparsePoints','bitlocker'].every((key) => evidence[key]==='PASS') || !['FRESH_PASS','CHECKPOINT_PASS'].includes(evidence.bitlockerEvidence)) fail('LOCAL_PROTECTION_CHECK_FAILED');
  return evidence;
}

function extraDataTables(catalog, config) {
  const excluded = config.data.split('|').map((value) => new RegExp(`^${value.replaceAll('.', '\\.').replaceAll('*','.*')}$`));
  return catalog.dataTables.filter(({schema,name}) => !excluded.some((pattern)=>pattern.test(schema)) && schema !== 'public' && schema !== 'auth' && !(schema==='storage' && ['buckets','objects','migrations'].includes(name)) && !(schema==='supabase_functions' && name==='migrations'));
}

async function validateSqlStructure(file, name) {
  // No data payload is printed. Full SQL parse/constraints are validated by the required restore gate.
  const size=(await stat(file)).size;
  if (!size) fail('EMPTY_DATABASE_BACKUP');
  const text=await readFile(file,'utf8');
  if (!/;\s*$/.test(text) || text.includes('\0') || (name !== 'schema.sql' && !/RESET ALL;\s*$/.test(text))) fail('DATABASE_SQL_STRUCTURE_INVALID');
  if (name==='schema.sql' && !/CREATE (?:TABLE|FUNCTION|SCHEMA|TYPE)/.test(text)) fail('DATABASE_SCHEMA_STRUCTURE_INVALID');
  if (name==='data.sql' && (!/SET session_replication_role = replica;/.test(text) || !/COPY "auth"\."users"/.test(text) || !/COPY "auth"\."identities"/.test(text))) fail('DATABASE_AUTH_STRUCTURE_INVALID');
  return size;
}

async function hashFile(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some((v) => !['--run', '--probe-only', '--backup', '--diagnose-surfaces', '--diagnose-auth-bindings'].includes(v) && v !== args[args.indexOf('--run') + 1])) fail('INVALID_ARGUMENT');
  stage = 'CREDENTIAL_VALIDATION';
  console.log(`PRODUCTION_DB_URL: ${process.env.PRODUCTION_DB_URL ? 'PRESENT' : 'ABSENT'}`);
  const values = parseCredential();
  if (process.env.PGSSLMODE !== 'verify-full' || !process.env.PGSSLROOTCERT || path.resolve(process.env.PGSSLROOTCERT)!==path.resolve(CA) || !process.env.NODE_EXTRA_CA_CERTS) fail('TLS_ENVIRONMENT_CHECK_FAILED');
  stage = 'SECURE_RUN_VALIDATION';
  const run = await validateRun(args[args.indexOf('--run') + 1]);
  if (args.includes('--diagnose-auth-bindings')) {
    if (args.includes('--backup') || args.includes('--probe-only') || args.includes('--diagnose-surfaces')) fail('DIAGNOSTIC_MODE_EXCLUSIVE');
    stage='READONLY_AUTH_TRIGGER_BINDINGS';
    await verifyLocalProtection(run);
    await assertLocalDocker();
    const sourceBytes=await readFile(path.join(run,'manifests','source-catalog.json'));
    const source=JSON.parse(sourceBytes.toString('utf8'));
    const observed=await query(run,values,AUTH_TRIGGER_BINDING_SQL);
    const triggers=validateAuthTriggerBindings(source,observed);
    const supplement={timestamp:new Date().toISOString(),sourceProjectRef:PROD,sourceCatalogSha256:sha(sourceBytes),triggerCount:2,triggers};
    await writeFile(path.join(run,'manifests','auth-trigger-bindings.json'),JSON.stringify(supplement,null,2),{flag:'wx'});
    console.log(JSON.stringify({authTriggerBindings:'PASS',triggerCount:2,functionBindings:'PASS',sourceSnapshotMatch:'PASS',supplement:'auth-trigger-bindings.json'}));
    return;
  }
  if (args.includes('--diagnose-surfaces')) {
    if (args.includes('--backup') || args.includes('--probe-only')) fail('DIAGNOSTIC_MODE_EXCLUSIVE');
    stage='READONLY_SURFACE_COUNTS';
    await assertLocalDocker();
    const catalog=await query(run,values,`BEGIN READ ONLY; ${CATALOG} ROLLBACK;`);
    if (![catalog.unsafeRoleConfigCount,catalog.foreignObjectCount].every((v)=>Number.isSafeInteger(v)&&v>=0)) fail('SURFACE_COUNT_INVALID');
    const config=await sourceConfig();
    const unsafe=CATALOG.match(/'unsafeRoleConfigCount', \(SELECT count\(\*\) FROM pg_db_role_setting s CROSS JOIN LATERAL unnest\(s\.setconfig\) AS x\(setting\) WHERE ([\s\S]*?)\),\n 'foreignObjectCount'/)?.[1];
    if (!unsafe) fail('SURFACE_PREDICATE_UNAVAILABLE');
    const categories=await query(run,values,`BEGIN READ ONLY;
      WITH settings AS (SELECT s.setdatabase, s.setrole=0 AS role_zero, r.oid IS NULL AS missing_role, r.rolname ~ '^pg_' AS pg_role, r.rolname ~ '^(${config.roles})$' AS reserved,
        split_part(setting,'=',1) ~ '^(${config.configs})$' AS reactivated,
        strpos(setting,chr(10))>0 OR strpos(setting,chr(13))>0 AS multiline,
        split_part(setting,'=',1) ~* '(password|token|secret|jwt|credential|claims|headers|conninfo|dsn|uri|url|private_key)' AS sensitive_key,
        setting ~* '(postgres(ql)?://|Bearer[[:space:]]|eyJ[A-Za-z0-9_-]+[.][A-Za-z0-9_-]+[.][A-Za-z0-9_-]+)' AS value_pattern,
        (${unsafe}) AS unsafe
        FROM pg_db_role_setting s LEFT JOIN pg_roles r ON r.oid=s.setrole CROSS JOIN LATERAL unnest(s.setconfig) AS x(setting))
      SELECT json_build_object(
       'unsafeRoleConfigCount',${catalog.unsafeRoleConfigCount}, 'foreignObjectCount',${catalog.foreignObjectCount},
       'unsafeDatabaseSpecific',count(*) FILTER(WHERE unsafe AND setdatabase<>0),
       'unsafeRoleZero',count(*) FILTER(WHERE unsafe AND role_zero),
       'unsafeMissingRole',count(*) FILTER(WHERE unsafe AND missing_role),
       'unsafePgRole',count(*) FILTER(WHERE unsafe AND setdatabase=0 AND pg_role),
       'unsafeSuppressedReservedSingleLine',count(*) FILTER(WHERE unsafe AND setdatabase=0 AND NOT pg_role AND reserved AND NOT reactivated AND NOT multiline),
       'unsafeExported',count(*) FILTER(WHERE unsafe AND setdatabase=0 AND NOT pg_role AND (NOT reserved OR reactivated)),
       'exportedSensitiveKey',count(*) FILTER(WHERE unsafe AND setdatabase=0 AND NOT pg_role AND (NOT reserved OR reactivated) AND sensitive_key),
       'exportedValuePattern',count(*) FILTER(WHERE unsafe AND setdatabase=0 AND NOT pg_role AND (NOT reserved OR reactivated) AND value_pattern),
       'exportedCustomUnreviewed',count(*) FILTER(WHERE unsafe AND setdatabase=0 AND NOT pg_role AND (NOT reserved OR reactivated) AND NOT sensitive_key AND NOT value_pattern),
       'roleConfigsMultiline',count(*) FILTER(WHERE setdatabase=0 AND NOT pg_role AND multiline)) FROM settings;
      ROLLBACK;`);
    if (!Object.values(categories).every((v)=>Number.isSafeInteger(v)&&v>=0)) fail('SURFACE_CATEGORY_INVALID');
    console.log(JSON.stringify(categories));
    return;
  }
  if (args.includes('--backup') === args.includes('--probe-only')) fail('CHOOSE_PROBE_ONLY_OR_BACKUP');
  stage = 'FRESH_LOCAL_PROTECTION';
  const protection = await verifyLocalProtection(run);
  if (args.includes('--backup')) for (const name of ['roles.sql','schema.sql','data.sql']) if (existsSync(path.join(run,'database',name))) fail('BACKUP_FILE_ALREADY_EXISTS');
  stage = 'SOURCE_VALIDATION';
  const config = await sourceConfig();
  const localVersions = (await readdir(path.join(HERE,'..','supabase','migrations'))).map((name)=>name.match(/^([0-9]{4})_.+\.sql$/)?.[1]).filter(Boolean).sort();
  stage = 'LOCAL_DOCKER_VALIDATION';
  await assertLocalDocker();
  stage = 'CLIENT_VERSION';
  const versionOp = docker(['run', '--rm', '--network', 'none', `${IMAGE}@${DIGEST}`, 'pg_dump', '--version']);
  versionOp.child.stdin.end();
  const client = (await versionOp.done).trim();
  if (!/^pg_dump \(PostgreSQL\) 17\./.test(client)) fail('POSTGRES_CLIENT_MISMATCH');
  stage = 'READONLY_PROBE';
  const probe = await query(run, values, PROBE, { probe:true });
  validateProbe(probe, localVersions);
  stage = 'PROBE_EVIDENCE';
  const evidence = { timestamp:new Date().toISOString(), sourceProjectRef:PROD, database:'postgres', postgresServerVersion:probe.server, postgresClientVersion:client, tlsMode:'verify-full', connectionMode:'SESSION_POOLER', migrationCount:31, migrationMax:'0031', pending:['0032','0033'], dockerImage:IMAGE, dockerDigest:DIGEST, authBackupStrategy:STRATEGY, recoveryGap:GAP, localProtection:protection };
  await writeFile(path.join(run,'manifests',`database-probe-${Date.now()}.json`), JSON.stringify(evidence,null,2), {flag:'wx'});
  console.log(JSON.stringify({ productionTarget:'PASS', qaExcluded:'PASS', connectionMode:'SESSION_POOLER', clientTlsVerifyFull:'PASS', postgresClient:client, postgresServer:probe.server, migrationCount:31, migrationMax:'0031', pending:['0032','0033'], parentAcl:'PASS', backupAcl:'PASS', bitlocker:'PASS', bitlockerEvidence:protection.bitlockerEvidence }));
  if (args.includes('--probe-only')) return;
  for (const name of ['roles.sql', 'schema.sql', 'data.sql']) if (existsSync(path.join(run, 'database', name))) fail('BACKUP_FILE_ALREADY_EXISTS');
  stage = 'EXPORT_SNAPSHOT';
  const keeper = await snapshot(run, values);
  try {
    stage = 'SOURCE_CATALOG';
    const catalog = await query(run, values, snapshotSql(keeper.token, CATALOG));
    if (catalog.unsafeRoleConfigCount !== 0 || catalog.foreignObjectCount !== 0) fail('SOURCE_SECRET_SURFACE_REVIEW_REQUIRED');
    const extraTables=extraDataTables(catalog,config);
    for (const {schema,name} of extraTables) if (![schema,name].every((n)=>/^[a-z_][a-z0-9_]*$/.test(n))) fail('UNSUPPORTED_EXTRA_CATALOG_IDENTIFIER');
    if (extraTables.length) {
      const check = await query(run, values, snapshotSql(keeper.token, `SELECT json_build_object('nonempty',${extraTables.map(({schema,name})=>`CASE WHEN EXISTS(SELECT FROM "${schema}"."${name}" LIMIT 1) THEN 1 ELSE 0 END`).join('+')});`));
      if (check.nonempty !== 0) fail('UNREVIEWED_AUXILIARY_DATA_PRESENT');
    }
    const projection = authProjection(catalog.authUserColumns);
    const identityProjection = authProjection(catalog.authIdentityColumns,'identities');
    // All Auth tables are excluded from generic data dump. Only the reviewed two projections follow.
    const authExcludes = catalog.authTables;
    if (!catalog.authTables.includes('users') || !catalog.authTables.includes('identities')) fail('ACTION_REQUIRED: AUTH_BACKUP_STRATEGY');
    for (const n of authExcludes) if (!/^[a-z_][a-z0-9_]*$/.test(n)) fail('UNSUPPORTED_AUTH_IDENTIFIER');
    const reduction={strategy:STRATEGY,recoveryGap:GAP,scrubbedAuthUserColumns:projection.scrubbed,excludedAuthTables:authExcludes.filter((n)=>!['users','identities'].includes(n)),jsonPolicy:AUTH_JSON_POLICY,supplementaryAuthUsers:'Explicit COPY SELECT projection, same exported snapshot, temporary token columns blanked and JSON allowlist',supplementaryAuthIdentities:'Explicit COPY SELECT projection, same exported snapshot, JSON identity allowlist',excludedGeneratedColumns:{users:catalog.authUserColumns.filter((c)=>c.generated==='ALWAYS').map((c)=>c.name),identities:catalog.authIdentityColumns.filter((c)=>c.generated==='ALWAYS').map((c)=>c.name)}};
    // Exact exclusions and transformations are durable and reviewable before the first dump.
    await writeFile(path.join(run,'manifests','auth-reduction.json'), JSON.stringify(reduction,null,2), {flag:'wx'});
    console.log(JSON.stringify({authBackupStrategy:STRATEGY,excludedAuthTables:reduction.excludedAuthTables,scrubbedAuthUserColumns:projection.scrubbed,jsonPolicy:AUTH_JSON_POLICY,recoveryGap:GAP}));
    const names = [...catalog.publicTables.map((t) => ['public', t.name]), ['auth', 'users'], ['auth', 'identities'], ['storage', 'buckets'], ['storage', 'objects']];
    for (const [,name] of names) if (!/^[a-z_][a-z0-9_]*$/.test(name)) fail('UNSUPPORTED_CATALOG_IDENTIFIER');
    const countsQuery = `SELECT json_build_object(${names.flatMap(([s,n]) => [`'${s}.${n}'`, `(SELECT count(*) FROM "${s}"."${n}")`]).join(',')});`;
    const counts = await query(run, values, snapshotSql(keeper.token, countsQuery));
    await writeFile(path.join(run, 'manifests', 'source-catalog.json'), JSON.stringify(catalog, null, 2), { flag: 'wx' });
    await writeFile(path.join(run, 'manifests', 'source-counts.json'), JSON.stringify(counts, null, 2), { flag: 'wx' });
    const files = [];
    for (const [name, script, extra] of [
      ['roles.sql','dump_role.sh',{ RESERVED_ROLES:config.roles, ALLOWED_CONFIGS:config.configs, EXTRA_SED:'/^--/d' }],
      ['schema.sql','dump_schema.sh',{ EXCLUDED_SCHEMAS:config.schema, EXTRA_FLAGS:`--snapshot=${keeper.token}`, EXTRA_SED:'/^--/d' }],
      ['data.sql','dump_data.sh',{ EXCLUDED_SCHEMAS:config.data, INCLUDED_SCHEMAS:'*', EXTRA_FLAGS:[`--snapshot=${keeper.token}`, ...authExcludes.map((n) => `--exclude-table=auth.${n}`)].join(' ') }],
    ]) {
      stage = `DUMP_${name.replace('.sql','').toUpperCase()}`;
      const op = connection(run, { ...values, ...extra }, ['bash', '-c', 'set -euo pipefail; test ! -e "$2"; bash "$1" > "$2"', 'dump', `/official/${script}`, `/backup/${name}`], { backup:true });
      op.child.stdin.end();
      await op.done;
      if (name === 'data.sql') {
        await appendReducedAuth(run, values, keeper.token, projection,'users');
        await appendReducedAuth(run, values, keeper.token, identityProjection,'identities');
      }
      const file = path.join(run, 'database', name);
      const size = await validateSqlStructure(file,name);
      files.push({ filename:name, size, sha256:await hashFile(file) });
      console.log(`${name}: PASS (nonempty, exit 0, SHA-256 computed)`);
    }
    // Exactly the user-approved manifest field set; private supporting evidence is separate.
    const manifest = { timestamp:evidence.timestamp, sourceProjectRef:PROD, postgresServerVersion:probe.server, postgresClientVersion:client, migrationCount:31, migrationMax:'0031', authBackupStrategy:STRATEGY, recoveryGap:GAP, dockerImage:IMAGE, dockerDigest:DIGEST, tlsMode:'verify-full', connectionMode:'SESSION_POOLER', files };
    await writeFile(path.join(run, 'manifests', 'database-backup-manifest.json'), JSON.stringify(manifest, null, 2), { flag:'wx' });
    console.log(JSON.stringify({ counts: { authUsers:counts['auth.users'], profiles:counts['public.usuarios'], patients:counts['public.pacientes'], appointments:counts['public.agendamentos'], attendances:counts['public.atendimentos'], budgets:counts['public.orcamentos'], payments:counts['public.pagamentos'], storageObjects:counts['storage.objects'] }, databaseBackup:'PASS', databaseIntegrity:'PASS', strategy:STRATEGY, recoveryGap:GAP }));
  } finally { await keeper.close(); }
}

export { sourceConfig, authProjection, childEnvironment, WRAPPER, FIELDS, parseCredential, validateProbe, extraDataTables, AUTH_JSON_POLICY, PROBE, PROBE_INSIDE, AUTH_TRIGGER_BINDING_SQL, validateAuthTriggerBindings };

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => {
  // Raw exceptions/SQL/stderr can contain credentials or rows. Emit only our fixed error codes.
  const safe = /^(?:ACTION_REQUIRED: (?:PRODUCTION_DB_URL|AUTH_BACKUP_STRATEGY)|[A-Z][A-Z0-9_]+|DOCKER_OPERATION_FAILED_EXIT_[0-9]+_CLASS_[A-Z]+_STDERR_SHA256_[a-f0-9]{64})$/.test(error?.message || '') ? error.message : 'RECOVERY_EXECUTOR_FAILED_REDACTED';
  console.error(`${stage}: ${safe}`);
  process.exitCode = 1;
});
