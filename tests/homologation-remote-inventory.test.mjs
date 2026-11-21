import { it, expect } from "vitest";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { classifyIdentity, classifyBusiness, summarizeDryRun, runRemoteInventory } from "../scripts/homologacao/inventory-remote.mjs";
import { permanentFixtureIds } from "../scripts/homologacao/remote-checks.mjs";

const uuid = "01234567-89ab-4cde-8fab-0123456789ab";

it("exact reserved Auth identity, profile role and UUID pair prove suite origin", () => {
  const qa = classifyIdentity({ name: `QA_ODO_dentista_${uuid}`, email: `qa_odo_dentista_${uuid}@example.com`, role: "dentista" });
  expect(qa.classification).toBe("OWNERSHIP_CONFIRMED");
  const admin = classifyIdentity({ name: `QA_RC_ADMIN_${uuid}`, email: `qa_rc_admin-${uuid}@example.com`, role: "administrador" });
  assert.equal(admin.classification, "OWNERSHIP_CONFIRMED");
});

it("prefix, reserved email alone, mismatched UUID and role cannot establish ownership", () => {
  const cases = [
    { name: `QA_ODO_dentista_${uuid}`, email: "qa_fake@example.com", role: "dentista" },
    { name: "QA_USR Dentista Atualizado", email: `qa_usr_dentista_${uuid}@example.com`, role: "dentista" },
    { name: `QA_TRAT_dentista_${uuid}`, email: `qa_trat_recepcao_${uuid}@example.com`, role: "dentista" },
    { name: `QA_TRAT_dentista_${uuid}`, email: `qa_trat_dentista_ffffffff-ffff-4fff-8fff-ffffffffffff@example.com`, role: "dentista" },
  ];
  for (const candidate of cases) expect(classifyIdentity(candidate).classification).not.toBe("OWNERSHIP_CONFIRMED");
  assert.equal(classifyIdentity({ ...cases[0], protectedFixture: true }).classification, "NON_QA");
});

it("business row needs exclusive suite marker and confirmed creator", () => {
  const identities = new Map([[uuid, { classification: "OWNERSHIP_CONFIRMED" }]]);
  expect(classifyBusiness({ table: "pacientes", exactSuiteMarker: true, createdBy: uuid, identities }).classification)
    .toBe("OWNERSHIP_CONFIRMED");
  assert.equal(classifyBusiness({ table: "pacientes", exactSuiteMarker: true, createdBy: "unknown", identities }).classification,
    "OWNERSHIP_PROBABLE");
  assert.equal(classifyBusiness({ table: "pacientes", exactSuiteMarker: false, createdBy: uuid, identities }).classification,
    "OWNERSHIP_PROBABLE");
});

it("dry run never promotes proven origin into deletion when dependencies or target remain uncertain", () => {
  const result = summarizeDryRun([
    { classification: "OWNERSHIP_CONFIRMED" }, { classification: "OWNERSHIP_UNKNOWN" },
    { classification: "NON_QA" },
  ], ["production_exclusion_not_independently_attested"]);
  expect(result.ownership).toBe("BLOCKED");
  assert.equal(result.cleanup, "NOT EXECUTED");
  assert.equal(result.SAFE_TO_DELETE_CONFIRMED_QA, 0);
  assert.equal(result.BLOCKED_UNKNOWN_OWNERSHIP, 1);
  assert.equal(result.NON_QA, 1);
});

it("invalid project guard blocks before connecting; CLI rejects execute attempts", async () => {
  const blocked = await runRemoteInventory({ env: {}, linkedRef: null });
  expect(blocked.cleanupGate).toBe("BLOCKED");
  assert.equal(blocked.guard.pass, false);
  const script = fileURLToPath(new URL("../scripts/homologacao/inventory-remote.mjs", import.meta.url));
  const cli = spawnSync(process.execPath, [script, "--execute"], { encoding: "utf8" });
  assert.equal(cli.status, 2);
  assert.match(cli.stderr, /REMOTE_INVENTORY_BLOCKED/);
});

it("remote residue checkpoint protects four configured fixtures, not every active QA admin", () => {
  const env = {
    HOMOLOGATION_ADMIN_EMAIL: "qa_admin@example.com",
    HOMOLOGATION_DENTIST_A_EMAIL: "qa_a@example.com",
    HOMOLOGATION_DENTIST_B_EMAIL: "qa_b@example.com",
    HOMOLOGATION_RECEPTION_EMAIL: "qa_reception@example.com",
  };
  const rows = [
    { id: "admin", nome: "QA_ADMIN_ATIVA", email: env.HOMOLOGATION_ADMIN_EMAIL, perfil: "administrador", status: "ativo" },
    { id: "dentist-a", nome: "QA_DENTISTA_A", email: env.HOMOLOGATION_DENTIST_A_EMAIL, perfil: "dentista", status: "ativo" },
    { id: "dentist-b", nome: "QA_DENTISTA_B", email: env.HOMOLOGATION_DENTIST_B_EMAIL, perfil: "dentista", status: "ativo" },
    { id: "reception", nome: "QA_RECEPCAO", email: env.HOMOLOGATION_RECEPTION_EMAIL, perfil: "recepcao", status: "ativo" },
    { id: "disposable", nome: `QA_RC_ADMIN_${uuid}`, email: `qa_rc_admin-${uuid}@example.com`, perfil: "administrador", status: "ativo" },
  ];
  expect(permanentFixtureIds(rows, env)).toEqual(["admin", "dentist-a", "dentist-b", "reception"]);
});
