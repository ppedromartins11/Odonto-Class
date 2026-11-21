import { it, expect } from "vitest";
import { assessDependency, closeOwnership } from "../scripts/homologacao/ownership-closure.mjs";
import { inventoryDigest } from "../scripts/homologacao/inventory-digest.mjs";

const user = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const patient = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const professional = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const attendance = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const key = (table, id) => `public.${table}:${JSON.stringify([id])}`;
const at = "2026-09-22T01:18:44.290Z";
const seal = inventory => {
  inventory.snapshotSha256 = inventoryDigest(inventory);
  return inventory;
};
const fixture = () => {
  const roots = [
    { table: "usuarios", id: user, role: "dentista", created_at: at, classification: "OWNERSHIP_CONFIRMED", reason: "reserved_identity_pair" },
    { table: "pacientes", id: patient, created_at: at, classification: "OWNERSHIP_CONFIRMED", reason: "qa_creator_and_marker" },
  ];
  const pro = { table: "profissionais", identity: { id: professional }, key: key("profissionais", professional), created_at: at,
    references: [{ constraint: "profissionais_usuario_id_fkey", keys: { usuario_id: user } }] };
  const visit = { table: "atendimentos", identity: { id: attendance }, key: key("atendimentos", attendance), created_at: at, created_by: user,
    references: [
      { constraint: "atendimentos_created_by_fkey", keys: { created_by: user } },
      { constraint: "atendimentos_paciente_id_fkey", keys: { paciente_id: patient } },
      { constraint: "atendimentos_profissional_id_fkey", keys: { profissional_id: professional } },
    ] };
  return seal({ readOnly: true, snapshot: "REPEATABLE READ", protectedFixtures: 4,
    capturedAt: at, roots, records: [pro, visit], publicEdges: [
      { parent: key("usuarios", user), child: pro.key, constraint: "profissionais_usuario_id_fkey" },
      { parent: key("usuarios", user), child: visit.key, constraint: "atendimentos_created_by_fkey" },
      { parent: key("pacientes", patient), child: visit.key, constraint: "atendimentos_paciente_id_fkey" },
      { parent: pro.key, child: visit.key, constraint: "atendimentos_profissional_id_fkey" },
    ], audit: [{ id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", entidade_id: user,
      usuario_id: "ffffffff-ffff-4fff-8fff-ffffffffffff", evento: "usuario_ativado", entidade: "usuarios" }],
    rootCounts: {}, counts: {}, storage: {}, foreignKeys: [], triggers: [], invariants: {},
    stock: {}, migrations: [], uncertainties: [] });
};

it("confirms only a complete creator, patient and professional FK chain", () => {
  const result = closeOwnership(fixture());
  expect(result.totals.DEPENDENCIES_CONFIRMED).toBe(2);
  expect(result.totals.DEPENDENCIES_BLOCKED).toBe(0);
  expect(result.audit[0].confidence).toBe("RELATED_BUT_NOT_EXCLUSIVE");
  expect(result.audit[0].deletable).toBe(false);
  expect(result.totals.SAFE_TO_DELETE_CONFIRMED_QA).toBe(0);
  expect(result.OWNERSHIP_CLOSURE).toBe("BLOCKED");
});

it("blocks missing FK parent even with a QA creator", () => {
  const input = fixture();
  input.publicEdges = input.publicEdges.filter(e => e.constraint !== "atendimentos_paciente_id_fkey");
  seal(input);
  const result = closeOwnership(input);
  expect(result.totals.DEPENDENCIES_BLOCKED).toBe(1);
  expect(result.dependencies.find(d => d.table === "atendimentos").reasons)
    .toContain("fk_parent_outside_snapshot:atendimentos_paciente_id_fkey");
});

it("blocks a professional whose QA identity is still probable", () => {
  const input = fixture();
  input.roots[0].classification = "OWNERSHIP_PROBABLE";
  seal(input);
  const result = closeOwnership(input);
  expect(result.totals.ROOTS_PROBABLE).toBe(1);
  expect(result.totals.DEPENDENCIES_BLOCKED).toBe(2);
  expect(result.OWNERSHIP_CLOSURE).toBe("BLOCKED");
  expect(result.audit[0].confidence).toBe("UNKNOWN");
});

it("blocks inventory uncertainty even when every root and dependency is confirmed", () => {
  const input = fixture();
  input.audit = [];
  input.uncertainties = ["external_environment_unresolved"];
  seal(input);
  expect(closeOwnership(input).OWNERSHIP_CLOSURE).toBe("BLOCKED");
});

it("rejects a changed inventory snapshot without a matching hash", () => {
  const input = fixture();
  input.records[1].created_by = "ffffffff-ffff-4fff-8fff-ffffffffffff";
  expect(() => closeOwnership(input)).toThrow("INVENTORY_SNAPSHOT_HASH_MISMATCH");
});

it("blocks same-parent-only records without a business FK chain", () => {
  const record = { table: "atendimentos", identity: { id: attendance }, key: key("atendimentos", attendance), created_by: user,
    references: [{ constraint: "atendimentos_created_by_fkey", keys: { created_by: user } }] };
  const result = assessDependency(record, { confirmed: new Set([key("usuarios", user)]), nodes: new Map(),
    edges: [{ parent: key("usuarios", user), child: record.key, constraint: "atendimentos_created_by_fkey" }] });
  expect(result.confidence).toBe("OWNERSHIP_UNKNOWN");
  expect(result.reasons).toContain("no_confirmed_business_parent");
});
