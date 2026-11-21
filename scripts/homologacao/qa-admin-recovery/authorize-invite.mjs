// QA-only operator command. No import from production application code.
// This script is inert unless --execute and all explicit safeguards are supplied.
import { createHash, randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';

const QA_REF = 'zxvpyxvhymuibaxgxetf';
const TARGET_EMAIL = 'ppedro.dev@hotmail.com';
const args = new Set(process.argv.slice(2));

function fail(code) { throw new Error(code); }
function config() {
  if (!args.has('--execute') || args.size !== 1) fail('EXECUTION_FLAG_REQUIRED');
  const e = process.env;
  const required = ['QA_RECOVERY_DB_URL', 'QA_RECOVERY_SERVICE_KEY',
    'QA_RECOVERY_MANAGEMENT_TOKEN', 'QA_RECOVERY_APPROVED_OPERATOR_ID',
    'QA_RECOVERY_APPROVAL_REF',
    'QA_RECOVERY_DISPLAY_NAME', 'QA_RECOVERY_REDIRECT_URL',
    'QA_RECOVERY_DB_CA_FILE'];
  if (required.some((key) => !e[key])) fail('CONFIGURATION_INCOMPLETE');
  if (!stdin.isTTY || !stdout.isTTY) fail('INTERACTIVE_TERMINAL_REQUIRED');
  let dbUrl;
  try { dbUrl = new URL(e.QA_RECOVERY_DB_URL); }
  catch { fail('DATABASE_URL_INVALID'); }
  const dbUser = dbUrl.username;
  const direct = dbUrl.hostname === `db.${QA_REF}.supabase.co` && dbUser === 'postgres';
  const pooler = dbUrl.hostname.endsWith('.pooler.supabase.com')
    && dbUser === `postgres.${QA_REF}`;
  if (!direct && !pooler) fail('DATABASE_PROJECT_GUARD_FAILED');
  if (dbUrl.searchParams.get('sslmode') !== 'verify-full') fail('DATABASE_TLS_GUARD_FAILED');
  let redirect;
  try { redirect = new URL(e.QA_RECOVERY_REDIRECT_URL); }
  catch { fail('REDIRECT_URL_INVALID'); }
  if (!['localhost', '127.0.0.1'].includes(redirect.hostname)
      || redirect.pathname !== '/auth/confirm' || redirect.search || redirect.hash)
    fail('REDIRECT_GUARD_FAILED');
  if (e.QA_RECOVERY_DISPLAY_NAME.trim().length < 1
      || e.QA_RECOVERY_DISPLAY_NAME.trim().length > 200
      || e.QA_RECOVERY_APPROVED_OPERATOR_ID.length < 3
      || e.QA_RECOVERY_APPROVAL_REF.length < 8) fail('INVALID_APPROVAL_METADATA');
  return {
    dbUrl: e.QA_RECOVERY_DB_URL,
    dbCaFile: e.QA_RECOVERY_DB_CA_FILE,
    serviceKey: e.QA_RECOVERY_SERVICE_KEY,
    approvalRef: e.QA_RECOVERY_APPROVAL_REF,
    approvedOperatorId: e.QA_RECOVERY_APPROVED_OPERATOR_ID,
    managementToken: e.QA_RECOVERY_MANAGEMENT_TOKEN,
    displayName: e.QA_RECOVERY_DISPLAY_NAME.trim(),
    redirect: redirect.toString(),
  };
}

const c = config();
async function managementGet(path) {
  const response = await fetch(`https://api.supabase.com/v1/${path}`, {
    headers: { Authorization: `Bearer ${c.managementToken}` },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) fail('MANAGEMENT_AUTHORITY_CHECK_FAILED');
  return response.json();
}
const operator = await managementGet('profile');
const project = await managementGet(`projects/${QA_REF}`);
if (String(operator.id ?? '') !== c.approvedOperatorId
    || (project.id !== QA_REF && project.ref !== QA_REF)
    || !String(project.name ?? '').toLowerCase().includes('qa'))
  fail('OPERATOR_OR_PROJECT_NOT_APPROVED');
const confirm = createInterface({ input: stdin, output: stdout });
try {
  const answer = await confirm.question(`Confirme o projeto QA ${QA_REF} e a operação aprovada digitando QA-RECOVERY: `);
  if (answer !== 'QA-RECOVERY') fail('CONFIRMATION_REQUIRED');
} finally { confirm.close(); }

const db = new pg.Client({ connectionString: c.dbUrl,
  ssl: { ca: await readFile(c.dbCaFile, 'utf8'), rejectUnauthorized: true } });
let authorized = false;
let installed = false;
try {
  await db.connect();
  await db.query(`set qa_admin_recovery.project_ref = '${QA_REF}'`);
  const auth = createClient(`https://${QA_REF}.supabase.co`, c.serviceKey,
    { auth: { persistSession: false, autoRefreshToken: false } });
  const keyCheck = await auth.auth.admin.listUsers({ page: 1, perPage: 100 });
  if (keyCheck.error) fail('QA_SERVICE_KEY_GUARD_FAILED');
  const dbUsers = await db.query('select id from auth.users order by id');
  const authIds = (keyCheck.data.users ?? []).map((user) => user.id).sort();
  if (dbUsers.rows.length !== authIds.length
      || dbUsers.rows.some((row, i) => row.id !== authIds[i]))
    fail('AUTH_DATABASE_BINDING_FAILED');
  const before = await db.query(`select
    (select count(*) from auth.users where lower(email)=$1) auth_count,
    (select count(*) from public.usuarios where lower(email)=$1) profile_count,
    (select count(*) from auth.users) total_auth_count,
    (select count(*) from public.usuarios) total_profile_count,
    (select count(*) from public.usuarios where perfil='administrador' and status='ativo') active_admin_count,
    (select max(version) from supabase_migrations.schema_migrations) last_migration,
    to_regclass('qa_admin_recovery.authorization') recovery_table,
    (select encode(extensions.digest(regexp_replace(trim(p.prosrc),
      '[[:space:]]+', ' ', 'g'), 'sha256'), 'hex')
      from pg_proc p where p.oid='public.handle_new_auth_user()'::regprocedure) trigger_hash`,
    [TARGET_EMAIL]);
  const row = before.rows[0];
  if (Number(row.auth_count) !== 0 || Number(row.profile_count) !== 0
      || Number(row.total_auth_count) !== 5 || Number(row.total_profile_count) !== 5
      || Number(row.active_admin_count) !== 2 || row.last_migration !== '0033'
      || row.recovery_table !== null
      || row.trigger_hash !== 'd0477e4809f724c05c13a88da9ff2d1542619134e4e9e37c0263cf73be86256f')
    fail('PRECONDITION_FAILED');

  const triggers = await db.query(`select tgname,tgenabled,tgdeferrable,tginitdeferred
    from pg_trigger where tgrelid='auth.users'::regclass and not tgisinternal
      and tgname in ('on_auth_user_created','auth_new_user_requires_profile',
        'on_auth_initial_admin_metadata')`);
  if (triggers.rows.length !== 3
      || triggers.rows.some((t) => t.tgenabled !== 'O')
      || !triggers.rows.some((t) => t.tgname === 'auth_new_user_requires_profile'
        && t.tgdeferrable && t.tginitdeferred)) fail('AUTH_TRIGGER_GUARD_FAILED');

  await db.query(await readFile(new URL('./install.sql', import.meta.url), 'utf8'));
  installed = true;
  const protection = await db.query(`select
    (select relrowsecurity from pg_class where oid='qa_admin_recovery.authorization'::regclass) auth_rls,
    (select relrowsecurity from pg_class where oid='qa_admin_recovery.audit'::regclass) audit_rls,
    (select count(*) from pg_policies where schemaname='qa_admin_recovery') policy_count`);
  const privileges = await db.query(`select rolname,
    has_schema_privilege(rolname,'qa_admin_recovery','USAGE') schema_usage,
    has_table_privilege(rolname,'qa_admin_recovery.authorization','SELECT') auth_read,
    has_table_privilege(rolname,'qa_admin_recovery.authorization','INSERT') auth_write,
    has_table_privilege(rolname,'qa_admin_recovery.audit','SELECT') audit_read,
    has_table_privilege(rolname,'qa_admin_recovery.audit','INSERT') audit_write,
    has_function_privilege(rolname,'public.handle_new_auth_user()','EXECUTE') trigger_execute
    from pg_roles where rolname in ('anon','authenticated','service_role')`);
  if (!protection.rows[0].auth_rls || !protection.rows[0].audit_rls
      || Number(protection.rows[0].policy_count) !== 0
      || privileges.rows.length !== 3
      || privileges.rows.some((role) => Object.entries(role)
        .some(([key, value]) => key !== 'rolname' && value !== false)))
    fail('RECOVERY_PRIVILEGE_GUARD_FAILED');

  const token = randomBytes(32).toString('hex');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  await db.query(`insert into qa_admin_recovery.authorization
    (email,nome,token_hash,approval_ref,operator_ref,expires_at)
    values ($1,$2,$3,$4,$5,clock_timestamp() + interval '15 minutes')`,
    [TARGET_EMAIL, c.displayName, tokenHash, c.approvalRef, c.approvedOperatorId]);
  authorized = true;

  const invited = await auth.auth.admin.inviteUserByEmail(TARGET_EMAIL, {
    data: { qa_admin_recovery_token: token }, redirectTo: c.redirect,
  });
  if (invited.error || !invited.data.user) fail('AUTH_INVITE_FAILED_OR_AMBIGUOUS');

  const after = await db.query(`select
    (select count(*) from auth.users where id=$1 and lower(email)=$2
      and not (coalesce(raw_user_meta_data,'{}'::jsonb) ? 'qa_admin_recovery_token')) auth_count,
    (select count(*) from public.usuarios where id=$1 and lower(email)=$2
      and perfil='administrador' and status='ativo') profile_count,
    (select count(*) from qa_admin_recovery.authorization where usuario_id=$1
      and consumed_at is not null) consumed_count,
    (select count(*) from qa_admin_recovery.audit where usuario_id=$1
      and event='qa_admin_recovery_consumed') audit_count`,
    [invited.data.user.id, TARGET_EMAIL]);
  if (Object.values(after.rows[0]).some((value) => Number(value) !== 1))
    fail('POSTCONDITION_FAILED_REVIEW_MANUALLY');
  stdout.write('QA_RECOVERY_IDENTITY_AND_PROFILE_CREATED; email acceptance, password and MFA remain pending.\n');
} catch (error) {
  // A timeout may mean that Auth committed. Never retry or delete a user automatically.
  stdout.write(`QA_RECOVERY_STOPPED: ${error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : 'REVIEW_MANUALLY'}; installation ${installed ? 'present and requires controlled closure' : 'may be present and requires read-only reconciliation'}; authorization ${authorized ? 'may be pending or consumed' : 'may be absent'}.\n`);
  process.exitCode = 1;
} finally { await db.end().catch(() => {}); }
