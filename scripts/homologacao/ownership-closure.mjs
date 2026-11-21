import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT } from "./lib/env.mjs";
import { inventoryDigest } from "./inventory-digest.mjs";

const SOURCE = resolve(ROOT, "artifacts/homologacao/remote-inventory/latest.json");
const OUTPUT = resolve(ROOT, "artifacts/homologacao/ownership-closure");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SUPPORTED = new Set(["profissionais", "atendimentos", "procedimentos", "servico_materiais",
  "procedimento_materiais_consumo", "movimentacoes_estoque", "consumos_clinicos_materiais"]);

function idOf(record) { return record.id ?? record.identity?.id; }
function keyOf(record) { return record.key ?? `public.${record.table}:${JSON.stringify([idOf(record)])}`; }
function presentReference(ref) { return Object.values(ref.keys ?? {}).every(value => value !== null && value !== undefined); }
function isActorReference(ref) { return Object.keys(ref.keys ?? {}).every(key => ["created_by", "updated_by"].includes(key)); }

/** Origin needs a confirmed creator and business FK parents; updated_by records later edits. */
export function assessDependency(record, { confirmed, nodes, edges }) {
  const id = idOf(record);
  if (!UUID.test(id ?? "") || !SUPPORTED.has(record.table)) {
    return { table: record.table, id, parentSource: [], ownershipMechanism: "unrecognized_dependency",
      confidence: "OWNERSHIP_UNKNOWN", deletable: false, reasons: ["unrecognized_dependency_shape"] };
  }
  const refs = (record.references ?? []).filter(presentReference);
  const unresolved = [];
  const parentSource = [];
  for (const ref of refs) {
    if (Object.keys(ref.keys).length === 1 && Object.hasOwn(ref.keys, "updated_by")) continue;
    const linked = edges.filter(edge => edge.child === keyOf(record) && edge.constraint === ref.constraint)
      .map(edge => edge.parent);
    if (linked.length !== 1) unresolved.push(`fk_parent_outside_snapshot:${ref.constraint}`);
    else {
      parentSource.push({ constraint: ref.constraint, parent: linked[0],
        confirmed: confirmed.has(linked[0]) });
      if (!confirmed.has(linked[0])) unresolved.push(`fk_parent_unconfirmed:${ref.constraint}`);
    }
  }
  if (record.table === "profissionais") {
    const user = parentSource.find(p => p.constraint.endsWith("usuario_id_fkey"));
    const profile = user ? nodes.get(user.parent) : null;
    if (!user || !profile || !user.confirmed || profile.role !== "dentista") unresolved.push("qa_dentist_profile_not_confirmed");
    const delta = profile ? Math.abs(Date.parse(record.created_at) - Date.parse(profile.created_at)) : Infinity;
    if (!Number.isFinite(delta) || delta > 1000) unresolved.push("professional_creation_not_same_transaction_window");
    return { table: record.table, id, parentSource,
      ownershipMechanism: "auth_provisioning_trigger_professional_fk_and_creation_time",
      confidence: unresolved.length ? "OWNERSHIP_UNKNOWN" : "OWNERSHIP_CONFIRMED",
      deletable: false, reasons: unresolved.length ? unresolved : ["read_only_origin_proof_only"] };
  }
  const actorKey = `public.usuarios:${JSON.stringify([record.created_by])}`;
  if (!record.created_by || !confirmed.has(actorKey)) unresolved.push("created_by_not_confirmed_qa_actor");
  const domainParents = parentSource.filter(p => !refs.some(ref => isActorReference(ref) && edges.some(edge =>
    edge.child === keyOf(record) && edge.constraint === ref.constraint && edge.parent === p.parent)));
  if (!domainParents.length) unresolved.push("no_confirmed_business_parent");
  if (record.table === "procedimentos" && record.qaMarker !== true) unresolved.push("procedure_suite_marker_absent");
  return { table: record.table, id, parentSource,
    ownershipMechanism: "confirmed_qa_created_by_and_all_nonnull_fk_parents_in_qa_chain",
    confidence: unresolved.length ? "OWNERSHIP_UNKNOWN" : "OWNERSHIP_CONFIRMED",
    deletable: false, reasons: unresolved.length ? [...new Set(unresolved)] : ["read_only_origin_proof_only"] };
}

export function closeOwnership(inventory) {
  if (inventory?.readOnly !== true || inventory?.snapshot !== "REPEATABLE READ"
    || !Array.isArray(inventory.roots) || !Array.isArray(inventory.records)
    || !Array.isArray(inventory.publicEdges) || !Array.isArray(inventory.audit)
    || !Array.isArray(inventory.foreignKeys) || !Array.isArray(inventory.triggers)
    || !Array.isArray(inventory.migrations) || !inventory.counts || !inventory.storage
    || !inventory.invariants || !inventory.stock || !inventory.rootCounts
    || !Array.isArray(inventory.uncertainties) || inventory.protectedFixtures !== 4
    || typeof inventory.snapshotSha256 !== "string") throw new Error("INVENTORY_NOT_PROVEN_COMPLETE");
  const snapshotHash = inventoryDigest(inventory);
  if (snapshotHash !== inventory.snapshotSha256) throw new Error("INVENTORY_SNAPSHOT_HASH_MISMATCH");
  const roots = inventory.roots.map(r => ({ table: r.table, id: r.id, parentSource: r.created_by ?? null,
    ownershipMechanism: r.reason, confidence: r.classification, deletable: false,
    reasons: r.classification === "OWNERSHIP_CONFIRMED" ? ["read_only_origin_proof_only"] : [r.reason] }));
  const confirmed = new Set(inventory.roots.filter(r => r.classification === "OWNERSHIP_CONFIRMED").map(keyOf));
  const nodes = new Map(inventory.roots.map(r => [keyOf(r), r]));
  for (const record of inventory.records) if (record.table !== "auditoria") nodes.set(keyOf(record), record);
  // Roots in records may lack their role; the dedicated root inventory is authoritative for these fields.
  for (const root of inventory.roots) nodes.set(keyOf(root), root);
  const pending = inventory.records.filter(r => r.table !== "auditoria"
    && !inventory.roots.some(root => root.table === r.table && root.id === idOf(r)));
  const assessments = new Map();
  for (let pass = 0; pass <= pending.length; pass++) {
    let added = 0;
    for (const record of pending) {
      const key = keyOf(record);
      if (confirmed.has(key)) continue;
      const result = assessDependency(record, { confirmed, nodes, edges: inventory.publicEdges });
      assessments.set(key, result);
      if (result.confidence === "OWNERSHIP_CONFIRMED") { confirmed.add(key); added++; }
    }
    if (!added) break;
  }
  // Reassess after fixed point so the parent evidence reflects the final closure.
  const dependencies = pending.map(r => assessDependency(r, { confirmed, nodes, edges: inventory.publicEdges }));
  const byId = new Map([...roots, ...dependencies].map(r => [r.id, r]));
  const audit = inventory.audit.map(a => {
    const target = byId.get(a.entidade_id);
    const entityConfirmed = target?.confidence === "OWNERSHIP_CONFIRMED";
    const actorConfirmed = byId.get(a.usuario_id)?.confidence === "OWNERSHIP_CONFIRMED";
    const classification = !target ? "UNKNOWN" : !entityConfirmed ? "UNKNOWN"
      : actorConfirmed && a.evento === "usuario_convidado" ? "QA_EXCLUSIVE" : "RELATED_BUT_NOT_EXCLUSIVE";
    return { table: "auditoria", id: a.id, parentSource: a.entidade_id, actorId: a.usuario_id,
      event: a.evento, entity: a.entidade, entityId: a.entidade_id,
      ownershipMechanism: entityConfirmed ? "structured_entity_id_matches_confirmed_qa_record" : "entity_origin_unconfirmed",
      confidence: classification, deletable: false,
      reasons: [classification === "QA_EXCLUSIVE" ? "audit_retention_policy_prohibits_automatic_disposal"
        : "audit_not_exclusive_or_origin_unconfirmed", "audit_retention_24_month_baseline"] };
  });
  const totals = {
    ROOTS_TOTAL: roots.length,
    ROOTS_CONFIRMED: roots.filter(r => r.confidence === "OWNERSHIP_CONFIRMED").length,
    ROOTS_PROBABLE: roots.filter(r => r.confidence === "OWNERSHIP_PROBABLE").length,
    ROOTS_UNKNOWN: roots.filter(r => r.confidence === "OWNERSHIP_UNKNOWN").length,
    ROOTS_NON_QA: roots.filter(r => r.confidence === "NON_QA").length,
    DEPENDENCIES_TOTAL: dependencies.length,
    DEPENDENCIES_CONFIRMED: dependencies.filter(r => r.confidence === "OWNERSHIP_CONFIRMED").length,
    DEPENDENCIES_BLOCKED: dependencies.filter(r => r.confidence !== "OWNERSHIP_CONFIRMED").length,
    AUDIT_TOTAL: audit.length,
    AUDIT_QA_EXCLUSIVE: audit.filter(r => r.confidence === "QA_EXCLUSIVE").length,
    AUDIT_BLOCKED: audit.filter(r => r.confidence !== "QA_EXCLUSIVE" || !r.deletable).length,
    SAFE_TO_DELETE_CONFIRMED_QA: 0,
  };
  return { generatedAt: new Date().toISOString(), inventoryCapturedAt: inventory.capturedAt,
    inventorySnapshotSha256: inventory.snapshotSha256, source: "read_only_inventory_snapshot",
    OWNERSHIP_CLOSURE: totals.ROOTS_PROBABLE === 0 && totals.ROOTS_UNKNOWN === 0
      && totals.ROOTS_NON_QA === 0 && totals.DEPENDENCIES_BLOCKED === 0
      && totals.AUDIT_BLOCKED === 0 && inventory.uncertainties.length === 0
      ? "PASS" : "BLOCKED",
    REMOTE_CLEANUP_GATE: "BLOCKED", environmentClassification: "NOT_CHECKED_BY_OFFLINE_SCRIPT",
    auditRetention: "24_MONTH_BASELINE_NO_AUTOMATIC_DISPOSAL", roots, dependencies, audit, totals };
}

export function renderClosure(result) {
  const lines = ["# Ownership closure — análise somente leitura", "", `Snapshot: ${result.inventoryCapturedAt}`,
    `SHA-256 do inventário: ${result.inventorySnapshotSha256}`, "",
    `OWNERSHIP_CLOSURE: **${result.OWNERSHIP_CLOSURE}**`,
    `REMOTE_CLEANUP_GATE: **${result.REMOTE_CLEANUP_GATE}**`, ""];
  for (const [name, value] of Object.entries(result.totals)) lines.push(`${name} = ${value}`);
  for (const [title, rows] of [["Raízes", result.roots], ["Dependências", result.dependencies], ["Auditoria", result.audit]]) {
    lines.push("", `## ${title}`, "", "| Tabela | ID | Parent/source | Mecanismo | Confiança | Deletable |",
      "| --- | --- | --- | --- | --- | --- |");
    for (const row of rows) lines.push(`| ${row.table} | ${row.id} | ${Array.isArray(row.parentSource)
      ? row.parentSource.map(p => p.parent).join(", ") : row.parentSource ?? "—"} | ${row.ownershipMechanism} | ${row.confidence} | no |`);
  }
  lines.push("", "Auditoria segue retenção provisória de 24 meses e não tem descarte automático. Esta análise de origem não autoriza DML nem altera a classificação independente do ambiente.", "");
  return lines.join("\n");
}

export async function main(args = process.argv.slice(2)) {
  if (args.length) throw new Error("READ_ONLY_CLOSURE_ACCEPTS_NO_ARGUMENTS");
  const inventory = JSON.parse(await readFile(SOURCE, "utf8"));
  const result = closeOwnership(inventory);
  await mkdir(OUTPUT, { recursive: true });
  await writeFile(resolve(OUTPUT, "latest.json"), JSON.stringify(result, null, 2));
  await writeFile(resolve(OUTPUT, "latest.md"), renderClosure(result));
  console.log(JSON.stringify({ status: result.OWNERSHIP_CLOSURE, totals: result.totals,
    artifact: "artifacts/homologacao/ownership-closure/latest.md" }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => { console.error("OWNERSHIP_CLOSURE_BLOCKED: inventário indisponível ou inválido."); process.exitCode = 2; });
}
