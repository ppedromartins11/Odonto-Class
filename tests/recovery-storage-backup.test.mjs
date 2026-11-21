import { test } from 'vitest';
import assert from 'node:assert/strict';
import { candidateFromEnvironment, exactProductionOrigin, detectExistingCredential, ORIGIN, PRODUCTION } from '../scripts/recovery-storage-backup.mjs';

const token = (ref, role = 'service_role') => `${Buffer.from('{"alg":"HS256"}').toString('base64url')}.${Buffer.from(JSON.stringify({ref,role})).toString('base64url')}.fake-signature`;
test('accepts only exact Production HTTPS origin', () => {
  assert.equal(exactProductionOrigin(ORIGIN), true);
  for (const value of [ORIGIN.replace('https:', 'http:'), `${ORIGIN}/private`, `${ORIGIN}?secret=x`, ORIGIN.replace('.co', '.co.attacker.invalid'), `https://user:pass@${PRODUCTION}.supabase.co`]) assert.equal(exactProductionOrigin(value), false);
});
test('never selects QA, DR, anon or publishable credentials', () => {
  for (const key of [token('zxvpyxvhymuibaxgxetf'), token('qprzxkolbbnqfopamfhj'), token(PRODUCTION, 'anon'), 'sb_publishable_fake', 'malformed']) assert.equal(candidateFromEnvironment({SUPABASE_SERVICE_ROLE_KEY:key,NEXT_PUBLIC_SUPABASE_URL:ORIGIN}), null);
  assert.equal(candidateFromEnvironment({SUPABASE_SERVICE_ROLE_KEY:token(PRODUCTION)}).credentialClass, 'PROJECT_SERVICE_ROLE');
});
test('opaque secret requires same-source exact Production URL', () => {
  assert.equal(candidateFromEnvironment({SUPABASE_SECRET_KEY:'sb_secret_fake'}), null);
  assert.equal(candidateFromEnvironment({SUPABASE_SECRET_KEY:'sb_secret_fake',NEXT_PUBLIC_SUPABASE_URL:'https://zxvpyxvhymuibaxgxetf.supabase.co'}), null);
  assert.equal(candidateFromEnvironment({SUPABASE_SECRET_KEY:'sb_secret_fake',NEXT_PUBLIC_SUPABASE_URL:ORIGIN}).credentialClass, 'SECRET_KEY');
});
test('does not mix credentials between files and never accesses network', async () => {
  const files = new Map([['.env.local','SUPABASE_SECRET_KEY=sb_secret_fake'],['.env.production',`NEXT_PUBLIC_SUPABASE_URL=${ORIGIN}`]]);
  const read = async (name) => { const value = files.get(name.split(/[\\/]/).at(-1)); if (value === undefined) throw Object.assign(new Error('missing'),{code:'ENOENT'}); return value; };
  assert.equal(await detectExistingCredential('/fake',{},read), null);
  files.set('.env.production.local', `SUPABASE_SERVICE_ROLE_KEY=${token(PRODUCTION)}`);
  assert.equal((await detectExistingCredential('/fake',{},read)).credentialClass, 'PROJECT_SERVICE_ROLE');
});
