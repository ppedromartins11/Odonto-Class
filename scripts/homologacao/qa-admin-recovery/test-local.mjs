// Disposable local Supabase exercise. All identities are synthetic and confined
// to scripts/tmp/qa-admin-recovery-lab-20261114. Never accepts a hosted URL.
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';

const root = resolve('scripts/tmp/qa-admin-recovery-lab-20261114');
let status;
try {
  status = JSON.parse(execFileSync(process.execPath,
    [resolve('node_modules/supabase/dist/supabase.js'), 'status', '--workdir', root, '-o', 'json'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
} catch { throw new Error('LOCAL_STACK_STATUS_UNAVAILABLE'); }
assert.match(status.API_URL, /^http:\/\/127\.0\.0\.1:55421$/);
const localDbUrl = new URL(status.DB_URL);
assert.equal(localDbUrl.hostname, '127.0.0.1');
assert.equal(localDbUrl.port, '55422');
assert.equal(localDbUrl.pathname, '/postgres');
const db = new pg.Client({ connectionString: status.DB_URL });
const service = createClient(status.API_URL, status.SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } });
const anon = createClient(status.API_URL, status.ANON_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } });
const token = () => randomBytes(32).toString('hex');
const hash = (value) => createHash('sha256').update(value).digest('hex');
const suffix = randomBytes(5).toString('hex');
const firstEmail = `qa-owner-${suffix}@example.test`;
const targetEmail = `qa-recovery-${suffix}@example.test`;
const otherEmail = `qa-other-${suffix}@example.test`;
const base = resolve('scripts/homologacao/qa-admin-recovery');
const check = async (sql, params = []) => (await db.query(sql, params)).rows[0];

async function deniedCreate(email, userToken, label) {
  const result = await service.auth.admin.createUser({
    email, user_metadata: userToken ? { qa_admin_recovery_token: userToken } : {},
  });
  assert.ok(result.error, `${label} should be denied`);
  console.log(`${label}: PASS`);
}

await db.connect();
try {
  assert.equal(Number((await check('select count(*) n from auth.users')).n), 0);
  const bootToken = token();
  await db.query(`insert into bootstrap_private.initial_admin_authorization
    (email,nome,token_hash,expires_at) values($1,'Synthetic QA Owner',$2,clock_timestamp()+interval '10 minutes')`,
    [firstEmail, hash(bootToken)]);
  const first = await service.auth.admin.createUser({
    email: firstEmail, password: `Qa-${randomBytes(32).toString('base64url')}!9`,
    email_confirm: true, app_metadata: { initial_admin_bootstrap_token: bootToken },
  });
  assert.ifError(first.error);
  assert.ok(first.data.user);
  assert.equal(Number((await check(`select count(*) n from public.usuarios
    where id=$1 and perfil='administrador' and status='ativo'`, [first.data.user.id])).n), 1);

  const installSql = (await readFile(resolve(base, 'install.sql'), 'utf8'))
    .replaceAll('ppedro.dev@hotmail.com', targetEmail);
  await assert.rejects(db.query(installSql), /QA_RECOVERY_PROJECT_GUARD_FAILED/);
  await db.query('rollback');
  await db.query(`set qa_admin_recovery.project_ref = 'zxvpyxvhymuibaxgxetf'`);
  await db.query(installSql);
  console.log('missing project guard denied: PASS');
  console.log('installed function fingerprint:', (await check(`select encode(extensions.digest(
    regexp_replace(trim(p.prosrc), '[[:space:]]+', ' ', 'g'), 'sha256'), 'hex') sha
    from pg_proc p where p.oid='public.handle_new_auth_user()'::regprocedure`)).sha);
  const grants = await check(`select
    has_schema_privilege('anon','qa_admin_recovery','USAGE') anon_usage,
    has_schema_privilege('authenticated','qa_admin_recovery','USAGE') user_usage,
    has_schema_privilege('service_role','qa_admin_recovery','USAGE') service_usage,
    has_function_privilege('anon','public.handle_new_auth_user()','EXECUTE') anon_exec`);
  assert.deepEqual(Object.values(grants), [false, false, false, false]);
  await deniedCreate(otherEmail, null, 'missing authorization');
  const recoveryToken = token();
  await db.query(`insert into qa_admin_recovery.authorization
    (email,nome,token_hash,approval_ref,operator_ref,expires_at)
    values($1,'Synthetic Recovery Admin',$2,'LOCAL-APPROVAL','local-operator',clock_timestamp()+interval '10 minutes')`,
    [targetEmail, hash(recoveryToken)]);
  assert.equal(Number((await check(`select count(*) n from qa_admin_recovery.audit
    where event='qa_admin_recovery_authorized'`)).n), 1);
  await deniedCreate(targetEmail, token(), 'invalid token');
  await deniedCreate(otherEmail, recoveryToken, 'other email');

  // A normal client cannot create the private authorization row.
  await db.query('begin');
  try {
    await db.query('set local role authenticated');
    await assert.rejects(db.query(`insert into qa_admin_recovery.authorization
      (email,nome,token_hash,approval_ref,operator_ref,expires_at)
      values($1,'Intruder',$2,'FAKE-APPROVAL','intruder',clock_timestamp()+interval '1 minute')`,
      [otherEmail, hash(token())]));
  } finally { await db.query('rollback'); }
  console.log('ordinary-user elevation: PASS');

  await db.query(`update qa_admin_recovery.authorization
    set created_at=clock_timestamp()-interval '10 minutes',
        expires_at=clock_timestamp()-interval '1 minute'`);
  await deniedCreate(targetEmail, recoveryToken, 'expired token');
  await db.query(`update qa_admin_recovery.authorization
    set created_at=clock_timestamp(), expires_at=clock_timestamp()+interval '10 minutes'`);
  const closeSql = await readFile(resolve(base, 'close.sql'), 'utf8');
  await assert.rejects(db.query(closeSql), /QA_RECOVERY_PENDING_RECONCILIATION/);
  await db.query('rollback');
  console.log('premature closure denied: PASS');

  // Simulate an unavailable audit sink. The Auth insert must roll back too.
  await db.query(`create or replace function qa_admin_recovery.test_audit_failure()
    returns trigger language plpgsql set search_path='' as $$
    begin raise exception 'SYNTHETIC_AUDIT_FAILURE'; end $$`);
  await db.query(`create trigger qa_recovery_test_fail before insert on qa_admin_recovery.audit
    for each row when (new.event='qa_admin_recovery_consumed')
    execute function qa_admin_recovery.test_audit_failure()`);
  await deniedCreate(targetEmail, recoveryToken, 'partial failure rollback');
  assert.equal(Number((await check('select count(*) n from auth.users where email=$1', [targetEmail])).n), 0);
  await db.query('drop trigger qa_recovery_test_fail on qa_admin_recovery.audit');
  await db.query('drop function qa_admin_recovery.test_audit_failure()');

  const attempts = await Promise.all(Array.from({ length: 2 }, () =>
    service.auth.admin.inviteUserByEmail(targetEmail, {
      data: { qa_admin_recovery_token: recoveryToken },
      redirectTo: 'http://127.0.0.1:3000/auth/confirm',
    })));
  assert.equal(attempts.filter((x) => !x.error && x.data.user).length, 1);
  const created = attempts.find((x) => !x.error && x.data.user).data.user;
  const result = await check(`select
    (select count(*) from auth.users where id=$1 and email=$2
      and not (coalesce(raw_user_meta_data,'{}'::jsonb) ? 'qa_admin_recovery_token')) auth_ok,
    (select count(*) from public.usuarios where id=$1 and email=$2
      and perfil='administrador' and status='ativo') profile_ok,
    (select count(*) from qa_admin_recovery.authorization
      where consumed_at is not null and usuario_id=$1) consumed_ok,
    (select count(*) from qa_admin_recovery.audit
      where event='qa_admin_recovery_consumed' and usuario_id=$1) audit_ok`,
    [created.id, targetEmail]);
  assert.deepEqual(Object.values(result).map(Number), [1, 1, 1, 1]);
  console.log('valid authorization and concurrent single consumption: PASS');
  await deniedCreate(targetEmail, recoveryToken, 'replay');

  // Local synthetic password enables an AAL1 check; real invitees set their own.
  const password = `Qa-${randomBytes(32).toString('base64url')}!9`;
  assert.ifError((await service.auth.admin.updateUserById(created.id,
    { password, email_confirm: true })).error);
  const signed = await anon.auth.signInWithPassword({ email: targetEmail, password });
  assert.ifError(signed.error);
  const mfa = await anon.auth.mfa.getAuthenticatorAssuranceLevel();
  assert.ifError(mfa.error);
  assert.equal(mfa.data.currentLevel, 'aal1');
  const gate = await anon.rpc('prepare_user_invitation', {
    p_email: otherEmail, p_nome: 'Denied', p_perfil: 'recepcao',
  });
  assert.ok(gate.error);
  assert.equal(gate.error.code, '42501');
  assert.equal(Number((await check('select count(*) n from public.convites_provisionamento')).n), 0);
  console.log('AAL1 admin operation denied: PASS');

  await db.query(closeSql);
  assert.equal((await check(`select to_regclass('qa_admin_recovery.authorization') is null closed`)).closed, true);
  assert.equal(Number((await check(`select count(*) n from qa_admin_recovery.audit`)).n), 2);
  await deniedCreate(`qa-after-${suffix}@example.test`, recoveryToken, 'closed exceptional path');
  console.log('closure and preserved audit: PASS');
} finally {
  await anon.auth.signOut().catch(() => {});
  await db.end();
}
