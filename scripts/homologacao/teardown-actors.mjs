import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { createClient } from "@supabase/supabase-js";
import { ROOT } from "./lib/env.mjs";
import { assertGuard } from "./lib/safety.mjs";
import { readLinkedProjectRef } from "./0030/config.mjs";
import { readBootstrapEnvironment } from "./bootstrap-provisioner.mjs";

const QA = "zxvpyxvhymuibaxgxetf";
const CONFIRMATION = "REMOVE_OWNED_QA_ACTORS";
const MANIFEST = resolve(ROOT, "artifacts/homologacao/qa-actors.json");
const PROOF = resolve(ROOT, "artifacts/homologacao/qa-actors-cleanup-proof.json");
const LOCK = resolve(ROOT, "artifacts/homologacao/qa-actors.lock");
const ENV_FILE = resolve(ROOT, ".env.homologacao.local");
const actorKeys = ["QA_ADMIN", "QA_DENTISTA_A", "QA_DENTISTA_B", "QA_RECEPCAO"];

async function saveJson(path, value) {
  const temp = `${path}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2), { mode: 0o600, flag: "wx" });
  await rename(temp, path);
}
function entity(actor, type) {
  return actor.entities?.filter((item) => item.entity_type === type) ?? [];
}
function requireOne(actor, type) {
  const rows = entity(actor, type);
  if (rows.length !== 1) throw new Error("QA_ACTOR_OWNERSHIP_INCOMPLETE");
  return rows[0];
}
async function actorState(db, actor) {
  const auth = requireOne(actor, "auth.users");
  const profile = requireOne(actor, "public.usuarios");
  const audit = requireOne(actor, "public.auditoria");
  if (auth.entity_id !== profile.entity_id || actor.authUserId !== auth.entity_id)
    throw new Error("QA_ACTOR_OWNERSHIP_INCONSISTENT");
  const result = await db.query(`select
    (select count(*)::int from auth.users where id=$1) auth_count,
    (select count(*)::int from public.usuarios where id=$1) profile_count,
    (select count(*)::int from auth.identities where user_id=$1) identity_count,
    (select count(*)::int from auth.mfa_factors where user_id=$1) factor_count,
    (select count(*)::int from public.profissionais where usuario_id=$1) professional_count,
    (select count(*)::int from public.auditoria where usuario_id=$1) actor_audit_count,
    (select count(*)::int from public.auditoria where id=$2 and usuario_id=$3
      and entidade='usuarios' and entidade_id=$1 and evento='usuario_convidado') owned_audit_count`,
  [auth.entity_id, audit.entity_id, auth.created_by]);
  return result.rows[0];
}
async function verifyOwnedActor(db, actor, manifest) {
  const auth = requireOne(actor, "auth.users");
  const profile = requireOne(actor, "public.usuarios");
  if (auth.runId !== manifest.runId || profile.runId !== manifest.runId
    || auth.created_by !== manifest.bootstrapId || profile.created_by !== manifest.bootstrapId)
    throw new Error("QA_ACTOR_OWNERSHIP_INCONSISTENT");
  if (!actor.name?.startsWith(actor.key) || !actor.emailSha256 || actor.status !== "active")
    throw new Error("QA_ACTOR_MANIFEST_INVALID");
  const row = await db.query(`select a.id, a.created_at, u.nome, u.perfil::text perfil, u.status::text status,
    p.id professional_id, p.registro_profissional, p.status::text professional_status,
    p.created_at professional_created_at, p.updated_at professional_updated_at
    from auth.users a join public.usuarios u on u.id=a.id
    left join public.profissionais p on p.usuario_id=u.id where a.id=$1`, [auth.entity_id]);
  if (row.rowCount === 0) return null;
  const found = row.rows[0];
  if (found.nome !== actor.name || found.perfil !== actor.role || found.status !== "ativo"
    || new Date(found.created_at).toISOString() !== new Date(auth.created_at).toISOString()
    || (actor.role !== "dentista" && !!found.professional_id))
    throw new Error("QA_ACTOR_REMOTE_STATE_UNRECOGNIZED");
  if (found.professional_id && found.professional_id !== requireOne(actor, "public.profissionais").entity_id)
    throw new Error("QA_ACTOR_REMOTE_STATE_UNRECOGNIZED");
  for (const item of entity(actor, "auth.identities")) {
    const identity = await db.query("select id from auth.identities where id=$1 and user_id=$2", [item.entity_id, auth.entity_id]);
    if (identity.rowCount !== 1) throw new Error("QA_ACTOR_IDENTITY_UNRECOGNIZED");
  }
  if ((await actorState(db, actor)).factor_count !== 0) throw new Error("QA_ACTOR_MFA_FACTOR_PRESENT");
  return found;
}
async function removeProfessional(db, actor, found) {
  if (!found?.professional_id) return;
  const owned = requireOne(actor, "public.profissionais");
  await db.query("begin");
  try {
    const deleted = await db.query("delete from public.profissionais where id=$1 and usuario_id=$2 returning id",
      [owned.entity_id, actor.authUserId]);
    if (deleted.rowCount !== 1) throw new Error("QA_ACTOR_PROFESSIONAL_CLEANUP_FAILED");
    await db.query("commit");
  } catch (error) { await db.query("rollback").catch(() => {}); throw error; }
}
async function restoreProfessional(db, actor, found) {
  if (actor.role !== "dentista") return;
  const exists = await db.query("select id from auth.users where id=$1", [actor.authUserId]);
  if (exists.rowCount !== 1) return;
  const owned = requireOne(actor, "public.profissionais");
  const current = await db.query("select id from public.profissionais where id=$1 and usuario_id=$2",
    [owned.entity_id, actor.authUserId]);
  if (current.rowCount === 1) return;
  const restored = await db.query(`insert into public.profissionais
    (id,usuario_id,registro_profissional,status,created_at,updated_at)
    values ($1,$2,$3,$4,$5,$6) on conflict (id) do nothing returning id`,
  [owned.entity_id, actor.authUserId, found.registro_profissional ?? null,
    found.professional_status ?? "ativo", found.professional_created_at ?? owned.created_at,
    found.professional_updated_at ?? new Date().toISOString()]);
  if (restored.rowCount !== 1) throw new Error("QA_ACTOR_PROFESSIONAL_RESTORE_FAILED");
}
async function removeActor(db, service, actor, manifest) {
  const found = await verifyOwnedActor(db, actor, manifest);
  let state = await actorState(db, actor);
  if (found) {
    if (state.auth_count !== 1 || state.profile_count !== 1 || state.owned_audit_count !== 1
      || state.actor_audit_count !== 0
      || state.identity_count !== entity(actor, "auth.identities").length)
      throw new Error("QA_ACTOR_CLEANUP_PRECONDITION_FAILED");
    try {
      await removeProfessional(db, actor, found);
      const deleted = await service.auth.admin.deleteUser(actor.authUserId);
      state = await actorState(db, actor);
      if (state.auth_count !== 0 || state.profile_count !== 0 || state.identity_count !== 0
        || state.actor_audit_count !== 0 || deleted.error)
        throw new Error("QA_ACTOR_AUTH_DELETE_FAILED");
    } catch {
      try { await restoreProfessional(db, actor, found); }
      catch { throw new Error("QA_ACTOR_PROFESSIONAL_RESTORE_FAILED"); }
      throw new Error("QA_ACTOR_AUTH_DELETE_FAILED");
    }
  } else if (state.auth_count !== 0 || state.profile_count !== 0 || state.identity_count !== 0
    || state.professional_count !== 0) {
    throw new Error("QA_ACTOR_PARTIAL_STATE_UNRECOGNIZED");
  }
  const audit = requireOne(actor, "public.auditoria");
  if (state.owned_audit_count === 1) {
    const removedAudit = await db.query(`delete from public.auditoria
      where id=$1 and usuario_id=$2 and entidade='usuarios' and entidade_id=$3
        and evento='usuario_convidado' returning id`,
    [audit.entity_id, manifest.bootstrapId, actor.authUserId]);
    if (removedAudit.rowCount !== 1) throw new Error("QA_ACTOR_AUDIT_CLEANUP_FAILED");
  } else if (state.owned_audit_count !== 0) throw new Error("QA_ACTOR_AUDIT_OWNERSHIP_UNRECOGNIZED");
  actor.status = "deleted";
  actor.deletedAt = new Date().toISOString();
  actor.entities = actor.entities.map((item) => ({ ...item, deleted_at: item.deleted_at ?? actor.deletedAt }));
  manifest.actors[actor.key] = actor;
  await saveJson(MANIFEST, manifest);
}
async function proof(db, manifest) {
  const result = await db.query(`select
    (select count(*)::int from auth.users) auth_count,
    (select count(*)::int from public.usuarios) profile_count,
    (select count(*)::int from public.profissionais) professional_count,
    (select count(*)::int from public.convites_provisionamento) invitation_count,
    (select count(*)::int from auth.mfa_factors) factor_count`);
  const counts = result.rows[0];
  if (counts.auth_count !== 1 || counts.profile_count !== 1 || counts.professional_count !== 0
    || counts.invitation_count !== 0 || counts.factor_count !== 0) throw new Error("QA_ACTOR_CLEANUP_PROOF_FAILED");
  for (const key of actorKeys) {
    const actor = manifest.actors[key];
    if (actor.status !== "deleted") throw new Error("QA_ACTOR_CLEANUP_PROOF_FAILED");
    for (const item of actor.entities) {
      const table = item.entity_type;
      if (!["auth.users", "auth.identities", "public.usuarios", "public.profissionais",
        "public.auditoria", "public.convites_provisionamento"].includes(table))
        throw new Error("QA_ACTOR_MANIFEST_ENTITY_INVALID");
      const remaining = await db.query(`select 1 from ${table} where id=$1 limit 1`, [item.entity_id]);
      if (remaining.rowCount !== 0) throw new Error("QA_ACTOR_CLEANUP_PROOF_FAILED");
    }
  }
  return counts;
}

export async function teardownActors(env = readBootstrapEnvironment()) {
  assertGuard(env, readLinkedProjectRef(), "remote");
  if (process.env.HOMOLOGATION_ACTOR_TEARDOWN_CONFIRM !== CONFIRMATION)
    throw new Error("QA_ACTOR_TEARDOWN_CONFIRMATION_REQUIRED");
  if (!env.SUPABASE_TEST_SERVICE_ROLE_KEY) throw new Error("QA_ACTOR_SERVICE_KEY_REQUIRED");
  await mkdir(resolve(ROOT, "artifacts/homologacao"), { recursive: true });
  let lock;
  try { lock = await open(LOCK, "wx", 0o600); }
  catch { throw new Error("QA_ACTOR_OPERATION_ALREADY_RUNNING"); }
  try {
    const manifest = JSON.parse(await readFile(MANIFEST, "utf8"));
    if (manifest.projectRef !== QA || !manifest.runId || !manifest.bootstrapId
      || !actorKeys.every((key) => manifest.actors?.[key])) throw new Error("QA_ACTOR_MANIFEST_INVALID");
    const db = new Client({ connectionString: env.SUPABASE_TEST_DB_URL, connectionTimeoutMillis: 8000,
      application_name: "odonto-qa-owned-actor-teardown" });
    await db.connect();
    try {
      const service = createClient(env.SUPABASE_TEST_URL, env.SUPABASE_TEST_SERVICE_ROLE_KEY,
        { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
      for (const key of [...actorKeys].reverse()) {
        const actor = manifest.actors[key];
        if (actor.status === "deleted") continue;
        await removeActor(db, service, actor, manifest);
      }
      const counts = await proof(db, manifest);
      manifest.status = "deleted";
      manifest.cleanupProofAt = new Date().toISOString();
      await saveJson(MANIFEST, manifest);
      await saveJson(PROOF, { runId: manifest.runId, status: "PASS", projectRef: QA,
        checkedAt: manifest.cleanupProofAt, actorCount: actorKeys.length,
        ownedEntities: actorKeys.reduce((count, key) => count + manifest.actors[key].entities.length, 0),
        remainingOwnedEntities: 0, counts });
      const source = await readFile(ENV_FILE, "utf8");
      const cleaned = source.split(/\r?\n/).filter((line) => !/^HOMOLOGATION_(ADMIN|DENTIST_A|DENTIST_B|RECEPTION)_(EMAIL|PASSWORD)=/.test(line));
      const temp = `${ENV_FILE}.${randomUUID()}.tmp`;
      await writeFile(temp, `${cleaned.join("\n").trimEnd()}\n`, { mode: 0o600, flag: "wx" });
      await rename(temp, ENV_FILE);
      return "PASS";
    } finally { await db.end().catch(() => {}); }
  } finally { await lock.close(); await rm(LOCK, { force: true }); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  teardownActors().then((status) => console.log(`QA_ACTOR_CLEANUP: ${status}`))
    .catch(() => { console.error("QA_ACTOR_CLEANUP: BLOCKED"); process.exitCode = 1; });
}
