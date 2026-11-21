import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT } from "./homologacao/lib/env.mjs";
import { SOURCE_FINGERPRINT_VERSION, sourceFingerprint } from "./homologacao/preflight.mjs";

const APPROVAL_PATH = "artifacts/release/approval.json";
const QA_EVIDENCE_PATH = "artifacts/release/qa-evidence.json";
const PLAN_PATH = "docs/plans/first-production-release-security.md";

async function json(path, root) {
  try { return JSON.parse(await readFile(resolve(root, path), "utf8")); }
  catch { return null; }
}

export async function evaluateAttestation({ root = ROOT, currentFingerprint = sourceFingerprint(root) } = {}) {
  const report = await json("artifacts/homologacao/latest.json", root);
  const qa = await json(QA_EVIDENCE_PATH, root);
  const approval = await json(APPROVAL_PATH, root);
  const expectedMigrations = 34;
  const checks = {
    homologationPass: report?.conclusion === "PASS",
    reportFingerprintMatches: report?.preflight?.sourceFingerprintVersion === SOURCE_FINGERPRINT_VERSION &&
      !!report.preflight.sourceSha256 && report.preflight.sourceSha256 === currentFingerprint,
    qaEvidenceFingerprintMatches: qa?.fingerprintVersion === SOURCE_FINGERPRINT_VERSION && qa.fingerprint === currentFingerprint,
    qaActiveHealthy: qa?.project?.status === "ACTIVE_HEALTHY" && qa?.project?.ref === "zxvpyxvhymuibaxgxetf",
    qaMigrationsExpected: qa?.migrations?.length === expectedMigrations && qa.migrations.every((m, i) => m.version === String(i + 1).padStart(4, "0")),
    securityAdvisorsClear: qa?.securityAdvisors?.blockers === 0 && qa?.securityAdvisors?.status === "PASS",
    qaSmokePass: qa?.smoke?.status === "PASS",
    qaCleanupPass: qa?.cleanup?.status === "PASS" && qa?.cleanup?.ownedResidue === 0,
    isolationPass: qa?.environmentIsolation === "PASS",
    advisorsClassified: qa?.securityAdvisors?.classified === true,
    productionPlanPresent: existsSync(resolve(root, PLAN_PATH)),
    approvalMatchesFingerprint: approval?.approved === true && approval?.fingerprintVersion === SOURCE_FINGERPRINT_VERSION &&
      approval.fingerprint === currentFingerprint && typeof approval.approvedAt === "string" &&
      typeof approval.approver === "string" && approval.approver.trim().length > 0,
  };
  const status = Object.values(checks).every(Boolean) ? "ELIGIBLE" : "BLOCKED";
  return { status, fingerprintVersion: SOURCE_FINGERPRINT_VERSION, fingerprint: currentFingerprint, checks };
}

async function main() {
  const result = await evaluateAttestation();
  console.log(`FINGERPRINT: ${result.fingerprint}`);
  for (const [name, pass] of Object.entries(result.checks)) console.log(`${name}: ${pass ? "PASS" : "BLOCKED"}`);
  console.log(`RELEASE ATTESTATION: ${result.status}`);
  console.log(`PRODUCTION GATE: ${result.status}`);
  if (result.status !== "ELIGIBLE") process.exitCode = 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
