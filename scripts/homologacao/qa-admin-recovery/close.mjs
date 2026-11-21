// QA-only closure after reconciliation. The private audit table is retained.
import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';

const QA_REF = 'zxvpyxvhymuibaxgxetf';
if (process.argv.slice(2).join(' ') !== '--close --execute')
  throw new Error('EXPLICIT_CLOSE_FLAGS_REQUIRED');
const e = process.env;
if (!e.QA_RECOVERY_DB_URL || !e.QA_RECOVERY_DB_CA_FILE || !e.QA_RECOVERY_SERVICE_KEY
    || !e.QA_RECOVERY_MANAGEMENT_TOKEN || !e.QA_RECOVERY_APPROVED_OPERATOR_ID
    || !e.QA_RECOVERY_APPROVAL_REF || !stdin.isTTY || !stdout.isTTY)
  throw new Error('CLOSE_CONFIGURATION_OR_TERMINAL_MISSING');
let dbUrl;
try { dbUrl = new URL(e.QA_RECOVERY_DB_URL); }
catch { throw new Error('DATABASE_URL_INVALID'); }
const dbUser = dbUrl.username;
const direct = dbUrl.hostname === `db.${QA_REF}.supabase.co` && dbUser === 'postgres';
const pooler = dbUrl.hostname.endsWith('.pooler.supabase.com')
  && dbUser === `postgres.${QA_REF}`;
if ((!direct && !pooler) || dbUrl.searchParams.get('sslmode') !== 'verify-full')
  throw new Error('QA_DATABASE_GUARD_FAILED');
const headers = { Authorization: `Bearer ${e.QA_RECOVERY_MANAGEMENT_TOKEN}` };
const [profileResponse, projectResponse] = await Promise.all([
  fetch('https://api.supabase.com/v1/profile', { headers, signal: AbortSignal.timeout(10000) }),
  fetch(`https://api.supabase.com/v1/projects/${QA_REF}`,
    { headers, signal: AbortSignal.timeout(10000) }),
]);
if (!profileResponse.ok || !projectResponse.ok) throw new Error('MANAGEMENT_GUARD_FAILED');
const profile = await profileResponse.json();
const project = await projectResponse.json();
if (String(profile.id ?? '') !== e.QA_RECOVERY_APPROVED_OPERATOR_ID
    || (project.id !== QA_REF && project.ref !== QA_REF)
    || !String(project.name ?? '').toLowerCase().includes('qa'))
  throw new Error('OPERATOR_OR_PROJECT_NOT_APPROVED');

const confirm = createInterface({ input: stdin, output: stdout });
try {
  const answer = await confirm.question(`Confirme fechamento no QA ${QA_REF} digitando QA-RECOVERY-CLOSE: `);
  if (answer !== 'QA-RECOVERY-CLOSE') throw new Error('CLOSE_CONFIRMATION_REQUIRED');
} finally { confirm.close(); }

const db = new pg.Client({ connectionString: e.QA_RECOVERY_DB_URL,
  ssl: { ca: await readFile(e.QA_RECOVERY_DB_CA_FILE, 'utf8'), rejectUnauthorized: true } });
try {
  await db.connect();
  await db.query(`set qa_admin_recovery.project_ref = '${QA_REF}'`);
  const auth = createClient(`https://${QA_REF}.supabase.co`, e.QA_RECOVERY_SERVICE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } });
  const authUsers = await auth.auth.admin.listUsers({ page: 1, perPage: 100 });
  if (authUsers.error) throw new Error('QA_SERVICE_KEY_GUARD_FAILED');
  const dbUsers = await db.query('select id from auth.users order by id');
  const authIds = (authUsers.data.users ?? []).map((user) => user.id).sort();
  if (dbUsers.rows.length !== authIds.length
      || dbUsers.rows.some((row, i) => row.id !== authIds[i]))
    throw new Error('AUTH_DATABASE_BINDING_FAILED');
  const before = await db.query(`select email,approval_ref,operator_ref
    from qa_admin_recovery.authorization where singleton=true`);
  if (before.rows.length > 1
      || (before.rows.length === 1 && (
        before.rows[0].email !== 'ppedro.dev@hotmail.com'
        || before.rows[0].approval_ref !== e.QA_RECOVERY_APPROVAL_REF
        || before.rows[0].operator_ref !== e.QA_RECOVERY_APPROVED_OPERATOR_ID)))
    throw new Error('AUTHORIZATION_IDENTITY_DRIFT');
  await db.query(await readFile(new URL('./close.sql', import.meta.url), 'utf8'));
  stdout.write('QA_RECOVERY_PATH_CLOSED; private audit retained.\n');
} catch (error) {
  stdout.write(`QA_RECOVERY_CLOSE_BLOCKED: ${error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : 'REVIEW_MANUALLY'}\n`);
  process.exitCode = 1;
} finally { await db.end().catch(() => {}); }
