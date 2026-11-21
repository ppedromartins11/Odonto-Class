import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { Client } from "pg";
import { createClient } from "@supabase/supabase-js";
import { ROOT } from "./lib/env.mjs";
import { assertGuard } from "./lib/safety.mjs";
import { readLinkedProjectRef } from "./0030/config.mjs";
import { migrationInventory } from "./preflight.mjs";

const CONFIRMATION = "BOOTSTRAP_INITIAL_ADMIN_IN_QA";
const MANIFEST = resolve(ROOT, "artifacts/homologacao/bootstrap-provisioner.json");
const LOCK = resolve(ROOT, "artifacts/homologacao/bootstrap-provisioner.lock");
const ENV_FILE = resolve(ROOT, ".env.homologacao.local");
const KEY = "initial_admin_bootstrap_token";

export function readBootstrapEnvironment() {
  if (!existsSync(ENV_FILE)) throw new Error("QA_BOOTSTRAP_ENV_FILE_REQUIRED");
  if (!lstatSync(ENV_FILE).isFile()) throw new Error("QA_BOOTSTRAP_ENV_FILE_INVALID");
  return { ...parseEnv(readFileSync(ENV_FILE, "utf8")),
    HOMOLOGATION_INITIAL_ADMIN_BOOTSTRAP_ACK: process.env.HOMOLOGATION_INITIAL_ADMIN_BOOTSTRAP_ACK };
}

export function assertBootstrapTarget(env, linkedRef) {
  assertGuard(env, linkedRef, "remote");
  if (env.HOMOLOGATION_INITIAL_ADMIN_BOOTSTRAP_ACK !== CONFIRMATION)
    throw new Error("INITIAL_ADMIN_BOOTSTRAP_CONFIRMATION_REQUIRED");
  if (!env.SUPABASE_TEST_SERVICE_ROLE_KEY || !env.SUPABASE_TEST_ANON_KEY) throw new Error("QA_AUTH_KEYS_REQUIRED");
}

function digest(value) { return createHash("sha256").update(value).digest("hex"); }
function serviceClient(env) {
  return createClient(env.SUPABASE_TEST_URL, env.SUPABASE_TEST_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}
async function readSignupDisabled(env) {
  const response = await fetch(new URL("/auth/v1/settings", env.SUPABASE_TEST_URL), {
    headers: { apikey: env.SUPABASE_TEST_ANON_KEY }, signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error("QA_SIGNUP_CONFIG_UNVERIFIED");
  const config = await response.json();
  if (config.disable_signup !== true && config.disable_signups !== true)
    throw new Error("QA_PUBLIC_SIGNUP_ENABLED_OR_UNVERIFIED");
}
async function dbSnapshot(db) {
  const query = await db.query(`select
    (select count(*)::int from auth.users) auth_count,
    (select count(*)::int from public.usuarios) profile_count,
    (select count(*)::int from public.convites_provisionamento) invite_count,
    (select count(*)::int from bootstrap_private.initial_admin_authorization) authorization_count,
    (select count(*)::int from bootstrap_private.initial_admin_authorization where consumed_at is not null) consumed_count,
    (select count(*)::int from auth.users a left join public.usuarios u on u.id=a.id where u.id is null) auth_orphans,
    (select count(*)::int from public.usuarios u left join auth.users a on a.id=u.id where a.id is null) profile_orphans`);
  return query.rows[0];
}
async function assertMigrations(db) {
  const local = migrationInventory().map((entry) => entry.version);
  if (local.length !== 33 || local.some((version, index) => version !== String(index + 1).padStart(4, "0")))
    throw new Error("LOCAL_MIGRATION_SEQUENCE_INVALID");
  const remote = (await db.query("select version::text as version from supabase_migrations.schema_migrations order by version")).rows.map((row) => row.version);
  if (JSON.stringify(local) !== JSON.stringify(remote)) throw new Error("QA_MIGRATION_SEQUENCE_MISMATCH");
}
function credentialsFromFile() {
  if (!existsSync(ENV_FILE)) return {};
  return parseEnv(readFileSync(ENV_FILE, "utf8"));
}
async function writeCredentials(email, password) {
  const source = existsSync(ENV_FILE) ? await readFile(ENV_FILE, "utf8") : "";
  const cleaned = source.split(/\r?\n/).filter((line) => !/^SUPABASE_TEST_ADMIN_(EMAIL|PASSWORD)=/.test(line));
  const body = `${cleaned.join("\n").trimEnd()}\nSUPABASE_TEST_ADMIN_EMAIL=${email}\nSUPABASE_TEST_ADMIN_PASSWORD=${password}\n`;
  const temp = `${ENV_FILE}.${randomUUID()}.tmp`;
  await writeFile(temp, body, { mode: 0o600, flag: "wx" });
  await rename(temp, ENV_FILE);
}

async function writeManifest(manifest) {
  await mkdir(resolve(ROOT, "artifacts/homologacao"), { recursive: true });
  const temp = `${MANIFEST}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(manifest, null, 2), { mode: 0o600, flag: "wx" });
  await rename(temp, MANIFEST);
}

function totp(secret) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of secret.replace(/[=\s-]/g, "").toUpperCase()) {
    const index = alphabet.indexOf(char);
    if (index < 0) throw new Error("QA_MFA_SECRET_INVALID");
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(Number.parseInt(bits.slice(i, i + 8), 2));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const mac = createHmac("sha1", Buffer.from(bytes)).update(counter).digest();
  const offset = mac.at(-1) & 15;
  const code = ((mac[offset] & 127) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  return String(code % 1000000).padStart(6, "0");
}

export async function cleanupOwnedMfa(service, userId, manifest) {
  const listed = await service.auth.admin.mfa.listFactors({ userId });
  if (listed.error || !Array.isArray(listed.data?.factors)) throw new Error("QA_BOOTSTRAP_MFA_INVENTORY_FAILED");
  if (listed.data.factors.some((factor) => !manifest.mfaStartedAt
    || !/^QA bootstrap [0-9a-f]{32}$/.test(manifest.mfaFactorName ?? "")
    || factor.friendly_name !== manifest.mfaFactorName
    || (manifest.mfaFactorId && factor.id !== manifest.mfaFactorId)))
    throw new Error("QA_BOOTSTRAP_MFA_PREEXISTING_FACTOR");
  for (const factor of listed.data.factors) {
    const removed = await service.auth.admin.mfa.deleteFactor({ userId, id: factor.id });
    if (removed.error) throw new Error("QA_BOOTSTRAP_MFA_CLEANUP_FAILED");
  }
}

export async function proveTemporaryMfa(login, service, userId, factorName,
  onEnrolled = async () => {}, action = async () => {}) {
  const enrolled = await login.auth.mfa.enroll({ factorType: "totp", friendlyName: factorName });
  const factorId = enrolled.data?.id;
  let result;
  try {
    if (factorId) await onEnrolled(factorId);
    if (enrolled.error || !factorId || !enrolled.data?.totp?.secret) throw new Error("QA_BOOTSTRAP_MFA_ENROLL_FAILED");
    const challenged = await login.auth.mfa.challenge({ factorId });
    if (challenged.error || !challenged.data?.id) throw new Error("QA_BOOTSTRAP_MFA_CHALLENGE_FAILED");
    const verified = await login.auth.mfa.verify({ factorId, challengeId: challenged.data.id,
      code: totp(enrolled.data.totp.secret) });
    if (verified.error) throw new Error("QA_BOOTSTRAP_MFA_VERIFY_FAILED");
    const assurance = await login.auth.mfa.getAuthenticatorAssuranceLevel();
    if (assurance.error || assurance.data?.currentLevel !== "aal2") throw new Error("QA_BOOTSTRAP_AAL2_FAILED");
    result = await action(login);
  } finally {
    if (factorId) {
      const removed = await login.auth.mfa.unenroll({ factorId });
      if (removed.error) {
        const fallback = await service.auth.admin.mfa.deleteFactor({ userId, id: factorId });
        if (fallback.error) throw new Error("QA_BOOTSTRAP_MFA_CLEANUP_FAILED");
      }
    }
  }
  const factors = await login.auth.mfa.listFactors();
  if (factors.error || factors.data?.all?.some((item) => item.id === factorId))
    throw new Error("QA_BOOTSTRAP_MFA_CLEANUP_PROOF_FAILED");
  return result;
}

async function verifyOwnedExisting(db, env, snapshot, manifest, { completeMfa = false } = {}) {
  const credentials = credentialsFromFile();
  if (manifest.kind !== "initial_admin_provisioner" || manifest.projectRef !== "zxvpyxvhymuibaxgxetf"
    || !credentials.SUPABASE_TEST_ADMIN_EMAIL || !credentials.SUPABASE_TEST_ADMIN_PASSWORD
    || digest(credentials.SUPABASE_TEST_ADMIN_EMAIL) !== manifest.emailSha256
    || snapshot.auth_count < 1 || snapshot.profile_count < 1
    || snapshot.authorization_count !== 1 || snapshot.consumed_count !== 1
    || snapshot.auth_orphans !== 0 || snapshot.profile_orphans !== 0)
    throw new Error("QA_BOOTSTRAP_STATE_UNRECOGNIZED");
  const proof = await db.query(`select u.id, u.nome, u.email, u.perfil::text perfil, u.status::text status,
    a.email auth_email, a.raw_app_meta_data ? $1 token_present, b.usuario_id, b.email bootstrap_email, b.nome bootstrap_name
    from public.usuarios u join auth.users a on a.id=u.id
    join bootstrap_private.initial_admin_authorization b on b.usuario_id=u.id`, [KEY]);
  const row = proof.rows[0];
  if (proof.rowCount !== 1 || (manifest.authUserId && row.id !== manifest.authUserId) || row.usuario_id !== row.id
    || row.email !== credentials.SUPABASE_TEST_ADMIN_EMAIL || row.auth_email !== row.email
    || row.bootstrap_email !== row.email || row.perfil !== "administrador" || row.status !== "ativo"
    || row.nome !== row.bootstrap_name || !row.nome.startsWith("QA_") || row.token_present)
    throw new Error("QA_BOOTSTRAP_STATE_UNRECOGNIZED");
  const login = createClient(env.SUPABASE_TEST_URL, env.SUPABASE_TEST_ANON_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } });
  const signed = await login.auth.signInWithPassword({ email: row.email, password: credentials.SUPABASE_TEST_ADMIN_PASSWORD });
  if (signed.error || signed.data.user?.id !== row.id) throw new Error("QA_BOOTSTRAP_LOGIN_FAILED");
  if (completeMfa) {
    const service = serviceClient(env);
    await cleanupOwnedMfa(service, row.id, manifest);
    if (!manifest.mfaStartedAt) {
      manifest = { ...manifest, mfaStartedAt: new Date().toISOString(),
        mfaFactorName: `QA bootstrap ${randomBytes(16).toString("hex")}` };
      await writeManifest(manifest);
    }
    await proveTemporaryMfa(login, service, row.id, manifest.mfaFactorName, async (factorId) => {
      manifest = { ...manifest, mfaFactorId: factorId };
      await writeManifest(manifest);
    });
    const afterFactors = await db.query("select count(*)::int as count from auth.mfa_factors where user_id=$1", [row.id]);
    if (afterFactors.rows[0].count !== 0) throw new Error("QA_BOOTSTRAP_MFA_CLEANUP_PROOF_FAILED");
  }
  await login.auth.signOut();
  if (manifest.status === "prepared") await writeManifest({ ...manifest, status: "active", authUserId: row.id });
  return "REUSED";
}

export async function bootstrapProvisioner(env = readBootstrapEnvironment()) {
  assertBootstrapTarget(env, readLinkedProjectRef());
  for (const path of [resolve(ROOT, "artifacts"), resolve(ROOT, "artifacts/homologacao"), MANIFEST]) {
    if (existsSync(path) && lstatSync(path).isSymbolicLink()) throw new Error("QA_BOOTSTRAP_LOCAL_SYMLINK_FORBIDDEN");
  }
  await mkdir(resolve(ROOT, "artifacts/homologacao"), { recursive: true });
  let lock;
  try { lock = await open(LOCK, "wx", 0o600); }
  catch { throw new Error("QA_BOOTSTRAP_ALREADY_RUNNING"); }
  try {
  const db = new Client({ connectionString: env.SUPABASE_TEST_DB_URL, connectionTimeoutMillis: 8000,
    application_name: "odonto-qa-initial-admin-bootstrap" });
  await db.connect();
  try {
    await db.query("begin read only");
    await assertMigrations(db);
    const snapshot = await dbSnapshot(db);
    await db.query("rollback");
    await readSignupDisabled(env);
    let manifest = existsSync(MANIFEST) ? JSON.parse(await readFile(MANIFEST, "utf8")) : null;
    if (snapshot.consumed_count === 1) {
      if (!manifest) throw new Error("QA_BOOTSTRAP_STATE_UNOWNED");
      return await verifyOwnedExisting(db, env, snapshot, manifest, { completeMfa: manifest.status === "prepared" });
    }
    if (snapshot.auth_count !== 0 || snapshot.profile_count !== 0 || snapshot.invite_count !== 0
      || snapshot.auth_orphans !== 0 || snapshot.profile_orphans !== 0
      || snapshot.authorization_count > 1 || snapshot.consumed_count !== 0)
      throw new Error("QA_BOOTSTRAP_DATABASE_NOT_EMPTY");
    let credentials = credentialsFromFile();
    if (!manifest) {
      if (credentials.SUPABASE_TEST_ADMIN_EMAIL || credentials.SUPABASE_TEST_ADMIN_PASSWORD)
        throw new Error("QA_BOOTSTRAP_LOCAL_STATE_UNRECOGNIZED");
      const email = `qa_bootstrap_${randomUUID()}@example.test`;
      const password = `Qa-${randomBytes(32).toString("base64url")}-9!`;
      manifest = { kind: "initial_admin_provisioner", projectRef: "zxvpyxvhymuibaxgxetf",
        status: "prepared", emailSha256: digest(email), nome: `QA_INITIAL_ADMIN_${randomUUID()}`,
        createdAt: new Date().toISOString(), teardownOnly: true };
      await writeManifest(manifest);
      await writeCredentials(email, password);
      credentials = { SUPABASE_TEST_ADMIN_EMAIL: email, SUPABASE_TEST_ADMIN_PASSWORD: password };
    } else {
      if (manifest.kind !== "initial_admin_provisioner" || manifest.projectRef !== "zxvpyxvhymuibaxgxetf"
        || manifest.status !== "prepared" || !manifest.nome?.startsWith("QA_"))
        throw new Error("QA_BOOTSTRAP_LOCAL_STATE_UNRECOGNIZED");
      if (!credentials.SUPABASE_TEST_ADMIN_EMAIL && !credentials.SUPABASE_TEST_ADMIN_PASSWORD) {
        const pending = await db.query("select email from bootstrap_private.initial_admin_authorization where singleton=true and consumed_at is null");
        if (pending.rowCount && digest(pending.rows[0].email) !== manifest.emailSha256)
          throw new Error("QA_BOOTSTRAP_STATE_UNRECOGNIZED");
        const email = `qa_bootstrap_${randomUUID()}@example.test`;
        const password = `Qa-${randomBytes(32).toString("base64url")}-9!`;
        manifest = { ...manifest, emailSha256: digest(email) };
        await writeManifest(manifest);
        await writeCredentials(email, password);
        credentials = { SUPABASE_TEST_ADMIN_EMAIL: email, SUPABASE_TEST_ADMIN_PASSWORD: password };
      } else if (!credentials.SUPABASE_TEST_ADMIN_EMAIL || !credentials.SUPABASE_TEST_ADMIN_PASSWORD
        || digest(credentials.SUPABASE_TEST_ADMIN_EMAIL) !== manifest.emailSha256)
        throw new Error("QA_BOOTSTRAP_LOCAL_STATE_UNRECOGNIZED");
    }
    const email = credentials.SUPABASE_TEST_ADMIN_EMAIL;
    const password = credentials.SUPABASE_TEST_ADMIN_PASSWORD;
    const token = randomBytes(32).toString("hex");
    await db.query("begin");
    try {
      await db.query("select pg_catalog.pg_advisory_xact_lock(179384612, 320032)");
      await assertMigrations(db);
      const locked = await dbSnapshot(db);
      if (locked.auth_count !== 0 || locked.profile_count !== 0 || locked.invite_count !== 0
        || locked.consumed_count !== 0 || locked.auth_orphans !== 0 || locked.profile_orphans !== 0
        || locked.authorization_count > 1) throw new Error("QA_BOOTSTRAP_DATABASE_NOT_EMPTY");
      if (locked.authorization_count === 0) {
        await db.query(`insert into bootstrap_private.initial_admin_authorization
          (email,nome,token_hash,expires_at) values ($1,$2,$3,clock_timestamp()+interval '10 minutes')`,
        [email, manifest.nome, digest(token)]);
      } else {
        const pending = await db.query(`update bootstrap_private.initial_admin_authorization
          set email=$1, token_hash=$3, created_at=clock_timestamp(), expires_at=clock_timestamp()+interval '10 minutes'
          where singleton=true and nome=$2 and consumed_at is null returning singleton`,
        [email, manifest.nome, digest(token)]);
        if (pending.rowCount !== 1) throw new Error("QA_BOOTSTRAP_STATE_UNRECOGNIZED");
      }
      await db.query("commit");
    } catch (error) { await db.query("rollback").catch(() => {}); throw error; }
    const created = await serviceClient(env).auth.admin.createUser({ email, password, email_confirm: true,
      app_metadata: { [KEY]: token } });
    const after = await dbSnapshot(db);
    if (after.consumed_count !== 1) throw new Error("QA_BOOTSTRAP_AUTH_CREATION_FAILED");
    if (created.data?.user && created.data.user.email !== email) throw new Error("QA_BOOTSTRAP_AUTH_PROOF_FAILED");
    await verifyOwnedExisting(db, env, after, manifest, { completeMfa: true });
    return "CREATED";
  } finally { await db.end().catch(() => {}); }
  } finally { await lock.close(); await rm(LOCK, { force: true }); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  bootstrapProvisioner().then((status) => console.log(`QA_INITIAL_ADMIN_BOOTSTRAP: ${status}`))
    .catch(() => { console.error("QA_INITIAL_ADMIN_BOOTSTRAP: BLOCKED"); process.exitCode = 1; });
}
