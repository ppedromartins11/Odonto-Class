import { createHash } from "node:crypto";
import { withReadOnlyDatabase } from "./0030/lib/database.mjs";

const ACK = "I_ACKNOWLEDGE_FAKE_DATA_ONLY";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const baselines = new WeakMap();
const PAGE_SIZE = 1000;
const MAX_TABLE_ROWS = 250000;
const REQUIRED_TABLES = ["auth.users", "auth.identities", "auth.mfa_factors", "auth.sessions", "storage.objects"];

function targetFingerprint(env) {
  return createHash("sha256").update(env.SUPABASE_TEST_URL).update("\0")
    .update(env.SUPABASE_TEST_DB_URL).digest("hex");
}

export function inspectCleanupTarget(env = process.env) {
  const checks = { acknowledgement: env.SUPABASE_TEST_HOMOLOGATION === ACK, localApi: false, localDatabase: false };
  try {
    const api = new URL(env.SUPABASE_TEST_URL);
    const db = new URL(env.SUPABASE_TEST_DB_URL);
    checks.localApi = LOCAL_HOSTS.has(api.hostname.toLowerCase()) && ["http:", "https:"].includes(api.protocol);
    checks.localDatabase = LOCAL_HOSTS.has(db.hostname.toLowerCase()) && ["postgres:", "postgresql:"].includes(db.protocol);
  } catch { /* Missing or invalid targets fail closed without disclosing URLs. */ }
  return { pass: Object.values(checks).every((value) => value === true), checks };
}

function quoteIdentifier(value) {
  return `"${value.replaceAll('"', '""')}"`;
}

/** In-memory primary-key inventory only: never reads row contents or persists identifiers. */
async function captureSnapshot(client) {
  await client.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
  const catalog = await client.query(`
    select n.nspname as schema_name, c.relname as table_name,
           array_agg(a.attname::text order by key.ordinality) filter (where a.attname is not null) as primary_key
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      left join pg_index i on i.indrelid = c.oid and i.indisprimary
      left join lateral unnest(i.indkey) with ordinality as key(attnum, ordinality) on true
      left join pg_attribute a on a.attrelid = c.oid and a.attnum = key.attnum
     where c.relkind in ('r', 'p') and not c.relispartition
       and (n.nspname = 'public'
         or (n.nspname = 'auth' and c.relname in ('users', 'identities', 'mfa_factors', 'sessions'))
         or (n.nspname = 'storage' and c.relname = 'objects')
         or (n.nspname = 'bootstrap_private' and c.relname = 'initial_admin_authorization'))
     group by n.nspname, c.relname
     order by n.nspname, c.relname
  `);
  const discovered = new Set(catalog.rows.map((row) => `${row.schema_name}.${row.table_name}`));
  if (REQUIRED_TABLES.some((table) => !discovered.has(table))) throw new Error("CLEANUP_REQUIRED_TABLE_MISSING");
  if (!catalog.rows.some((row) => row.schema_name === "public")) throw new Error("CLEANUP_PUBLIC_SCHEMA_EMPTY");
  const snapshot = new Map();
  for (const row of catalog.rows) {
    const table = `${row.schema_name}.${row.table_name}`;
    if (!Array.isArray(row.primary_key) || row.primary_key.length === 0) throw new Error("CLEANUP_PRIMARY_KEY_MISSING");
    const tableSql = `${quoteIdentifier(row.schema_name)}.${quoteIdentifier(row.table_name)}`;
    const keySql = `jsonb_build_array(${row.primary_key.map(quoteIdentifier).join(", ")})::text`;
    const ids = new Set();
    let cursor = null;
    while (true) {
      const page = await client.query(
        `select ${keySql} as inventory_key from ${tableSql}
         where ($1::text is null or ${keySql} collate "C" > $1::text collate "C")
         order by ${keySql} collate "C" limit $2`,
        [cursor, PAGE_SIZE],
      );
      for (const item of page.rows) {
        if (typeof item.inventory_key !== "string" || ids.has(item.inventory_key)) throw new Error("CLEANUP_INVENTORY_INVALID");
        ids.add(item.inventory_key);
      }
      if (ids.size > MAX_TABLE_ROWS) throw new Error("CLEANUP_INVENTORY_LIMIT_EXCEEDED");
      if (page.rows.length < PAGE_SIZE) break;
      cursor = page.rows.at(-1).inventory_key;
    }
    snapshot.set(table, ids);
  }
  return snapshot;
}

/** Compares identities, not content. Only aggregate evidence leaves this function. */
export function compareCleanupSnapshots(baseline, current) {
  if (!(baseline instanceof Map) || !(current instanceof Map) || baseline.size === 0 || current.size === 0) {
    return { status: "BLOCKED", reason: "cleanup_inventory_missing", checks: [] };
  }
  const tables = [...new Set([...baseline.keys(), ...current.keys()])].sort();
  const checks = [];
  for (const table of tables) {
    const before = baseline.get(table);
    const after = current.get(table);
    // Baseline precedes 0030–0032; additive authorization tables must end empty.
    if (before === undefined && ["public.convites_provisionamento", "bootstrap_private.initial_admin_authorization"].includes(table)
      && after instanceof Set && after.size === 0) {
      checks.push({ name: table, status: "PASS", baselineCount: 0, currentCount: 0, addedCount: 0, removedCount: 0,
        reason: "allowlisted_empty_0030_migration_table" });
      continue;
    }
    if (!(before instanceof Set) || !(after instanceof Set)) {
      checks.push({ name: table, status: "FAIL", reason: "table_inventory_changed" });
      continue;
    }
    let addedCount = 0;
    let removedCount = 0;
    for (const id of after) if (!before.has(id)) addedCount++;
    for (const id of before) if (!after.has(id)) removedCount++;
    checks.push({ name: table, status: addedCount === 0 && removedCount === 0 ? "PASS" : "FAIL",
      baselineCount: before.size, currentCount: after.size, addedCount, removedCount,
      ...(table === "auth.sessions" && addedCount ? { reason: "temporary_auth_sessions_residual" } : {}),
    });
  }
  return { status: checks.every((check) => check.status === "PASS") ? "PASS" : "FAIL", checks,
    temporarySessionsResidual: checks.find((check) => check.name === "auth.sessions")?.addedCount ?? 0,
    evidence: "primary_key_identity_preservation_and_no_added_rows", contentCompared: false,
  };
}

export async function captureCleanupBaseline(env = process.env) {
  const guard = inspectCleanupTarget(env);
  if (!guard.pass) return { status: "BLOCKED", reason: "cleanup_requires_acknowledged_loopback_target", guard, tables: [] };
  try {
    const snapshot = await withReadOnlyDatabase(env.SUPABASE_TEST_DB_URL, captureSnapshot);
    const baseline = { status: "PASS", tables: [...snapshot].map(([table, ids]) => ({ table, rowCount: ids.size })) };
    baselines.set(baseline, { snapshot, target: targetFingerprint(env) });
    return baseline;
  } catch {
    return { status: "BLOCKED", reason: "cleanup_baseline_query_or_primary_key_failed", tables: [] };
  }
}

export async function verifyCleanup(env = process.env, baseline) {
  const guard = inspectCleanupTarget(env);
  if (!guard.pass) return { status: "BLOCKED", reason: "cleanup_requires_acknowledged_loopback_target", checks: [] };
  const privateBaseline = baseline && baselines.get(baseline);
  if (!privateBaseline || privateBaseline.target !== targetFingerprint(env)) {
    return { status: "BLOCKED", reason: "cleanup_baseline_missing_or_target_changed", checks: [] };
  }
  try {
    const current = await withReadOnlyDatabase(env.SUPABASE_TEST_DB_URL, captureSnapshot);
    return compareCleanupSnapshots(privateBaseline.snapshot, current);
  } catch {
    return { status: "FAIL", reason: "cleanup_verification_query_or_primary_key_failed", checks: [] };
  }
}
