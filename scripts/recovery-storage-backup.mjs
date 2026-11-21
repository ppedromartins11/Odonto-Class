/** Production Storage recovery. Never logs raw errors, paths, keys or responses. */
import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PRODUCTION = 'sqouddqzpmkofenyufuj';
const ORIGIN = `https://${PRODUCTION}.supabase.co`;
const ENV_FILES = ['.env.local', '.env.production', '.env.production.local'];
const KEY_FIELDS = ['PRODUCTION_SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_PRODUCTION_SERVICE_ROLE_KEY', 'PRODUCTION_SERVICE_ROLE_KEY', 'PRODUCTION_SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEY'];
const URL_FIELDS = ['PRODUCTION_SUPABASE_URL', 'SUPABASE_PRODUCTION_URL', 'PRODUCTION_STORAGE_URL', 'SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL'];
function fail(code) { throw new Error(code); }

function exactProductionOrigin(raw) {
  try {
    const u = new URL(raw);
    return u.origin === ORIGIN && !u.username && !u.password && u.pathname === '/' && !u.search && !u.hash;
  } catch { return false; }
}

// Claim checks select a candidate only; the HTTPS Storage server authenticates the key.
// An anon/publishable key or another project's key is never tried remotely.
function candidateFromEnvironment(env) {
  const productionUrlPresent = URL_FIELDS.some((name) => exactProductionOrigin(env[name]));
  for (const name of KEY_FIELDS) {
    const key = env[name];
    if (typeof key !== 'string' || !key || /[\r\n\0]/.test(key)) continue;
    if (key.startsWith('sb_secret_')) {
      if (productionUrlPresent) return { origin: ORIGIN, key, credentialClass: 'SECRET_KEY' };
      continue;
    }
    try {
      const parts = key.split('.');
      if (parts.length !== 3) continue;
      const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
      if (claims.role === 'service_role' && claims.ref === PRODUCTION &&
          (!claims.exp || (typeof claims.exp === 'number' && claims.exp > Date.now() / 1000))) {
        return { origin: ORIGIN, key, credentialClass: 'PROJECT_SERVICE_ROLE' };
      }
    } catch { /* Candidate rejected without exposing it. */ }
  }
  return null;
}

async function detectExistingCredential(root, inherited = process.env, read = readFile) {
  const inheritedCandidate = candidateFromEnvironment(inherited);
  if (inheritedCandidate) return inheritedCandidate;
  // Files are evaluated separately. A QA URL/key is never combined with another file.
  for (const name of ENV_FILES) {
    let env;
    try { env = parseEnv(await read(path.join(root, name), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') continue; fail('STORAGE_CREDENTIAL_FILE_UNREADABLE'); }
    const candidate = candidateFromEnvironment(env);
    if (candidate) return candidate;
  }
  return null;
}

async function requireDatabaseRecoveryPass(run, read = readFile) {
  const manifest = JSON.parse(await read(path.join(run, 'manifests', 'database-backup-manifest.json'), 'utf8'));
  if (manifest.sourceProjectRef !== PRODUCTION || manifest.authBackupStrategy !== 'REDUCED AUTH BACKUP' ||
      manifest.tlsMode !== 'verify-full' || manifest.connectionMode !== 'SESSION_POOLER') fail('DATABASE_BACKUP_GATE_NOT_PASS');
  // Root passes the exact independently reviewed restore evidence filename later.
  return manifest;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || (args.length === 1 && args[0] === '--plan')) {
    console.log(JSON.stringify({ mode: 'PLAN_ONLY', prerequisites: ['DATABASE BACKUP PASS', 'DATABASE INTEGRITY PASS', 'DATABASE RESTORE REHEARSAL PASS including owned cleanup'], credentialSources: 'existing process environment or existing local production environment files; memory only', missingCredential: 'ACTION_REQUIRED: STORAGE_BACKUP_CREDENTIAL', operations: ['GET buckets', 'POST list (read-only, recursive, paginated)', 'GET authenticated object download', 'repeat full inventory and compare', 'local SHA-256 and count/size/etag parity'], persistence: 'private backup root only; hashed filenames; private restore mapping; no-clobber', remoteMutation: false }));
    return;
  }
  fail('STORAGE_EXECUTION_NOT_YET_ENABLED');
}

export { PRODUCTION, ORIGIN, exactProductionOrigin, candidateFromEnvironment, detectExistingCredential, requireDatabaseRecoveryPass };
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => {
  console.error(/^[A-Z][A-Z0-9_]+$/.test(error.message) ? error.message : 'STORAGE_OPERATION_FAILED_REDACTED');
  process.exitCode = 1;
});
