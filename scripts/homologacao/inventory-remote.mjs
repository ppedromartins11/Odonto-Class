import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { inventoryDigest } from "./inventory-digest.mjs";
import { readEnvironment, ROOT } from "./lib/env.mjs";
import { projectGuard } from "./lib/safety.mjs";
import { readLinkedProjectRef } from "./0030/config.mjs";
import { withReadOnlyDatabase, readDatabasePreflight } from "./0030/lib/database.mjs";
import { readSignupStatus } from "./remote-checks.mjs";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const IDENTITY = new RegExp(`^qa_(trat|usr|odo)_(administrador|dentista|recepcao)_(${UUID})@example\\.com$`, "i");
const ADMIN = new RegExp(`^qa_rc_admin-(${UUID})@example\\.com$`, "i");
const FIXTURES = [
  ["QA_ADMIN", "HOMOLOGATION_ADMIN_EMAIL", "administrador"],
  ["QA_DENTISTA_A", "HOMOLOGATION_DENTIST_A_EMAIL", "dentista"],
  ["QA_DENTISTA_B", "HOMOLOGATION_DENTIST_B_EMAIL", "dentista"],
  ["QA_RECEPCAO", "HOMOLOGATION_RECEPTION_EMAIL", "recepcao"],
];
const q = value => `"${String(value).replaceAll('"', '""')}"`;
const tableKey = (schema, table) => `${schema}.${table}`;
const BOUND = 10_000;

// These are origin classifications, never grants of permission to delete.
export function classifyIdentity({ name, email, role, protectedFixture = false }) {
  if (protectedFixture) return { classification: "NON_QA", reason: "protected_current_fixture" };
  const admin = ADMIN.exec(email ?? "");
  if (admin && name === `QA_RC_ADMIN_${admin[1]}` && role === "administrador") {
    return { classification: "OWNERSHIP_CONFIRMED", reason: "reserved_identity_and_exact_admin_uuid_pair", source: "tests/integration/helpers.ts" };
  }
  const match = IDENTITY.exec(email ?? "");
  if (match && role === match[2] && name === `QA_${match[1].toUpperCase()}_${match[2]}_${match[3]}`) {
    return { classification: "OWNERSHIP_CONFIRMED", reason: "reserved_identity_and_exact_suite_role_uuid_pair", source: match[1] === "trat" ? "tests/integration/treatment-plans.authorization.test.ts" : match[1] === "usr" ? "tests/integration/users-professional-profile.authorization.test.ts" : "tests/integration/odontogram.authorization.test.ts" };
  }
  // A renamed profile loses the independently matching UUID. Do not use
  // editable user_metadata or a subsequent activation event to recover it.
  return { classification: /^QA[_ ]/.test(name ?? "") ? "OWNERSHIP_PROBABLE" : "OWNERSHIP_UNKNOWN",
    reason: match ? "reserved_suite_identity_but_profile_uuid_pair_missing" : "exclusive_fixture_identity_not_proven" };
}

export function classifyBusiness({ table, exactSuiteMarker, createdBy, identities }) {
  const actor = identities.get(createdBy);
  if (exactSuiteMarker && actor?.classification === "OWNERSHIP_CONFIRMED") {
    return { classification: "OWNERSHIP_CONFIRMED", reason: "exclusive_odontogram_uuid_marker_and_confirmed_qa_creator",
      source: "tests/integration/odontogram.authorization.test.ts", creatorClassification: actor.classification };
  }
  return { classification: "OWNERSHIP_PROBABLE", reason: exactSuiteMarker ? "creator_ownership_not_confirmed" : "prefix_without_exclusive_creation_evidence", table };
}

export function summarizeDryRun(records, uncertainties = []) {
  const ambiguous = records.filter(r => ["OWNERSHIP_PROBABLE", "OWNERSHIP_UNKNOWN"].includes(r.classification));
  const nonQa = records.filter(r => r.classification === "NON_QA");
  const confirmed = records.filter(r => r.classification === "OWNERSHIP_CONFIRMED");
  return {
    ownership: ambiguous.length || uncertainties.length ? "BLOCKED" : "PASS",
    cleanup: "NOT EXECUTED", cleanupGate: "BLOCKED",
    SAFE_TO_DELETE_CONFIRMED_QA: 0,
    CONFIRMED_QA_ORIGIN: confirmed.length,
    BLOCKED_UNKNOWN_OWNERSHIP: ambiguous.length,
    NON_QA: nonQa.length,
    uncertainties,
    reason: "read_only_inventory_does_not_authorize_or_execute_deletion",
  };
}

async function metadata(client) {
  const columns = (await client.query(`select table_schema as schema,table_name,column_name,data_type
    from information_schema.columns where table_schema in ('public','auth','storage')
    order by table_schema,table_name,ordinal_position`)).rows;
  const fks = (await client.query(`select co.conname,ns.nspname as schema,cl.relname as table_name,
    nt.nspname as target_schema,ct.relname as target_table,co.confdeltype as delete_action,
    array(select a.attname::text from unnest(co.conkey) with ordinality k(n,o)
      join pg_attribute a on a.attrelid=co.conrelid and a.attnum=k.n order by k.o) as columns,
    array(select a.attname::text from unnest(co.confkey) with ordinality k(n,o)
      join pg_attribute a on a.attrelid=co.confrelid and a.attnum=k.n order by k.o) as target_columns
    from pg_constraint co join pg_class cl on cl.oid=co.conrelid join pg_namespace ns on ns.oid=cl.relnamespace
    join pg_class ct on ct.oid=co.confrelid join pg_namespace nt on nt.oid=ct.relnamespace
    where co.contype='f' and (ns.nspname in ('public','auth','storage') or nt.nspname in ('public','auth','storage'))
    order by ns.nspname,cl.relname,co.conname`)).rows;
  const primaryKeys = (await client.query(`select n.nspname as schema,t.relname as table_name,
    array(select a.attname::text from unnest(co.conkey) with ordinality k(n,o)
      join pg_attribute a on a.attrelid=t.oid and a.attnum=k.n order by k.o) as columns
    from pg_constraint co join pg_class t on t.oid=co.conrelid join pg_namespace n on n.oid=t.relnamespace
    where co.contype='p' and n.nspname in ('public','auth','storage')`)).rows;
  const triggers = (await client.query(`select n.nspname as schema,c.relname as table_name,t.tgname as name,
    t.tgtype as type_flags from pg_trigger t join pg_class c on c.oid=t.tgrelid
    join pg_namespace n on n.oid=c.relnamespace where not t.tgisinternal and n.nspname in ('public','auth','storage')
    order by n.nspname,c.relname,t.tgname`)).rows;
  return { columns, fks, primaryKeys, triggers };
}

function shape(meta, schema, table) {
  const key = tableKey(schema, table);
  const pk = meta.primaryKeys.find(p => tableKey(p.schema, p.table_name) === key)?.columns;
  if (!pk?.length) throw new Error("INVENTORY_PRIMARY_KEY_MISSING");
  const cols = meta.columns.filter(c => tableKey(c.schema, c.table_name) === key).map(c => c.column_name);
  const keys = [...new Set([...pk, ...meta.fks.filter(f => tableKey(f.schema, f.table_name) === key).flatMap(f => f.columns),
    ...meta.fks.filter(f => tableKey(f.target_schema, f.target_table) === key).flatMap(f => f.target_columns)])];
  const timestamps = ["created_at", "updated_at"].filter(c => cols.includes(c));
  const sql = [...keys, ...timestamps].map(q);
  // Only booleans computed at the server, never clinical/free-form text.
  for (const field of ["nome", "descricao", "nome_arquivo", "observacoes_administrativas"]) {
    if (schema === "public" && cols.includes(field)) sql.push(`${q(field)} ~ '^QA[_ ]' as ${q(`${field}_has_qa_marker`)}`);
  }
  return { pk, keys, timestamps, sql: sql.join(", ") };
}

function recordKey(schema, table, row, pk) {
  return `${tableKey(schema, table)}:${JSON.stringify(pk.map(k => row[k]))}`;
}

async function boundedQuery(client, sql, params = []) {
  const result = await client.query(`${sql} LIMIT ${BOUND + 1}`, params);
  if (result.rows.length > BOUND) throw new Error("INVENTORY_BOUND_EXCEEDED");
  return result.rows;
}

async function inventory(client, env) {
  await client.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
  const meta = await metadata(client);
  const uncertainties = [];
  const configured = FIXTURES.map(([, variable]) => env[variable]?.toLowerCase()).filter(Boolean);
  if (configured.length !== 4 || new Set(configured).size !== 4) throw new Error("FOUR_FIXTURES_REQUIRED");
  const users = await boundedQuery(client, `select u.id,u.nome,u.perfil::text as role,u.status::text as status,
    u.created_at,u.updated_at,a.email from public.usuarios u join auth.users a on a.id=u.id
    where u.nome ~ '^QA_' or lower(a.email)=any($1::text[]) order by u.created_at`, [configured]);
  const protectedIds = new Set();
  for (const [name, variable, role] of FIXTURES) {
    const found = users.filter(u => u.email?.toLowerCase() === env[variable]?.toLowerCase()
      && (u.nome === name || u.nome.startsWith(`${name}_`)) && u.role === role && u.status === "ativo");
    if (found.length !== 1) throw new Error("PERMANENT_FIXTURE_AMBIGUOUS");
    protectedIds.add(found[0].id);
  }
  const identities = new Map(users.map(u => [u.id, classifyIdentity({ name: u.nome, email: u.email, role: u.role,
    protectedFixture: protectedIds.has(u.id) })]));
  const roots = [];
  for (const u of users.filter(u => !protectedIds.has(u.id))) {
    roots.push({ schema: "public", table: "usuarios", id: u.id, created_at: u.created_at, updated_at: u.updated_at,
      marker: /^QA_[A-Z0-9]+_?/.exec(u.nome)?.[0] ?? "unrecognized", role: u.role, status: u.status,
      ...identities.get(u.id) });
  }
  for (const [table, noun] of [["pacientes", "Paciente"], ["servicos", "Servico"], ["materiais_estoque", "Material"]]) {
    const rows = await boundedQuery(client, `select id,created_at,updated_at,created_by,updated_by,
      nome ~ $1 as exact_suite_marker from public.${q(table)} where nome ~ '^QA_' order by created_at`, [`^QA_ODO_${noun}_${UUID}$`]);
    for (const row of rows) roots.push({ schema: "public", table, id: row.id,
      created_at: row.created_at, updated_at: row.updated_at, created_by: row.created_by, updated_by: row.updated_by,
      marker: row.exact_suite_marker ? `QA_ODO_${noun}_<uuid>` : "QA_<unproven>",
      ...classifyBusiness({ table, exactSuiteMarker: row.exact_suite_marker, createdBy: row.created_by, identities }) });
  }

  const nodes = new Map();
  const edges = [];
  async function add(schema, table, row) {
    const s = shape(meta, schema, table);
    const key = recordKey(schema, table, row, s.pk);
    if (!nodes.has(key)) {
      if (nodes.size >= BOUND) throw new Error("INVENTORY_CLOSURE_BOUND_EXCEEDED");
      nodes.set(key, { key, schema, table, row, pk: s.pk });
    }
    return key;
  }
  for (const root of roots) {
    for (const [schema, table] of [["public", root.table], ...(root.table === "usuarios" ? [["auth", "users"]] : [])]) {
      const s = shape(meta, schema, table);
      const rows = await boundedQuery(client, `select ${s.sql} from ${q(schema)}.${q(table)} where id=$1`, [root.id]);
      if (rows.length !== 1) throw new Error("ROOT_NOT_UNIQUE");
      await add(schema, table, rows[0]);
    }
  }
  // Traverse every incoming FK, including composite keys and SET NULL/CASCADE.
  for (const parent of nodes.values()) {
    for (const fk of meta.fks.filter(f => f.target_schema === parent.schema && f.target_table === parent.table)) {
      if (!["public", "auth", "storage"].includes(fk.schema)) throw new Error("FK_SCHEMA_NOT_INVENTORIED");
      const params = fk.target_columns.map(c => parent.row[c]);
      if (params.some(p => p === undefined)) throw new Error("FK_PARENT_KEY_NOT_READ");
      if (params.some(p => p === null)) continue;
      const s = shape(meta, fk.schema, fk.table_name);
      const predicate = fk.columns.map((col, i) => `${q(col)}=$${i + 1}`).join(" AND ");
      const children = await boundedQuery(client, `select ${s.sql} from ${q(fk.schema)}.${q(fk.table_name)} where ${predicate}`, params);
      for (const child of children) {
        const childKey = await add(fk.schema, fk.table_name, child);
        edges.push({ parent: parent.key, child: childKey, constraint: fk.conname, deleteAction: fk.delete_action });
      }
    }
  }
  const publicIds = [...nodes.values()].filter(n => n.schema === "public" && n.pk.length === 1 && n.pk[0] === "id").map(n => n.row.id);
  const actorIds = roots.filter(r => r.table === "usuarios").map(r => r.id);
  const audit = await boundedQuery(client, `select id,usuario_id,entidade,entidade_id,evento,created_at,
    entidade_id=any($1::uuid[]) as entity_in_closure, usuario_id=any($2::uuid[]) as actor_in_scope,
    exists(select 1 from unnest($1::uuid[]) i where dados::text like '%'||i::text||'%') as structured_reference
    from public.auditoria where entidade_id=any($1::uuid[]) or usuario_id=any($2::uuid[])
    or exists(select 1 from unnest($1::uuid[]) i where dados::text like '%'||i::text||'%') order by created_at`, [publicIds, actorIds]);
  // Paths stay on the server. Export only linkage counts, never private paths.
  const storage = (await client.query(`select
    (select count(*) from storage.objects o where o.owner_id=any($1::text[]) or
      exists(select 1 from unnest($1::text[]) i where o.name like '%'||i||'%'))::integer as owner_or_identity_path_matches,
    (select count(*) from public.documentos where paciente_id=any($2::uuid[]) and storage_path is not null)::integer as documents_with_path,
    (select count(*) from public.arquivos_paciente where paciente_id=any($2::uuid[]))::integer as patient_files,
    (select count(*) from public.orcamento_pdf_versoes v join public.orcamentos o on o.id=v.orcamento_id where o.paciente_id=any($2::uuid[]))::integer as budget_pdf_versions`, [actorIds, roots.filter(r => r.table === "pacientes").map(r => r.id)])).rows[0];
  const invariants = await readDatabasePreflight(client);
  const stock = (await client.query(`select count(*)::integer as mismatches from public.materiais_estoque m
    where m.controla_lote_validade and m.quantidade_atual <> coalesce((select sum(l.quantidade_atual) from public.materiais_lotes l where l.material_id=m.id),0)`)).rows[0];
  const migrations = (await client.query("select version::text as version from supabase_migrations.schema_migrations order by version")).rows.map(r => r.version);
  const counts = {};
  for (const n of nodes.values()) counts[tableKey(n.schema, n.table)] = (counts[tableKey(n.schema, n.table)] ?? 0) + 1;
  const records = [...nodes.values()].filter(n => n.schema === "public").map(n => {
    const root = roots.find(r => r.table === n.table && r.id === n.row.id);
    if (root) return { ...root, key: n.key };
    // Being connected to a QA fixture establishes dependency, not ownership.
    return { schema: n.schema, table: n.table, key: n.key,
      identity: Object.fromEntries(n.pk.map(c => [c, n.row[c]])),
      created_at: n.row.created_at, updated_at: n.row.updated_at,
      created_by: n.row.created_by, updated_by: n.row.updated_by,
      qaMarker: Object.entries(n.row).some(([k, v]) => k.endsWith("_has_qa_marker") && v === true),
      classification: "OWNERSHIP_UNKNOWN", reason: "relational_dependency_requires_independent_origin_proof",
      parents: edges.filter(e => e.child === n.key).map(e => e.parent),
      references: meta.fks.filter(f => f.schema === n.schema && f.table_name === n.table && f.target_schema === "public")
        .map(f => ({ constraint: f.conname, target: tableKey(f.target_schema, f.target_table),
          keys: Object.fromEntries(f.columns.map(c => [c, n.row[c]])) })) };
  });
  // Polymorphic audit references are not represented by PostgreSQL FKs.
  for (const a of audit) if (!records.some(r => r.table === "auditoria" && r.id === a.id || r.table === "auditoria" && r.identity?.id === a.id)) {
    records.push({ schema: "public", table: "auditoria", id: a.id, created_at: a.created_at,
      actorId: a.usuario_id, entityId: a.entidade_id, entity: a.entidade, event: a.evento,
      classification: "OWNERSHIP_UNKNOWN", reason: "polymorphic_audit_origin_requires_independent_proof" });
  }
  if (Object.values(storage).some(n => n > 0)) uncertainties.push("storage_objects_require_exact_linkage_and_exclusive_ownership_proof");
  uncertainties.push("production_exclusion_not_independently_attested", "dependency_origin_not_inferred_from_parent",
    "non_fk_external_references_not_proven_absent");
  const rootCounts = Object.fromEntries(["pacientes", "servicos", "materiais_estoque", "usuarios"].map(t => [t, roots.filter(r => r.table === t).length]));
  // Auth internal row identities/refresh token identifiers stay private.
  const publicEdges = edges.filter(e => e.parent.startsWith("public.") && e.child.startsWith("public."));
  const report = { capturedAt: new Date().toISOString(), readOnly: true, snapshot: "REPEATABLE READ", rootCounts,
    protectedFixtures: protectedIds.size, roots, records, counts, publicEdges, audit, storage,
    foreignKeys: meta.fks, triggers: meta.triggers, invariants, stock, migrations,
    ...summarizeDryRun(records, uncertainties) };
  return { ...report, snapshotSha256: inventoryDigest(report) };
}

export function renderInventory(report) {
  const lines = ["# Inventário remoto QA — dry run", "", `Capturado: ${report.capturedAt ?? "indisponível"}`,
    `Ownership: **${report.ownership}**. Cleanup: **${report.cleanup}**. Gate: **${report.cleanupGate}**.`, "",
    `SAFE_TO_DELETE_CONFIRMED_QA = ${report.SAFE_TO_DELETE_CONFIRMED_QA ?? 0}`,
    `CONFIRMED_QA_ORIGIN = ${report.CONFIRMED_QA_ORIGIN ?? 0}`,
    `BLOCKED_UNKNOWN_OWNERSHIP = ${report.BLOCKED_UNKNOWN_OWNERSHIP ?? 0}`,
    `NON_QA = ${report.NON_QA ?? 0}`, "",
    "Origem confirmada não autoriza exclusão: dependências e ambiente também precisam passar.", "",
    "| Tabela | ID/chave | Origem | Prova ou evidência faltante |", "| --- | --- | --- | --- |"];
  for (const r of report.records ?? []) lines.push(`| ${r.schema}.${r.table} | ${r.id ?? JSON.stringify(r.identity)} | ${r.classification} | ${r.reason} |`);
  lines.push("", "## Bloqueios", "");
  for (const u of report.uncertainties ?? []) lines.push(`- ${u}`);
  lines.push("", "## Ordem de exclusão", "", "Não há ordem executável aprovada: conjunto contém dependências sem origem comprovada. Nenhuma exclusão foi executada.", "",
    "O JSON associado contém catálogo completo de FKs, ações de delete, vínculos públicos, triggers, metadados mínimos, Auth por contagem e auditorias por ID. Nenhum conteúdo clínico ou credencial foi exportado.", "");
  return lines.join("\n");
}

export async function runRemoteInventory({ env = readEnvironment(), linkedRef = readLinkedProjectRef() } = {}) {
  const guard = projectGuard(env, linkedRef);
  if (!guard.pass) return { ownership: "BLOCKED", cleanup: "NOT EXECUTED", cleanupGate: "BLOCKED",
    guard, uncertainties: ["target_project_guard_failed"] };
  try {
    const [report, signupDisabled] = await Promise.all([
      withReadOnlyDatabase(env.SUPABASE_TEST_DB_URL, c => inventory(c, env)), readSignupStatus(env),
    ]);
    return { ...report, guard, signupDisabled, productionExclusion: "BLOCKED", mutationStatementsExecuted: 0 };
  } catch {
    return { ownership: "BLOCKED", cleanup: "NOT EXECUTED", cleanupGate: "BLOCKED", guard,
      uncertainties: ["read_only_inventory_incomplete"], mutationStatementsExecuted: 0 };
  }
}

export async function main(args = process.argv.slice(2)) {
  if (args.length) throw new Error("READ_ONLY_INVENTORY_ACCEPTS_NO_ARGUMENTS");
  const report = await runRemoteInventory();
  const directory = resolve(ROOT, "artifacts/homologacao/remote-inventory");
  await mkdir(directory, { recursive: true });
  const stem = (report.capturedAt ?? new Date().toISOString()).replaceAll(/[^0-9]/g, "");
  for (const name of [stem, "latest"]) {
    await writeFile(resolve(directory, `${name}.json`), JSON.stringify(report, null, 2));
    await writeFile(resolve(directory, `${name}.md`), renderInventory(report));
  }
  console.log(JSON.stringify({ ownership: report.ownership, cleanup: report.cleanup, gate: report.cleanupGate,
    roots: report.rootCounts, confirmed: report.CONFIRMED_QA_ORIGIN, ambiguous: report.BLOCKED_UNKNOWN_OWNERSHIP,
    artifact: "artifacts/homologacao/remote-inventory/latest.md" }));
  process.exitCode = report.cleanupGate === "BLOCKED" ? 2 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => { console.error("REMOTE_INVENTORY_BLOCKED: detalhes sensíveis ocultos."); process.exitCode = 2; });
}
