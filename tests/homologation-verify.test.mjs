import { beforeEach, describe, expect, it, vi } from "vitest";
import { types } from "pg";
import { compareCleanupSnapshots, inspectCleanupTarget, captureCleanupBaseline, verifyCleanup } from "../scripts/homologacao/verify.mjs";
import { compareMigrationVersions, runRemoteChecks, readSignupStatus } from "../scripts/homologacao/remote-checks.mjs";
import { withReadOnlyDatabase } from "../scripts/homologacao/0030/lib/database.mjs";

vi.mock("../scripts/homologacao/0030/lib/database.mjs", async (importOriginal) => ({
  ...await importOriginal(), withReadOnlyDatabase: vi.fn(),
}));

const env = {
  SUPABASE_TEST_HOMOLOGATION: "I_ACKNOWLEDGE_FAKE_DATA_ONLY",
  SUPABASE_TEST_URL: "http://127.0.0.1:54321",
  SUPABASE_TEST_DB_URL: "postgresql://fixture:fake-password@127.0.0.1:54322/postgres",
};
const inventory = (entries) => new Map(Object.entries(entries).map(([table, keys]) => [table, new Set(keys)]));
const tables = ["public.usuarios", "auth.users", "auth.identities", "auth.mfa_factors", "auth.sessions", "storage.objects"];

function fakeSnapshotClient(keys = {}) {
  return { query: vi.fn(async (sql) => {
    if (sql.startsWith("SET TRANSACTION")) return { rows: [] };
    if (sql.includes("from pg_class")) return { rows: tables.map((table) => {
      const [schema_name, table_name] = table.split(".");
      // pg leaves PostgreSQL name[] as a string. Its text[] parser returns an array.
      const fieldType = sql.includes("a.attname::text") ? 1009 : 1003;
      return { schema_name, table_name, primary_key: types.getTypeParser(fieldType)("{id}") };
    }) };
    const table = tables.find((name) => sql.includes(name.split(".").map((part) => `"${part}"`).join(".")));
    return { rows: (keys[table] ?? []).map((inventory_key) => ({ inventory_key })) };
  }) };
}

beforeEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); });

describe("cleanup identity proof", () => {
  it("requires acknowledged loopback API and PostgreSQL, including IPv6", () => {
    expect(inspectCleanupTarget(env).pass).toBe(true);
    expect(inspectCleanupTarget({ ...env, SUPABASE_TEST_URL: "http://[::1]:1234", SUPABASE_TEST_DB_URL: "postgres://x:y@[::1]:1235/postgres" }).pass).toBe(true);
    expect(inspectCleanupTarget({ ...env, SUPABASE_TEST_URL: "https://remote.supabase.co" }).pass).toBe(false);
    expect(inspectCleanupTarget({ ...env, SUPABASE_TEST_DB_URL: "postgres://x:y@db.remote.supabase.co/postgres" }).pass).toBe(false);
    expect(inspectCleanupTarget({ ...env, SUPABASE_TEST_DB_URL: "postgres://x:y@localhost.attacker.test/postgres" }).pass).toBe(false);
    expect(inspectCleanupTarget({ ...env, SUPABASE_TEST_HOMOLOGATION: "" }).pass).toBe(false);
  });

  it("never opens a connection for a remote target or an absent baseline", async () => {
    expect((await captureCleanupBaseline({ ...env, SUPABASE_TEST_URL: "https://remote.supabase.co" })).status).toBe("BLOCKED");
    expect((await verifyCleanup(env, { status: "PASS" })).status).toBe("BLOCKED");
    expect(withReadOnlyDatabase).not.toHaveBeenCalled();
  });

  it("detects residual rows and deletion of baseline rows even at equal counts", () => {
    const before = inventory({ "public.pacientes": ["baseline-id"] });
    const after = inventory({ "public.pacientes": ["replacement-id"] });
    const result = compareCleanupSnapshots(before, after);
    expect(result.status).toBe("FAIL");
    expect(result.checks[0]).toMatchObject({ baselineCount: 1, currentCount: 1, addedCount: 1, removedCount: 1 });
    expect(JSON.stringify(result)).not.toContain("baseline-id");
    expect(JSON.stringify(result)).not.toContain("replacement-id");
  });

  it("passes unchanged identities and blocks missing inventories/table drift", () => {
    const before = inventory({ "public.pacientes": ["one"], "storage.objects": [] });
    expect(compareCleanupSnapshots(before, inventory({ "public.pacientes": ["one"], "storage.objects": [] })).status).toBe("PASS");
    expect(compareCleanupSnapshots(before, inventory({ "public.pacientes": ["one"] })).status).toBe("FAIL");
    expect(compareCleanupSnapshots(new Map(), new Map()).status).toBe("BLOCKED");
  });

  it("reports added Auth sessions as residual until teardown", () => {
    const result = compareCleanupSnapshots(inventory({ "auth.sessions": [] }), inventory({ "auth.sessions": ["temporary"] }));
    expect(result.status).toBe("FAIL");
    expect(result.temporarySessionsResidual).toBe(1);
    expect(result.checks[0].reason).toBe("temporary_auth_sessions_residual");
  });

  it("allows only the empty invitation table introduced after the 0029 baseline", () => {
    const before = inventory({ "public.usuarios": [], "auth.users": [] });
    expect(compareCleanupSnapshots(before, inventory({ "public.usuarios": [], "auth.users": [], "public.convites_provisionamento": [] })).status).toBe("PASS");
    expect(compareCleanupSnapshots(before, inventory({ "public.usuarios": [], "auth.users": [], "public.convites_provisionamento": ["leftover"] })).status).toBe("FAIL");
    expect(compareCleanupSnapshots(before, inventory({ "public.usuarios": [], "auth.users": [], "public.unexpected": [] })).status).toBe("FAIL");
  });

  it("keeps baseline identities private and verifies using the same target", async () => {
    const client = fakeSnapshotClient({ "auth.users": ['["private-auth-id"]'] });
    withReadOnlyDatabase.mockImplementation(async (_url, action) => action(client));
    const baseline = await captureCleanupBaseline(env);
    expect(baseline.status).toBe("PASS");
    expect(JSON.stringify(baseline)).not.toContain("private-auth-id");
    expect((await verifyCleanup(env, baseline)).status).toBe("PASS");
    withReadOnlyDatabase.mockClear();
    expect((await verifyCleanup({ ...env, SUPABASE_TEST_DB_URL: env.SUPABASE_TEST_DB_URL.replace("54322", "54323") }, baseline)).status).toBe("BLOCKED");
    expect(withReadOnlyDatabase).not.toHaveBeenCalled();
  });

  it("fails closed for a table lacking primary key or unreadable snapshot", async () => {
    const client = fakeSnapshotClient();
    client.query.mockImplementation(async (sql) => sql.startsWith("SET TRANSACTION") ? { rows: [] } : {
      rows: tables.map((table) => {
        const [schema_name, table_name] = table.split(".");
        return { schema_name, table_name, primary_key: table === "public.usuarios" ? null : ["id"] };
      }),
    });
    withReadOnlyDatabase.mockImplementation(async (_url, action) => action(client));
    expect((await captureCleanupBaseline(env)).status).toBe("BLOCKED");
    withReadOnlyDatabase.mockRejectedValue(new Error("connection string must not escape"));
    const failed = await captureCleanupBaseline(env);
    expect(failed.status).toBe("BLOCKED");
    expect(JSON.stringify(failed)).not.toContain("connection string");
  });

  it("captures more than one PostgreSQL page without exposing identities", async () => {
    const client = fakeSnapshotClient();
    const original = client.query.getMockImplementation();
    const keys = Array.from({ length: 1001 }, (_, index) => `["private-${String(index).padStart(4, "0")}"]`);
    client.query.mockImplementation(async (sql, args) => {
      if (!sql.includes('from "public"."usuarios"')) return original(sql, args);
      return { rows: keys.filter((key) => args[0] === null || key > args[0])
        .slice(0, args[1]).map((inventory_key) => ({ inventory_key })) };
    });
    withReadOnlyDatabase.mockImplementation(async (_url, action) => action(client));
    const baseline = await captureCleanupBaseline(env);
    expect(baseline.status).toBe("PASS");
    expect(baseline.tables.find((table) => table.table === "public.usuarios").rowCount).toBe(1001);
    expect(client.query.mock.calls.filter(([sql]) => sql.includes('from "public"."usuarios"'))).toHaveLength(2);
    expect(JSON.stringify(baseline)).not.toContain("private-");
  });
});

describe("remote read-only checkpoint", () => {
  it("compares the complete migration chain, including 0031", () => {
    const versions = Array.from({ length: 31 }, (_, index) => String(index + 1).padStart(4, "0"));
    expect(compareMigrationVersions(versions, [...versions].reverse()).status).toBe("PASS");
    expect(compareMigrationVersions(versions, versions.slice(0, -1))).toMatchObject({ status: "FAIL", missing: ["0031"] });
    expect(compareMigrationVersions(versions, [...versions, "0032"])).toMatchObject({ status: "FAIL", unexpected: ["0032"] });
    expect(compareMigrationVersions([], []).status).toBe("FAIL");
    expect(compareMigrationVersions(["0001", "0001"], ["0001"]).status).toBe("FAIL");
  });

  it("does not connect or fetch Auth settings after guard failure", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect((await runRemoteChecks({ env, guard: { pass: false }, root: "." })).status).toBe("BLOCKED");
    expect(withReadOnlyDatabase).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("blocks linked-project mismatch before network access", async () => {
    expect((await runRemoteChecks({ env: { ...env, SUPABASE_TEST_PROJECT_REF: "a" }, linkedRef: "b", guard: { pass: true }, root: "." })).status).toBe("BLOCKED");
    expect(withReadOnlyDatabase).not.toHaveBeenCalled();
  });

  it("treats missing/conflicting Auth settings as unverified", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({}) })));
    expect(await readSignupStatus({ ...env, SUPABASE_TEST_ANON_KEY: "fake" })).toBeNull();
    globalThis.fetch.mockResolvedValue({ ok: true, json: async () => ({ disable_signup: true, disable_signups: false }) });
    expect(await readSignupStatus({ ...env, SUPABASE_TEST_ANON_KEY: "fake" })).toBeNull();
    globalThis.fetch.mockResolvedValue({ ok: true, json: async () => ({ disable_signup: true }) });
    expect(await readSignupStatus({ ...env, SUPABASE_TEST_ANON_KEY: "fake" })).toBe(true);
  });
});
