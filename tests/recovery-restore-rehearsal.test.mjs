import assert from 'node:assert/strict';
import { test } from 'vitest';
import { spawnSync } from 'node:child_process';
import { validateAuthReduction, validateAuthTriggers, validateBackupManifest } from '../scripts/recovery-restore-rehearsal.mjs';

function manifest() {
  return {
    sourceProjectRef: 'sqouddqzpmkofenyufuj', authBackupStrategy: 'REDUCED AUTH BACKUP',
    migrationMax: '0031', migrationCount: 31, tlsMode: 'verify-full', connectionMode: 'SESSION_POOLER',
    files: ['roles.sql', 'schema.sql', 'data.sql'].map((filename) => ({ filename, size: 1, sha256: 'a'.repeat(64) })),
  };
}

test('restore accepts only the approved target, reduced strategy, TLS, connection and migration gates', () => {
  assert.doesNotThrow(() => validateBackupManifest(manifest()));
  for (const [key, value] of [
    ['sourceProjectRef', 'zxvpyxvhymuibaxgxetf'], ['authBackupStrategy', 'FULL AUTH BACKUP'],
    ['tlsMode', 'require'], ['connectionMode', 'UNKNOWN'], ['migrationCount', 32], ['migrationMax', '0032'],
  ]) assert.throws(() => validateBackupManifest({ ...manifest(), [key]: value }), /DATABASE_BACKUP_GATE_MISMATCH/);
});

test('restore rejects missing, duplicate, empty or unhashed SQL evidence before Docker', () => {
  for (const alter of [
    (m) => m.files.pop(),
    (m) => { m.files[2].filename = 'roles.sql'; },
    (m) => { m.files[1].size = 0; },
    (m) => { m.files[0].sha256 = 'invalid'; },
  ]) {
    const value = manifest(); alter(value);
    assert.throws(() => validateBackupManifest(value), /DATABASE_(FILE_SET_MISMATCH|INTEGRITY_EVIDENCE_REQUIRED)/);
  }
});

test('default execution remains a plan and requires no Docker or connection credential', () => {
  const result = spawnSync(process.execPath, ['scripts/recovery-restore-rehearsal.mjs'], {
    cwd: process.cwd(), encoding: 'utf8', env: { ...process.env, PRODUCTION_DB_URL: '', PATH: '', Path: '' },
  });
  assert.equal(result.status, 0);
  const output = JSON.parse(result.stdout);
  assert.equal(output.mode, 'PLAN_ONLY');
  assert.match(output.isolation, /no published ports/);
  assert.equal(result.stderr, '');
});

test('Auth evidence must exclude every non-account table and preserve the reviewed JSON allowlists', () => {
  const source = { authTables: ['users', 'identities', 'sessions', 'refresh_tokens', 'mfa_factors', 'schema_migrations'], publicTables: [{ name: 'usuarios' }] };
  const reduction = {
    strategy: 'REDUCED AUTH BACKUP', scrubbedAuthUserColumns: ['confirmation_token'],
    excludedAuthTables: ['sessions', 'refresh_tokens', 'mfa_factors', 'schema_migrations'],
    jsonPolicy: { users: { raw_user_meta_data: [], raw_app_meta_data: ['provider', 'providers'] }, identities: { identity_data: ['sub', 'email', 'phone', 'provider_id', 'email_verified', 'phone_verified'] } },
  };
  assert.deepEqual(validateAuthReduction(reduction, source), ['public.usuarios', 'auth.users', 'auth.identities', 'storage.buckets', 'storage.objects']);
  assert.throws(() => validateAuthReduction({ ...reduction, excludedAuthTables: ['sessions'] }, source), /AUTH_EXCLUSION_SET_MISMATCH/);
  const altered = structuredClone(reduction);
  altered.jsonPolicy.identities.identity_data.push('refresh_token');
  assert.throws(() => validateAuthReduction(altered, source), /AUTH_REDUCTION_EVIDENCE_REQUIRED/);
});

test('unqualified Auth trigger text is accepted only with matching public binding and exact event shape', () => {
  const triggers = [
    { schema: 'auth', table: 'users', name: 'on_auth_user_created', enabled: 'O', definition: 'CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION handle_new_auth_user()' },
    { schema: 'auth', table: 'users', name: 'on_auth_user_email_updated', enabled: 'O', definition: 'CREATE TRIGGER on_auth_user_email_updated AFTER UPDATE OF email ON auth.users FOR EACH ROW EXECUTE FUNCTION sync_auth_user_email()' },
  ];
  const bindings = triggers.map((trigger, index) => ({ ...trigger, functionSchema: 'public', functionName: index ? 'sync_auth_user_email' : 'handle_new_auth_user', functionArgs: '', functionDefinitionHash: 'b'.repeat(32) }));
  const functions = bindings.map((item) => ({ name: item.functionName, args: '', definitionHash: item.functionDefinitionHash }));
  assert.doesNotThrow(() => validateAuthTriggers(triggers, bindings, functions));
  assert.throws(() => validateAuthTriggers(triggers), /BINDING_EVIDENCE_REQUIRED/);
  for (const [key, value] of [['functionSchema', 'other'], ['functionArgs', 'x text'], ['definition', `${triggers[0].definition} WHEN (true)`]]) {
    const altered = structuredClone(bindings); altered[0][key] = value;
    assert.throws(() => validateAuthTriggers(triggers, altered, functions), /BINDING_MISMATCH/);
  }
  const changedFunction = structuredClone(bindings); changedFunction[0].functionDefinitionHash = 'c'.repeat(32);
  assert.throws(() => validateAuthTriggers(triggers, changedFunction, functions), /FUNCTION_DRIFT/);
  const changedEvent = structuredClone(triggers); changedEvent[0].definition = changedEvent[0].definition.replace('AFTER INSERT', 'BEFORE INSERT');
  assert.throws(() => validateAuthTriggers(changedEvent, bindings, functions), /BASELINE_DRIFT/);
});
