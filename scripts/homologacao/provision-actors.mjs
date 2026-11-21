import { createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { Client } from "pg";
import { createClient } from "@supabase/supabase-js";
import { ROOT } from "./lib/env.mjs";
import { assertGuard } from "./lib/safety.mjs";
import { readLinkedProjectRef } from "./0030/config.mjs";
import { readBootstrapEnvironment, cleanupOwnedMfa, proveTemporaryMfa } from "./bootstrap-provisioner.mjs";

const QA = "zxvpyxvhymuibaxgxetf";
const CONFIRMATION = "PROVISION_SYNTHETIC_QA_ACTORS";
const ENV_FILE = resolve(ROOT, ".env.homologacao.local");
const BOOTSTRAP_MANIFEST = resolve(ROOT, "artifacts/homologacao/bootstrap-provisioner.json");
const MANIFEST = resolve(ROOT, "artifacts/homologacao/qa-actors.json");
const LOCK = resolve(ROOT, "artifacts/homologacao/qa-actors.lock");
const definitions = [
  { key: "QA_ADMIN", role: "administrador", emailKey: "HOMOLOGATION_ADMIN_EMAIL", passwordKey: "HOMOLOGATION_ADMIN_PASSWORD" },
  { key: "QA_DENTISTA_A", role: "dentista", emailKey: "HOMOLOGATION_DENTIST_A_EMAIL", passwordKey: "HOMOLOGATION_DENTIST_A_PASSWORD" },
  { key: "QA_DENTISTA_B", role: "dentista", emailKey: "HOMOLOGATION_DENTIST_B_EMAIL", passwordKey: "HOMOLOGATION_DENTIST_B_PASSWORD" },
  { key: "QA_RECEPCAO", role: "recepcao", emailKey: "HOMOLOGATION_RECEPTION_EMAIL", passwordKey: "HOMOLOGATION_RECEPTION_PASSWORD" },
];

export function assertOwnedActorIdentity(row, actor, definition, manifest) {
  if (!row || row.nome !== actor.name || row.perfil !== definition.role || row.status !== "ativo"
    || !Number.isFinite(Date.parse(row.created_at))
    || Date.parse(row.created_at) < Date.parse(manifest.databaseStartedAt)
    || (actor.authUserId && actor.authUserId !== row.id))
    throw new Error("QA_ACTOR_EXISTING_IDENTITY_UNOWNED");
}

export function assertOwnedInvitation(invitation, actor, bootstrapId, authId) {
  if (!invitation || invitation.id !== actor.invitationId || invitation.created_by !== bootstrapId
    || !invitation.consumed_at || invitation.usuario_id !== authId)
    throw new Error("QA_ACTOR_INVITATION_UNOWNED");
}

function hash(value) { return createHash("sha256").update(value).digest("hex"); }
async function atomicJson(path, value) {
  const temp = `${path}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2), { mode: 0o600, flag: "wx" });
  await rename(temp, path);
}
async function saveCredentials(actors) {
  const source = await readFile(ENV_FILE, "utf8");
  const keys = new Set(definitions.flatMap(({ emailKey, passwordKey }) => [emailKey, passwordKey]));
  const lines = source.split(/\r?\n/).filter((line) => !keys.has(line.split("=")[0]));
  for (const definition of definitions) {
    const actor = actors[definition.key];
    lines.push(`${definition.emailKey}=${actor.email}`);
    lines.push(`${definition.passwordKey}=${actor.password}`);
  }
  const temp = `${ENV_FILE}.${randomUUID()}.tmp`;
  await writeFile(temp, `${lines.join("\n").trimEnd()}\n`, { mode: 0o600, flag: "wx" });
  await rename(temp, ENV_FILE);
}
function client(url, key) {
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}
async function readRows(db) {
  return (await db.query(`select a.id, lower(a.email) email, a.email_confirmed_at,
      a.created_at auth_created_at, a.raw_user_meta_data,
      u.nome, u.perfil::text perfil, u.status::text status, u.created_at profile_created_at,
      p.id professional_id, p.created_at professional_created_at
      from auth.users a left join public.usuarios u on u.id=a.id
      left join public.profissionais p on p.usuario_id=u.id order by a.created_at`)).rows;
}
function ownedRecord(runId, entityType, entityId, createdBy, createdAt) {
  return { runId, entity_type: entityType, entity_id: entityId, created_by: createdBy, created_at: createdAt };
}
async function proveActor(db, env, definition, actor, bootstrapId, manifest) {
  const rows = await db.query(`select a.id, lower(a.email) email, a.email_confirmed_at,
      a.created_at auth_created_at, a.raw_user_meta_data,
      u.nome, u.perfil::text perfil, u.status::text status, u.created_at profile_created_at,
      p.id professional_id, p.created_at professional_created_at
      from auth.users a join public.usuarios u on u.id=a.id
      left join public.profissionais p on p.usuario_id=u.id where lower(a.email)=$1`, [actor.email]);
  const row = rows.rows[0];
  if (rows.rowCount !== 1 || row.nome !== actor.name || row.perfil !== definition.role
    || row.status !== "ativo" || !row.email_confirmed_at || row.raw_user_meta_data?.provisioning_token
    || (definition.role === "dentista") !== !!row.professional_id
    || (actor.authUserId && actor.authUserId !== row.id)) throw new Error("QA_ACTOR_PROOF_FAILED");
  const session = client(env.SUPABASE_TEST_URL, env.SUPABASE_TEST_ANON_KEY);
  const signed = await session.auth.signInWithPassword({ email: actor.email, password: actor.password });
  if (signed.error || signed.data.user?.id !== row.id) throw new Error("QA_ACTOR_LOGIN_FAILED");
  await session.auth.signOut();
  const identities = await db.query("select id, created_at from auth.identities where user_id=$1", [row.id]);
  const audits = await db.query(`select id, created_at from public.auditoria
    where usuario_id=$1 and entidade='usuarios' and entidade_id=$2 and evento='usuario_convidado'`,
  [bootstrapId, row.id]);
  if (identities.rowCount < 1 || audits.rowCount !== 1
    || Date.parse(audits.rows[0].created_at) < Date.parse(manifest.databaseStartedAt))
    throw new Error("QA_ACTOR_AUXILIARY_OWNERSHIP_UNVERIFIED");
  actor.authUserId = row.id;
  actor.status = "active";
  actor.entities = [
    ownedRecord(manifest.runId, "auth.users", row.id, bootstrapId, row.auth_created_at),
    ownedRecord(manifest.runId, "public.usuarios", row.id, bootstrapId, row.profile_created_at),
    ...identities.rows.map((identity) => ownedRecord(manifest.runId, "auth.identities",
      identity.id, bootstrapId, identity.created_at)),
    ownedRecord(manifest.runId, "public.auditoria", audits.rows[0].id, bootstrapId, audits.rows[0].created_at),
    ...(row.professional_id ? [ownedRecord(manifest.runId, "public.profissionais", row.professional_id, bootstrapId, row.professional_created_at)] : []),
    ...(actor.entities ?? []).filter((entity) => entity.entity_type === "public.convites_provisionamento"),
  ];
  manifest.actors[definition.key] = { ...actor, email: undefined, password: undefined };
  await atomicJson(MANIFEST, manifest);
}
async function readInvitation(db, email) {
  const result = await db.query("select id, created_by, created_at, consumed_at, usuario_id from public.convites_provisionamento where email=$1", [email]);
  return result.rows[0] ?? null;
}
async function provisionOne(db, env, service, admin, bootstrapId, definition, actor, manifest) {
  const existing = (await db.query(`select a.id, a.created_at, u.nome, u.perfil::text perfil, u.status::text status
    from auth.users a left join public.usuarios u on u.id=a.id where lower(a.email)=$1`, [actor.email])).rows[0];
  if (existing) assertOwnedActorIdentity(existing, actor, definition, manifest);
  let invitation = await readInvitation(db, actor.email);
  if (invitation && (invitation.created_by !== bootstrapId || invitation.id !== actor.invitationId))
    throw new Error("QA_ACTOR_INVITATION_UNOWNED");
  if (existing && !actor.authUserId && (!invitation?.consumed_at || invitation.usuario_id !== existing.id))
    throw new Error("QA_ACTOR_EXISTING_IDENTITY_UNOWNED");
  if (existing && actor.status === "active" && !invitation) {
    await proveActor(db, env, definition, actor, bootstrapId, manifest);
    return;
  }
  if (!existing) {
    if (invitation) {
      if (invitation.consumed_at) throw new Error("QA_ACTOR_INVITATION_STATE_INVALID");
      const removed = await service.from("convites_provisionamento").delete().eq("id", invitation.id);
      if (removed.error) throw new Error("QA_ACTOR_INVITATION_CLEANUP_FAILED");
      actor.invitationId = undefined;
      actor.invitationCreatedAt = undefined;
      actor.entities = (actor.entities ?? []).map((entity) => entity.entity_type === "public.convites_provisionamento"
        && entity.entity_id === invitation.id ? { ...entity, deleted_at: new Date().toISOString() } : entity);
      manifest.actors[definition.key] = { ...actor, email: undefined, password: undefined };
      await atomicJson(MANIFEST, manifest);
    }
    const prepared = await admin.rpc("prepare_user_invitation", {
      p_email: actor.email, p_nome: actor.name, p_perfil: definition.role,
    });
    if (prepared.error || !prepared.data?.id || !prepared.data?.token) throw new Error("QA_ACTOR_INVITATION_FAILED");
    invitation = await readInvitation(db, actor.email);
    if (!invitation || invitation.id !== prepared.data.id || invitation.created_by !== bootstrapId)
      throw new Error("QA_ACTOR_INVITATION_PROOF_FAILED");
    actor.invitationId = invitation.id;
    actor.invitationCreatedAt = invitation.created_at;
    actor.entities = [...(actor.entities ?? []), ownedRecord(manifest.runId,
      "public.convites_provisionamento", invitation.id, bootstrapId, invitation.created_at)];
    manifest.actors[definition.key] = { ...actor, email: undefined, password: undefined };
    await atomicJson(MANIFEST, manifest);
    const generated = await service.auth.admin.generateLink({ type: "invite", email: actor.email,
      options: { data: { provisioning_token: prepared.data.token } } });
    if (generated.error || !generated.data?.user) {
      const check = (await db.query("select id from auth.users where lower(email)=$1", [actor.email])).rows[0];
      if (!check) throw new Error("QA_ACTOR_AUTH_CREATION_FAILED");
    }
  }
  const row = (await db.query(`select a.id, a.created_at, u.nome, u.perfil::text perfil, u.status::text status
    from auth.users a left join public.usuarios u on u.id=a.id where lower(a.email)=$1`, [actor.email])).rows[0];
  assertOwnedActorIdentity(row, actor, definition, manifest);
  invitation = await readInvitation(db, actor.email);
  assertOwnedInvitation(invitation, actor, bootstrapId, row.id);
  const updated = await service.auth.admin.updateUserById(row.id, { password: actor.password, email_confirm: true });
  if (updated.error || updated.data?.user?.id !== row.id) throw new Error("QA_ACTOR_PASSWORD_SETUP_FAILED");
  await proveActor(db, env, definition, actor, bootstrapId, manifest);
  if (invitation) {
    if (invitation.created_by !== bootstrapId || invitation.id !== actor.invitationId
      || invitation.usuario_id !== actor.authUserId) throw new Error("QA_ACTOR_INVITATION_UNOWNED");
    const removed = await service.from("convites_provisionamento").delete().eq("id", invitation.id);
    if (removed.error) throw new Error("QA_ACTOR_INVITATION_CLEANUP_FAILED");
    actor.invitationDeleted = true;
    actor.entities = actor.entities.map((entity) => entity.entity_type === "public.convites_provisionamento"
      && entity.entity_id === invitation.id ? { ...entity, deleted_at: new Date().toISOString() } : entity);
    manifest.actors[definition.key] = { ...actor, email: undefined, password: undefined };
    await atomicJson(MANIFEST, manifest);
  }
}

export async function provisionActors(env = readBootstrapEnvironment()) {
  assertGuard(env, readLinkedProjectRef(), "remote");
  if (process.env.HOMOLOGATION_ACTORS_CONFIRM !== CONFIRMATION) throw new Error("QA_ACTOR_CONFIRMATION_REQUIRED");
  if (!env.SUPABASE_TEST_SERVICE_ROLE_KEY || !env.SUPABASE_TEST_ANON_KEY)
    throw new Error("QA_ACTOR_AUTH_KEYS_REQUIRED");
  await mkdir(resolve(ROOT, "artifacts/homologacao"), { recursive: true });
  let lock;
  try { lock = await open(LOCK, "wx", 0o600); }
  catch { throw new Error("QA_ACTOR_PROVISION_ALREADY_RUNNING"); }
  try {
    const db = new Client({ connectionString: env.SUPABASE_TEST_DB_URL, connectionTimeoutMillis: 8000,
      application_name: "odonto-qa-actor-provisioner" });
    await db.connect();
    try {
      const versions = (await db.query("select version::text from supabase_migrations.schema_migrations order by version")).rows.map((row) => row.version);
      if (versions.length !== 33 || versions.some((version, index) => version !== String(index + 1).padStart(4, "0")))
        throw new Error("QA_ACTOR_MIGRATION_GATE_FAILED");
      const bootstrap = JSON.parse(await readFile(BOOTSTRAP_MANIFEST, "utf8"));
      if (bootstrap.kind !== "initial_admin_provisioner" || bootstrap.projectRef !== QA || bootstrap.status !== "active" || !bootstrap.authUserId)
        throw new Error("QA_ACTOR_BOOTSTRAP_UNVERIFIED");
      const credentials = parseEnv(readFileSync(ENV_FILE, "utf8"));
      const bootstrapRow = (await db.query(`select u.id from public.usuarios u join auth.users a on a.id=u.id
        join bootstrap_private.initial_admin_authorization b on b.usuario_id=u.id
        where u.id=$1 and u.perfil='administrador' and u.status='ativo'
          and lower(a.email)=$2`, [bootstrap.authUserId, credentials.SUPABASE_TEST_ADMIN_EMAIL?.toLowerCase()])).rows[0];
      if (!bootstrapRow || !credentials.SUPABASE_TEST_ADMIN_PASSWORD) throw new Error("QA_ACTOR_BOOTSTRAP_UNVERIFIED");
      const settings = await fetch(new URL("/auth/v1/settings", env.SUPABASE_TEST_URL), {
        headers: { apikey: env.SUPABASE_TEST_ANON_KEY }, signal: AbortSignal.timeout(8000),
      }).then((response) => response.ok ? response.json() : null).catch(() => null);
      if (settings?.disable_signup !== true && settings?.disable_signups !== true)
        throw new Error("QA_ACTOR_PUBLIC_SIGNUP_NOT_DISABLED");
      let manifest = existsSync(MANIFEST) ? JSON.parse(await readFile(MANIFEST, "utf8")) : null;
      let actors = {};
      if (!manifest) {
        if (definitions.some(({ emailKey, passwordKey }) => credentials[emailKey] || credentials[passwordKey]))
          throw new Error("QA_ACTOR_LOCAL_STATE_UNOWNED");
        const rows = await readRows(db);
        if (rows.length !== 1 || rows[0].id !== bootstrap.authUserId) throw new Error("QA_ACTOR_DATABASE_NOT_EMPTY");
        for (const definition of definitions) {
          const email = `qa_${definition.key.toLowerCase()}_${randomUUID()}@example.test`;
          actors[definition.key] = { key: definition.key, name: `${definition.key}_${randomUUID()}`,
            role: definition.role, email, password: `Qa-${randomBytes(32).toString("base64url")}-9!`,
            status: "prepared", emailSha256: hash(email), entities: [] };
        }
        const dbStarted = await db.query("select clock_timestamp() as started_at");
        manifest = { projectRef: QA, runId: randomUUID(), bootstrapId: bootstrap.authUserId,
          status: "prepared", createdAt: new Date().toISOString(), databaseStartedAt: dbStarted.rows[0].started_at,
          actors: Object.fromEntries(
            Object.entries(actors).map(([key, actor]) => [key, { ...actor, email: undefined, password: undefined }])) };
        await atomicJson(MANIFEST, manifest);
        await saveCredentials(actors);
      } else {
        if (manifest.projectRef !== QA || manifest.bootstrapId !== bootstrap.authUserId || !manifest.runId
          || !Number.isFinite(Date.parse(manifest.databaseStartedAt)))
          throw new Error("QA_ACTOR_MANIFEST_INVALID");
        for (const definition of definitions) {
          const actor = manifest.actors?.[definition.key];
          const email = credentials[definition.emailKey]?.toLowerCase();
          const password = credentials[definition.passwordKey];
          if (!actor || !email || !password || actor.role !== definition.role || hash(email) !== actor.emailSha256)
            throw new Error("QA_ACTOR_LOCAL_STATE_UNRECOGNIZED");
          actors[definition.key] = { ...actor, email, password };
        }
      }
      const existingRows = await readRows(db);
      const allowedEmails = new Set([credentials.SUPABASE_TEST_ADMIN_EMAIL.toLowerCase(), ...Object.values(actors).map((actor) => actor.email)]);
      if (existingRows.some((row) => !allowedEmails.has(row.email))) throw new Error("QA_ACTOR_UNKNOWN_AUTH_USER");
      const service = client(env.SUPABASE_TEST_URL, env.SUPABASE_TEST_SERVICE_ROLE_KEY);
      const admin = client(env.SUPABASE_TEST_URL, env.SUPABASE_TEST_ANON_KEY);
      const signed = await admin.auth.signInWithPassword({ email: credentials.SUPABASE_TEST_ADMIN_EMAIL,
        password: credentials.SUPABASE_TEST_ADMIN_PASSWORD });
      if (signed.error || signed.data.user?.id !== bootstrap.authUserId) throw new Error("QA_ACTOR_ADMIN_LOGIN_FAILED");
      await cleanupOwnedMfa(service, bootstrap.authUserId, manifest);
      if (!manifest.mfaStartedAt) {
        manifest.mfaStartedAt = new Date().toISOString();
        manifest.mfaFactorName = `QA bootstrap ${randomBytes(16).toString("hex")}`;
        await atomicJson(MANIFEST, manifest);
      }
      await proveTemporaryMfa(admin, service, bootstrap.authUserId, manifest.mfaFactorName,
        async (factorId) => { manifest.mfaFactorId = factorId; await atomicJson(MANIFEST, manifest); },
        async (aal2) => {
          for (const definition of definitions) {
            const actor = actors[definition.key];
            await provisionOne(db, env, service, aal2, bootstrap.authUserId, definition, actor, manifest);
            manifest.actors[definition.key] = { ...actor, email: undefined, password: undefined };
            await atomicJson(MANIFEST, manifest);
          }
        });
      const residualFactors = await db.query("select count(*)::int as count from auth.mfa_factors where user_id=$1", [bootstrap.authUserId]);
      if (residualFactors.rows[0].count !== 0) throw new Error("QA_ACTOR_MFA_CLEANUP_FAILED");
      manifest.status = "active";
      await atomicJson(MANIFEST, manifest);
      return "PASS";
    } finally { await db.end().catch(() => {}); }
  } finally { await lock.close(); await rm(LOCK, { force: true }); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  provisionActors().then((result) => console.log(`QA_ACTOR_PROVISIONING: ${result}`))
    .catch(() => { console.error("QA_ACTOR_PROVISIONING: BLOCKED"); process.exitCode = 1; });
}
