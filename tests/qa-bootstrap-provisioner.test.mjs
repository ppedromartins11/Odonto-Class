import { describe, expect, it, vi } from "vitest";
import { assertBootstrapTarget, cleanupOwnedMfa, proveTemporaryMfa } from "../scripts/homologacao/bootstrap-provisioner.mjs";

const qa = "zxvpyxvhymuibaxgxetf";
const production = "sqouddqzpmkofenyufuj";
const dr = "qprzxkolbbnqfopamfhj";
const valid = {
  SUPABASE_TEST_HOMOLOGATION: "I_ACKNOWLEDGE_FAKE_DATA_ONLY",
  SUPABASE_TEST_ENVIRONMENT: "homologation",
  SUPABASE_TEST_PROJECT_REF: qa,
  QA_SUPABASE_PROJECT_REF: qa,
  PRODUCTION_SUPABASE_PROJECT_REF: production,
  DR_SUPABASE_PROJECT_REF: dr,
  VERCEL_PREVIEW_SUPABASE_PROJECT_REF: qa,
  VERCEL_PRODUCTION_SUPABASE_PROJECT_REF: production,
  SUPABASE_TEST_URL: `https://${qa}.supabase.co`,
  NEXT_PUBLIC_SUPABASE_URL: `https://${qa}.supabase.co`,
  SUPABASE_TEST_DB_URL: `postgresql://postgres:fictional@db.${qa}.supabase.co:5432/postgres`,
  SUPABASE_TEST_ANON_KEY: "fictional",
  SUPABASE_TEST_SERVICE_ROLE_KEY: "fictional",
  HOMOLOGATION_INITIAL_ADMIN_BOOTSTRAP_ACK: "BOOTSTRAP_INITIAL_ADMIN_IN_QA",
};

function retarget(ref) {
  return { ...valid, SUPABASE_TEST_PROJECT_REF: ref, QA_SUPABASE_PROJECT_REF: ref,
    SUPABASE_TEST_URL: `https://${ref}.supabase.co`, NEXT_PUBLIC_SUPABASE_URL: `https://${ref}.supabase.co`,
    SUPABASE_TEST_DB_URL: `postgresql://postgres:fictional@db.${ref}.supabase.co:5432/postgres`,
    VERCEL_PREVIEW_SUPABASE_PROJECT_REF: ref };
}

describe("initial administrator bootstrap isolation", () => {
  it("accepts only the exact QA ref and its own action acknowledgement", () => {
    expect(() => assertBootstrapTarget(valid, qa)).not.toThrow();
    expect(() => assertBootstrapTarget({ ...valid, HOMOLOGATION_INITIAL_ADMIN_BOOTSTRAP_ACK: "" }, qa))
      .toThrow("INITIAL_ADMIN_BOOTSTRAP_CONFIRMATION_REQUIRED");
    expect(() => assertBootstrapTarget({ ...valid, SUPABASE_TEST_SERVICE_ROLE_KEY: "" }, qa))
      .toThrow("QA_AUTH_KEYS_REQUIRED");
  });
  it.each([production, dr, "abcdefghijklmnopqrst"])("rejects a different target before mutation: %s", (ref) => {
    expect(() => assertBootstrapTarget(retarget(ref), ref))
      .toThrow("FATAL — ENVIRONMENT ISOLATION GUARD FAILED");
  });
  it("rejects an unlinked or mixed database target", () => {
    expect(() => assertBootstrapTarget(valid, null)).toThrow("FATAL — ENVIRONMENT ISOLATION GUARD FAILED");
    expect(() => assertBootstrapTarget({ ...valid, SUPABASE_TEST_DB_URL: `postgresql://postgres:fictional@db.${production}.supabase.co:5432/postgres` }, qa))
      .toThrow("FATAL — ENVIRONMENT ISOLATION GUARD FAILED");
  });
});

describe("bootstrap MFA ownership and failure cleanup", () => {
  it("removes only its own recorded-time factor and blocks an unrelated factor", async () => {
    const deleteFactor = vi.fn(async () => ({ error: null }));
    const factorName = `QA bootstrap ${"a".repeat(32)}`;
    const service = { auth: { admin: { mfa: {
      listFactors: vi.fn(async () => ({ data: { factors: [
        { id: "owned", friendly_name: factorName, created_at: "2026-10-07T21:20:00Z" },
        { id: "unrelated", friendly_name: "personal", created_at: "2026-10-07T21:20:00Z" },
      ] }, error: null })), deleteFactor,
    } } } };
    const manifest = { mfaStartedAt: "2026-10-07T21:19:00Z", mfaFactorName: factorName };
    await expect(cleanupOwnedMfa(service, "user-id", manifest))
      .rejects.toThrow("QA_BOOTSTRAP_MFA_PREEXISTING_FACTOR");
    expect(deleteFactor).not.toHaveBeenCalled();
    service.auth.admin.mfa.listFactors.mockResolvedValue({ data: { factors: [
      { id: "owned", friendly_name: factorName, created_at: "2026-10-07T21:20:00Z" },
    ] }, error: null });
    await cleanupOwnedMfa(service, "user-id", manifest);
    expect(deleteFactor).toHaveBeenCalledWith({ userId: "user-id", id: "owned" });
  });

  it("unenrolls a factor even when enrollment returns an incomplete response", async () => {
    const unenroll = vi.fn(async () => ({ error: null }));
    const login = { auth: { mfa: {
      enroll: vi.fn(async () => ({ data: { id: "temporary" }, error: null })), unenroll,
    } } };
    await expect(proveTemporaryMfa(login, {}, "user-id", "QA bootstrap test"))
      .rejects.toThrow("QA_BOOTSTRAP_MFA_ENROLL_FAILED");
    expect(unenroll).toHaveBeenCalledWith({ factorId: "temporary" });
  });

  it("uses the administrative deletion fallback when user unenroll fails", async () => {
    const deleteFactor = vi.fn(async () => ({ error: null }));
    const service = { auth: { admin: { mfa: { deleteFactor } } } };
    const login = { auth: { mfa: {
      enroll: vi.fn(async () => ({ data: { id: "temporary", totp: { secret: "A" } }, error: null })),
      challenge: vi.fn(async () => ({ data: null, error: new Error("challenge failed") })),
      unenroll: vi.fn(async () => ({ error: new Error("unenroll failed") })),
    } } };
    await expect(proveTemporaryMfa(login, service, "user-id", "QA bootstrap test"))
      .rejects.toThrow("QA_BOOTSTRAP_MFA_CHALLENGE_FAILED");
    expect(deleteFactor).toHaveBeenCalledWith({ userId: "user-id", id: "temporary" });
  });
});
