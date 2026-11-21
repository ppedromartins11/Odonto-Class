import { createHash } from "node:crypto";

// Keep the producer and every offline consumer on the same snapshot format.
export function inventoryDigest(report) {
  const { protectedFixtures, rootCounts, roots, records, counts, publicEdges, audit,
    storage, foreignKeys, triggers, invariants, stock, migrations, uncertainties } = report;
  return createHash("sha256").update(JSON.stringify({ protectedFixtures, rootCounts, roots,
    records, counts, publicEdges, audit, storage, foreignKeys, triggers, invariants,
    stock, migrations, uncertainties })).digest("hex");
}
