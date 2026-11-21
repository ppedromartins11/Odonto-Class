import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { evaluateAttestation } from "../scripts/release-attest.mjs";
import { SOURCE_FINGERPRINT_VERSION } from "../scripts/homologacao/preflight.mjs";

let root;
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); root = undefined; });

describe("release attestation", () => {
  it("fails closed until homologation, QA evidence and fingerprint-bound approval exist", async () => {
    root = await mkdtemp(join(tmpdir(), "odonto-release-attest-"));
    const result = await evaluateAttestation({ root, currentFingerprint: "a".repeat(64) });
    expect(result.status).toBe("BLOCKED");
    expect(Object.values(result.checks).every(Boolean)).toBe(false);
    expect(result.checks.approvalMatchesFingerprint).toBe(false);
  });

  it("accepts only complete evidence and approval for the exact candidate fingerprint", async () => {
    root = await mkdtemp(join(tmpdir(), "odonto-release-attest-"));
    const fingerprint = "b".repeat(64);
    const writeJson = async (path, value) => {
      const target = join(root, path);
      await mkdir(join(target, ".."), { recursive: true });
      await writeFile(target, JSON.stringify(value));
    };
    await writeJson("artifacts/homologacao/latest.json", { conclusion: "PASS", preflight: { sourceFingerprintVersion: SOURCE_FINGERPRINT_VERSION, sourceSha256: fingerprint } });
    await writeJson("artifacts/release/qa-evidence.json", {
      fingerprintVersion: SOURCE_FINGERPRINT_VERSION, fingerprint,
      project: { ref: "zxvpyxvhymuibaxgxetf", status: "ACTIVE_HEALTHY" },
      migrations: Array.from({ length: 34 }, (_, i) => ({ version: String(i + 1).padStart(4, "0") })),
      securityAdvisors: { blockers: 0, status: "PASS", classified: true }, smoke: { status: "PASS" },
      cleanup: { status: "PASS", ownedResidue: 0 }, environmentIsolation: "PASS",
    });
    await writeJson("artifacts/release/approval.json", { approved: true, fingerprintVersion: SOURCE_FINGERPRINT_VERSION,
      fingerprint, approvedAt: "2026-10-17T00:00:00.000Z", approver: "authorized-release-owner" });
    await mkdir(join(root, "docs/plans"), { recursive: true });
    await writeFile(join(root, "docs/plans/first-production-release-security.md"), "plan");
    const result = await evaluateAttestation({ root, currentFingerprint: fingerprint });
    expect(result.status).toBe("ELIGIBLE");
    expect(Object.values(result.checks).every(Boolean)).toBe(true);
    await writeJson("artifacts/release/qa-evidence.json", {
      fingerprintVersion: SOURCE_FINGERPRINT_VERSION, fingerprint,
      project: { ref: "zxvpyxvhymuibaxgxetf", status: "ACTIVE_HEALTHY" },
      migrations: Array.from({ length: 33 }, (_, i) => ({ version: String(i + 1).padStart(4, "0") })),
      securityAdvisors: { blockers: 0, status: "PASS", classified: true }, smoke: { status: "PASS" },
      cleanup: { status: "PASS", ownedResidue: 0 }, environmentIsolation: "PASS",
    });
    const previousSchema = await evaluateAttestation({ root, currentFingerprint: fingerprint });
    expect(previousSchema.status).toBe("BLOCKED");
    expect(previousSchema.checks.qaMigrationsExpected).toBe(false);
    const changed = await evaluateAttestation({ root, currentFingerprint: "c".repeat(64) });
    expect(changed.status).toBe("BLOCKED");
    expect(changed.checks.approvalMatchesFingerprint).toBe(false);

    // A legacy report with the same 64 hex digits is still a different contract.
    await writeJson("artifacts/homologacao/latest.json", { conclusion: "PASS", preflight: { sourceSha256: fingerprint } });
    await writeJson("artifacts/release/qa-evidence.json", { fingerprint, project: { ref: "zxvpyxvhymuibaxgxetf", status: "ACTIVE_HEALTHY" } });
    await writeJson("artifacts/release/approval.json", { approved: true, fingerprint,
      approvedAt: "2026-10-17T00:00:00.000Z", approver: "authorized-release-owner" });
    const legacy = await evaluateAttestation({ root, currentFingerprint: fingerprint });
    expect(legacy.status).toBe("BLOCKED");
    expect(legacy.checks.reportFingerprintMatches).toBe(false);
    expect(legacy.checks.qaEvidenceFingerprintMatches).toBe(false);
    expect(legacy.checks.approvalMatchesFingerprint).toBe(false);
  });
});
