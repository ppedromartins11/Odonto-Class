import { test } from 'vitest';
import assert from 'node:assert/strict';
import { credential, evaluate, render } from '../recovery-production-diagnostic.mjs';

const versions = Array.from({ length: 33 }, (_, i) => String(i + 1).padStart(4, '0'));
const target = { productionTarget: true, qaExcluded: true };
const baseline = () => ({ databaseExpected: true, serverVersion: '17.6', serverExpected: true,
  backendTls: true, readOnly: true, migrationCount: 31, migrationMax: '0031', migrations: versions.slice(0, 31) });

test('backend TLS mismatch is preserved independently from client verify-full', () => {
  const result = evaluate({ ...baseline(), backendTls: false }, true, target, versions);
  assert.equal(result.flags.TLS_VERIFY_FULL, true);
  assert.deepEqual(result.divergent, ['pg_stat_ssl.ssl']);
  assert.match(render(result), /serverTlsFlag \(pg_stat_ssl.ssl\): false/);
  assert.deepEqual(result.pending, ['0032', '0033']);
});

test('each unexpected migration/version/database/read-only condition survives evaluation', () => {
  const result = evaluate({ ...baseline(), databaseExpected: false, serverVersion: '17.7', serverExpected: false,
    readOnly: false, migrationCount: 32, migrationMax: '0032', migrations: versions.slice(0, 32) }, true, target, versions);
  for (const name of ['DATABASE_NAME', 'POSTGRES_SERVER_VERSION', 'transaction_read_only', 'MIGRATION_COUNT_MATCH',
    'MAX_MIGRATION_MATCH', 'PENDING_MATCH', 'MIGRATION_SEQUENCE_MATCH']) assert.ok(result.divergent.includes(name));
  assert.deepEqual(result.pending, ['0033']);
});

test('vendor numeric version remains visible without losing independent diagnostic flags', () => {
  const result = evaluate({ ...baseline(), serverVersion: '17.6.1.165', serverExpected: false }, true, target, versions);
  assert.deepEqual(result.divergent, ['POSTGRES_SERVER_VERSION']);
  assert.match(render(result), /POSTGRES_SERVER_VERSION: 17\.6\.1\.165/);
});

test('successful diagnostic renders PASS and only sanitized target evidence', () => {
  const parsed = credential('postgresql://postgres:fictional-password@db.sqouddqzpmkofenyufuj.supabase.co:5432/postgres?sslmode=require');
  const output = render(evaluate(baseline(), true, parsed, versions));
  assert.match(output, /DIAGNOSTIC RESULT:\nPASS/);
  for (const value of ['fictional-password', 'supabase.co', 'postgresql://', 'PGPASSWORD']) assert.ok(!output.includes(value));
});

test('QA and DR credentials are rejected before any connection', () => {
  for (const ref of ['zxvpyxvhymuibaxgxetf', 'qprzxkolbbnqfopamfhj']) {
    assert.throws(() => credential(`postgresql://postgres:fictional-password@db.${ref}.supabase.co/postgres`));
  }
});
