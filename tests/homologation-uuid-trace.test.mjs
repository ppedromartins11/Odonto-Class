import { it, expect } from "vitest";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { candidatesFromInventory, traceArtifactUuids, writeUuidTrace } from "../scripts/homologacao/trace-artifact-uuids.mjs";

const ROOT_ID = "01234567-89ab-4cde-8fab-0123456789ab";
const CHILD_ID = "11234567-89ab-4cde-8fab-0123456789ab";
const AUDIT_ID = "21234567-89ab-4cde-8fab-0123456789ab";
const RUN = "20261006005043986-96843fab-59a6-4805-a6ea-6d2ab7aade7a";

it("historical UUID index records only literal run evidence and cannot ingest current inventories or its own output", async () => {
  const root = await mkdtemp(join(tmpdir(), "uuid-trace-"));
  try {
    const archive = join(root, "artifacts", "homologacao");
    await mkdir(join(archive, "remote-inventory"), { recursive: true });
    await mkdir(join(archive, "runs"));
    await mkdir(join(archive, "logs"));
    const inventory = { records: [
      { table: "usuarios", id: ROOT_ID },
      { table: "profissionais", key: `public.profissionais:["${CHILD_ID}"]` },
    ], audit: [{ id: AUDIT_ID }] };
    await writeFile(join(archive, "remote-inventory", "latest.json"), JSON.stringify(inventory));
    await writeFile(join(archive, "remote-schema.json"), CHILD_ID);
    await writeFile(join(archive, "runs", `${RUN}.json`), JSON.stringify({ id: ROOT_ID, secret: "do-not-export" }));
    await writeFile(join(archive, "logs", `${RUN}.jsonl`), `${ROOT_ID}\n`);
    const report = await traceArtifactUuids({ root });
    expect(report.candidateCount).toBe(3);
    assert.equal(report.scannedArtifactCount, 2);
    assert.equal(report.hits, 1);
    const rootRow = report.rows.find(row => row.uuid === ROOT_ID);
    assert.equal(rootRow.entity_type, "usuarios");
    assert.equal(rootRow.first_seen_run, RUN);
    assert.equal(rootRow.last_seen_run, RUN);
    assert.deepEqual(rootRow.artifact, [`logs/${RUN}.jsonl`, `runs/${RUN}.json`]);
    assert.deepEqual(report.rows.find(row => row.uuid === CHILD_ID).artifact, ["NONE"]);
    assert.deepEqual(report.rows.find(row => row.uuid === AUDIT_ID).artifact, ["NONE"]);
    await writeUuidTrace(report, root);
    const serialized = await readFile(join(archive, "ownership-history", "latest.json"), "utf8");
    assert.doesNotMatch(serialized, /do-not-export/);
    assert.equal((await traceArtifactUuids({ root })).hits, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("candidate index rejects conflicting entity attribution", () => {
  expect(() => candidatesFromInventory({
    records: [{ table: "usuarios", id: ROOT_ID }, { table: "profissionais", id: ROOT_ID }],
    audit: [],
  })).toThrow(/UUID_TRACE_CONFLICTING_ENTITY_TYPE/);
});
