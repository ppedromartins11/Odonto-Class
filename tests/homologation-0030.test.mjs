import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { inspectProjectGuard, requiredEnvironment } from "../scripts/homologacao/0030/config.mjs";
import { checkMigrationGate, validateFixtureRows } from "../scripts/homologacao/0030/preflight.mjs";
import { classify, mergePriorScenarioResults, sanitize } from "../scripts/homologacao/0030/lib/safe.mjs";
import { selectedIds, validateCleanupRows } from "../scripts/homologacao/0030/cleanup.mjs";
import { parseArgs, safePhaseError } from "../scripts/homologacao/0030/run.mjs";
import { assertCurrentAssuranceLevel } from "../scripts/homologacao/0030/lib/auth.mjs";
import { newRunState, recordFixture } from "../scripts/homologacao/0030/fixtures.mjs";

const ref = "zxvpyxvhymuibaxgxetf";
const validEnvironment = {
  SUPABASE_TEST_HOMOLOGATION: "I_ACKNOWLEDGE_FAKE_DATA_ONLY",
  SUPABASE_TEST_PROJECT_REF: ref,
  QA_SUPABASE_PROJECT_REF: ref,
  PRODUCTION_SUPABASE_PROJECT_REF: "sqouddqzpmkofenyufuj",
  DR_SUPABASE_PROJECT_REF: "qprzxkolbbnqfopamfhj",
  VERCEL_PREVIEW_SUPABASE_PROJECT_REF: ref,
  VERCEL_PRODUCTION_SUPABASE_PROJECT_REF: "sqouddqzpmkofenyufuj",
  SUPABASE_TEST_URL: `https://${ref}.supabase.co`,
  SUPABASE_TEST_DB_URL: `postgresql://postgres:fictional@db.${ref}.supabase.co:5432/postgres`,
  NEXT_PUBLIC_SUPABASE_URL: `https://${ref}.supabase.co`,
};

describe("harness de homologação 0030: guards", () => {
  it("não aceita AAL1 sem fator MFA verificado", async () => {
    const client = { auth: { mfa: { getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: "aal1", nextLevel: "aal1" }, error: null }) } } };
    await expect(assertCurrentAssuranceLevel(client)).rejects.toThrow("MFA_ENROLLMENT");
  });
  it("bloqueia project ref ausente/divergente e aceita apenas correspondência exata", () => {
    expect(inspectProjectGuard(validEnvironment, ref).pass).toBe(true);
    expect(inspectProjectGuard({ ...validEnvironment, SUPABASE_TEST_PROJECT_REF: "zyxwvutsrqponmlkjihg" }, ref).pass).toBe(false);
    expect(inspectProjectGuard({ ...validEnvironment, NEXT_PUBLIC_SUPABASE_URL: "https://zyxwvutsrqponmlkjihg.supabase.co" }, ref).pass).toBe(false);
    expect(inspectProjectGuard({ ...validEnvironment, SUPABASE_TEST_HOMOLOGATION: "" }, ref).pass).toBe(false);
    expect(inspectProjectGuard({ ...validEnvironment, QA_SUPABASE_PROJECT_REF: "" }, ref).pass).toBe(false);
    expect(inspectProjectGuard({ ...validEnvironment, VERCEL_PREVIEW_SUPABASE_PROJECT_REF: "zyxwvutsrqponmlkjihg" }, ref).pass).toBe(false);
  });

  it("exige migrations 0030 e 0031 aplicadas no novo QA", () => {
    expect(checkMigrationGate({ migration0030: "APPLIED", migration0031: "APPLIED" })).toEqual({ migration0030Applied: true, migration0031Applied: true });
    expect(checkMigrationGate({ migration0030: "ABSENT", migration0031: "APPLIED" }).migration0030Applied).toBe(false);
    expect(checkMigrationGate({ migration0030: "APPLIED", migration0031: "ABSENT" }).migration0031Applied).toBe(false);
  });

  it("falha fechado quando variáveis essenciais não foram configuradas", () => {
    expect(requiredEnvironment({})).toEqual([
      "SUPABASE_TEST_HOMOLOGATION", "SUPABASE_TEST_URL", "SUPABASE_TEST_PROJECT_REF", "QA_SUPABASE_PROJECT_REF", "PRODUCTION_SUPABASE_PROJECT_REF", "DR_SUPABASE_PROJECT_REF", "VERCEL_PREVIEW_SUPABASE_PROJECT_REF", "VERCEL_PRODUCTION_SUPABASE_PROJECT_REF", "SUPABASE_TEST_ANON_KEY", "SUPABASE_TEST_DB_URL",
    ]);
  });
});

describe("harness de homologação 0030: fixtures e relatórios", () => {
  it("registra ownership por entidade e criador antes de permitir cleanup futuro", async () => {
    const state = newRunState("test-manifest");
    await expect(recordFixture(state, "patient", "fixture-id", "")).rejects.toThrow("FIXTURE_OWNERSHIP_INCOMPLETE");
    expect(state.ownershipManifest).toEqual([]);
  });
  it("classifica fixtures idempotentemente e rejeita role/status/metadata privilegiado", () => {
    const rows = [
      { nome: "QA_ExistingAdmin", perfil: "administrador", status: "ativo", email: "qa-admin@example.test", email_confirmed_at: "2026-01-01", raw_user_meta_data: {}, raw_app_meta_data: { role: "admin" } },
      { nome: "QA_DENTISTA_A", perfil: "dentista", status: "ativo", email: "a@example.test", email_confirmed_at: "2026-01-01", raw_user_meta_data: { perfil: "dentista" }, raw_app_meta_data: {} },
      { nome: "QA_DENTISTA_B", perfil: "dentista", status: "ativo", email: "b@example.test", email_confirmed_at: "2026-01-01", raw_user_meta_data: {}, raw_app_meta_data: {} },
      { nome: "QA_RECEPCAO", perfil: "recepcao", status: "ativo", email: "r@example.test", email_confirmed_at: "2026-01-01", raw_user_meta_data: {}, raw_app_meta_data: {} },
    ];
    const env = { HOMOLOGATION_ADMIN_EMAIL: "qa-admin@example.test" };
    expect(validateFixtureRows(rows, env)).toEqual(validateFixtureRows(rows, env));
    expect(Object.values(validateFixtureRows(rows, env)).every((item) => item.status === "PASS")).toBe(true);
    const compromised = rows.map((row) => row.nome === "QA_DENTISTA_B" ? { ...row, raw_user_meta_data: { role: "admin" } } : row);
    expect(validateFixtureRows(compromised, env).QA_DENTISTA_B.status).toBe("FAIL");
    expect(validateFixtureRows(rows.slice(1), env).QA_ADMIN.status).toBe("ACTION_REQUIRED");
  });

  it("classifica resultados fail-closed", () => {
    expect(classify(true)).toBe("PASS");
    expect(classify(false)).toBe("FAIL");
    expect(classify(true, true)).toBe("BLOCKED");
  });

  it("acumula resultados prévios somente para mesmo branch, HEAD, projeto e migrations", () => {
    const report = { git: { branch: "rc/sprint-22.7-pre-homologation", head: "abc1234" }, projectRefMasked: "abcd…wxyz", harnessRevision: "abcdef0123456789abcdef01", database: { migration0030: "APPLIED", migration0031: "APPLIED" }, scenarios: { "H01-A": { status: "BLOCKED" } } };
    const prior = { git: { ...report.git }, projectRefMasked: report.projectRefMasked, harnessRevision: report.harnessRevision, database: { ...report.database }, scenarios: { "H01-A": { status: "PASS", evidence: "author_ok" }, "H02-A": { status: "FAIL", evidence: "denied_failed" } } };
    expect(mergePriorScenarioResults(report, prior).scenarios).toMatchObject({ "H01-A": { status: "PASS" }, "H02-A": { status: "FAIL" } });
    const wrongHead = { ...report, git: { ...report.git, head: "different" }, scenarios: {} };
    expect(mergePriorScenarioResults(wrongHead, prior).scenarios).toEqual({});
    const changedHarness = { ...report, harnessRevision: "111111111111111111111111", scenarios: {} };
    expect(mergePriorScenarioResults(changedHarness, prior).scenarios).toEqual({});
  });

  it("remove token/JWT/OTP/email da representação do relatório", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature0123456789";
    const result = JSON.stringify(sanitize({ access_token: jwt, email: "qa@example.test", note: jwt, otp: "123456" }));
    expect(result).not.toContain(jwt);
    expect(result).not.toContain("qa@example.test");
    expect(result).not.toContain("123456");
  });

  it("limita cleanup a ids e marcador exatos do run e é idempotente", () => {
    const runId = "20261001123456-12345678-1234-1234-1234-123456789abc";
    const state = { runId, tag: `QA_0030_${runId}`, createdIds: [{ kind: "patient", id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", runTag: `QA_0030_${runId}` }], storagePaths: [] };
    expect(selectedIds(state).patient).toEqual(["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"]);
    expect(selectedIds({ ...state, createdIds: [] }).patient).toEqual([]);
    expect(() => selectedIds({ ...state, createdIds: [{ ...state.createdIds[0], id: "not-a-uuid", runTag: state.tag }] })).toThrow();
    expect(() => selectedIds({ ...state, tag: "QA_0030_other" })).toThrow();
    expect(() => selectedIds({ ...state, createdIds: [{ kind: "auth_user", id: state.createdIds[0].id, runTag: state.tag }] })).toThrow();

    const dbState = { ...state, storagePaths: [] };
    const owned = { patients: [{ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", nome: `${state.tag}_P1` }], appointments: [], attendances: [], documents: [] };
    expect(validateCleanupRows(dbState, owned.patients, owned.appointments, owned.attendances, owned.documents).patientSet.size).toBe(1);
    expect(() => validateCleanupRows(dbState, [{ ...owned.patients[0], nome: "Real Patient" }], [], [], [])).toThrow();
    expect(validateCleanupRows(dbState, [], [], [], []).patientSet.size).toBe(0);
  });

  it("não oferece fase para aplicar migration 0031", () => {
    expect(parseArgs(["--phase", "preflight"]).phase).toBe("preflight");
    expect(() => parseArgs(["--phase", "migration"])).toThrow();
    expect(() => parseArgs(["--phase", "apply-0031"])).toThrow();
  });
});

describe("harness de homologação 0030: isolamento temporal H02", () => {
  it("H01 e H02 usam janelas-base distintas sem sobreposição", () => {
    const appointmentWindow = (file) => {
      const source = readFileSync(new URL(`../scripts/homologacao/0030/${file}`, import.meta.url), "utf8");
      const offset = (name) => {
        const match = source.match(new RegExp(`const ${name} = localDateTime\\(new Date\\(Date\\.now\\(\\) \\+ (\\d+) \\* 60 \\* 60 \\* 1000\\)\\);`));
        expect(match, `${file}: ${name}`).not.toBeNull();
        return Number(match[1]);
      };
      return { start: offset("start"), end: offset("end") };
    };
    const h01 = appointmentWindow("h01.mjs");
    const h02 = appointmentWindow("h02.mjs");
    expect(h01).toEqual({ start: 48, end: 49 });
    expect(h02).toEqual({ start: 72, end: 73 });
    expect(h02.start).toBeGreaterThan(h01.end);
  });

  it("permite só código H02 de setup conhecido e exato, sem detalhes sensíveis", () => {
    expect(safePhaseError(new Error("H02_SETUP_FAILED:appointment_create"))).toBe("H02_SETUP_FAILED:appointment_create");
    const fallback = "execução interrompida; detalhes internos não foram impressos para evitar exposição de dados";
    for (const detail of [
      "SQL error 23505",
      "uuid=aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
      "email=qa@example.test",
      "payload={patient:1}",
      "token=synthetic-token",
      "cookie=synthetic-cookie",
      "path=/private/document.pdf",
      "\nsecret=synthetic-token",
    ]) {
      const output = safePhaseError(new Error(`H02_SETUP_FAILED:appointment_create ${detail}`));
      expect(output).toBe(fallback);
      expect(output).not.toContain(detail);
    }
    expect(safePhaseError(new Error("H02_SETUP_FAILED:unknown_label"))).toBe(fallback);
  });
});
