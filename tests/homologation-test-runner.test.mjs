import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { discoverIntegrationSuites, discoverUnitFiles, isLocalOnlySource, normalizeVitestResult, runIntegration, runUnit } from "../scripts/homologacao/test-runner.mjs";
import { configureLocalToml, isolatedLocalEnvironment, isLocalDockerEndpoint, mapLocalStatus, prepareLocalStack, projectIdForRoot } from "../scripts/homologacao/local-stack.mjs";

const temporaryRoots = [];
afterEach(async () => { for (const root of temporaryRoots.splice(0)) await rm(root, { recursive: true, force: true }); });
const env = { SUPABASE_TEST_HOMOLOGATION: "I_ACKNOWLEDGE_FAKE_DATA_ONLY", SUPABASE_TEST_URL: "http://127.0.0.1:15000", SUPABASE_TEST_DB_URL: "postgresql://localhost:15001/postgres", SUPABASE_TEST_APP_URL: "http://localhost:15002" };
async function fixture(name = "test.authorization.test.ts", source = "describe('qa', () => {});") {
  const root = await mkdtemp(join(tmpdir(), "odonto-runner-test-")); temporaryRoots.push(root);
  await mkdir(join(root, "tests/integration"), { recursive: true });
  const path = `tests/integration/${name}`;
  await writeFile(join(root, path), source);
  return { root, path };
}
function report(root, path, statuses = ["passed"]) {
  return { success: true, testResults: [{ name: join(root, path), status: "passed", assertionResults: statuses.map((status, index) => ({ status, fullName: `H06: caso ${index}`, failureMessages: ["sensitive-content-must-not-survive"] })) }] };
}
function executor(result, code = 0) {
  let output;
  const execute = vi.fn(async (_command, args) => {
    output = args.find(value => value.startsWith("--outputFile=")).slice("--outputFile=".length);
    await writeFile(output, JSON.stringify(result));
    return { code, stdout: "sensitive output discarded", stderr: "" };
  });
  return { execute, output: () => output };
}

describe("homologation evidence is fail-closed", () => {
  it("uses the integration script, enforces assertions, normalizes counts and removes raw report", async () => {
    const { root, path } = await fixture();
    const mock = executor(report(root, path));
    const result = await runIntegration({ env, files: [path], root, execute: mock.execute, runId: "qa-test" });
    expect(result).toMatchObject({ status: "PASS", count: 1, passed: 1, failed: 0, skipped: 0, assertionsEnforced: true });
    expect(mock.execute.mock.calls[0][1]).toContain("test:integration");
    expect(mock.execute.mock.calls[0][1]).toContain("--expect.requireAssertions=true");
    expect(JSON.stringify(result)).not.toContain("sensitive");
    await expect(stat(mock.output())).rejects.toMatchObject({ code: "ENOENT" });
  });
  it.each(["pending", "skipped", "todo", "disabled"])("blocks %s even when Vitest exits zero", async status => {
    const { root, path } = await fixture();
    const mock = executor(report(root, path, ["passed", status]));
    const result = await runIntegration({ env, files: [path], root, execute: mock.execute, runId: "qa-test" });
    expect(result).toMatchObject({ status: "BLOCKED", passed: 1, skipped: 1 });
  });
  it("fails on process failure despite all reported tests passing", async () => {
    const { root, path } = await fixture();
    const mock = executor(report(root, path), 1);
    expect((await runIntegration({ env, files: [path], root, execute: mock.execute, runId: "qa-test" })).status).toBe("FAIL");
  });
  it("blocks zero tests and absent expected files in JSON", () => {
    const root = process.cwd();
    expect(normalizeVitestResult({ success: true, testResults: [] }, { files: ["tests/integration/required.test.ts"], root, code: 0 }).status).toBe("BLOCKED");
    const empty = report(root, "tests/integration/required.test.ts", []);
    expect(normalizeVitestResult(empty, { files: ["tests/integration/required.test.ts"], root, code: 0 }).reason).toBe("zero_tests");
  });
  it("blocks extra files and propagates hook failures", () => {
    const root = process.cwd(); const path = "tests/integration/required.test.ts";
    const result = report(root, path); result.testResults.push(report(root, "tests/integration/unrequested.test.ts").testResults[0]);
    expect(normalizeVitestResult(result, { files: [path], root, code: 0 }).status).toBe("BLOCKED");
    const hookFailed = report(root, path); hookFailed.testResults[0].status = "failed";
    expect(normalizeVitestResult(hookFailed, { files: [path], root, code: 0 }).status).toBe("FAIL");
  });
  it("blocks missing files, traversal, and missing acknowledgement before launching", async () => {
    const { root, path } = await fixture(); const execute = vi.fn();
    for (const files of [["tests/integration/missing.test.ts"], ["../private.test.ts"], []]) {
      expect((await runIntegration({ env, files, root, execute, runId: "qa" })).status).toBe("BLOCKED");
    }
    expect((await runIntegration({ env: {}, files: [path], root, execute, runId: "qa" })).status).toBe("BLOCKED");
    expect(execute).not.toHaveBeenCalled();
  });
  it("preserves local-only gates and refuses remote execution", async () => {
    const { root, path } = await fixture("lot-finalization.concurrency.test.ts", "describe.skipIf(!local(url) || !local(dbUrl)).sequential('qa', () => {});");
    const execute = vi.fn();
    const result = await runIntegration({ env: { ...env, SUPABASE_TEST_URL: "https://example.supabase.co" }, files: [path], root, execute, runId: "qa" });
    expect(result.reason).toBe("local_only_target_required"); expect(execute).not.toHaveBeenCalled();
    expect((await discoverIntegrationSuites(root))[0].localOnly).toBe(true);
    expect(isLocalOnlySource("describe.skipIf(!localOnly).sequential('HIGHs', () => {});")).toBe(true);
  });
  it("requires HTTP binary evidence for release-highs and confines global cleanup to local", async () => {
    const first = await fixture("release-highs.authorization.test.ts"); const execute = vi.fn();
    expect((await runIntegration({ env: { ...env, SUPABASE_TEST_APP_URL: undefined }, files: [first.path], root: first.root, execute, runId: "qa" })).reason).toBe("local_http_app_required");
    const second = await fixture("qa-cleanup.test.ts");
    expect((await runIntegration({ env: { ...env, SUPABASE_TEST_DB_URL: "postgresql://db.example.com/postgres" }, files: [second.path], root: second.root, execute, runId: "qa" })).reason).toBe("global_cleanup_requires_disposable_local_stack");
    expect(execute).not.toHaveBeenCalled();
  });
  it("blocks invalid reporter output and still removes the raw temporary report", async () => {
    const { root, path } = await fixture(); let output;
    const execute = async (_command, args) => { output = args.find(arg => arg.startsWith("--outputFile=")).slice(13); await writeFile(output, "invalid"); return { code: 0 }; };
    const result = await runIntegration({ env, files: [path], root, execute, runId: "qa" });
    expect(result.reason).toBe("vitest_report_missing_or_invalid");
    await expect(stat(output)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("runs official unit command and expects every discovered file", async () => {
    const { root } = await fixture();
    const path = "lib/domain.test.ts"; await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), "test");
    expect(await discoverUnitFiles(root)).toEqual([path]);
    const mock = executor(report(root, path));
    expect((await runUnit({ env, root, execute: mock.execute, runId: "qa" })).status).toBe("PASS");
    expect(mock.execute.mock.calls[0][1]).toContain("test");
    await expect(stat(mock.output())).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("discovers product tests without traversing backup or agent-tool directories", async () => {
    const { root } = await fixture();
    for (const path of ["app/route.test.tsx", "lib/domain.test.ts", "scripts/release.test.mjs", "tests/local.test.mjs",
      ".backups/private.test.ts", ".agents/skills/tool.test.mjs", "artifacts/generated.test.mjs"]) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), "fixture");
    }
    expect(await discoverUnitFiles(root)).toEqual([
      "app/route.test.tsx", "lib/domain.test.ts", "scripts/release.test.mjs", "tests/local.test.mjs",
    ]);
  });
});

describe("isolated local stack boundaries", () => {
  it("drops inherited remote targets, actors and CLI overrides before mapping loopback status", () => {
    const inherited = { PATH: "keep", SUPABASE_CLI_BINARY_OVERRIDE: "evil", NEXT_PUBLIC_SUPABASE_URL: "remote", HOMOLOGATION_ADMIN_EMAIL: "remote", SUPABASE_ACCESS_TOKEN: "remote" };
    expect(isolatedLocalEnvironment(inherited)).toEqual({ PATH: "keep" });
    const mapped = mapLocalStatus({ API_URL: "http://[::1]:1234", DB_URL: "postgresql://localhost:1235/postgres", ANON_KEY: "fake-anon", SERVICE_ROLE_KEY: "fake-service" }, inherited);
    expect(mapped).toMatchObject({ SUPABASE_TEST_URL: "http://[::1]:1234", HOMOLOGATION_LOCAL_SIGNUP_ADVERSARIAL: "1" });
    expect(mapped.SUPABASE_ACCESS_TOKEN).toBeUndefined();
  });
  it("rejects non-loopback API/DB and absent secret keys from actual status", () => {
    const status = { API_URL: "http://localhost:1234", DB_URL: "postgresql://localhost:1235/postgres", ANON_KEY: "fake", SERVICE_ROLE_KEY: "fake" };
    for (const invalid of [{ API_URL: "https://remote.supabase.co" }, { API_URL: "file://localhost/path" }, { DB_URL: "http://localhost:1235" }, { DB_URL: "postgresql://remote/postgres" }, { SERVICE_ROLE_KEY: "" }]) expect(() => mapLocalStatus({ ...status, ...invalid }, {})).toThrow("LOCAL_STACK_STATUS_INVALID");
  });
  it("assigns independent container project IDs to independent worktrees", async () => {
    const first = await fixture(); const second = await fixture();
    expect(projectIdForRoot(first.root)).not.toBe(projectIdForRoot(second.root));
    expect(projectIdForRoot(first.root)).toBe(projectIdForRoot(first.root));
    expect(projectIdForRoot(first.root)).toMatch(/^odonto-homologation-[a-f0-9]{12}$/);
  });
  it("rejects a symlink/junction escaping the workspace before any command or write", async () => {
    const first = await fixture(); const other = await fixture();
    await symlink(other.root, join(first.root, "artifacts"), process.platform === "win32" ? "junction" : "dir");
    const execute = vi.fn();
    await expect(prepareLocalStack({ runId: "qa-run", env, execute, root: first.root })).rejects.toThrow("LOCAL_STACK_WORKDIR_SYMLINK");
    expect(execute).not.toHaveBeenCalled();
    await expect(stat(join(other.root, "homologacao"))).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("refuses a nested migrations junction and preserves historical source migrations", async () => {
    const { root } = await fixture(); const actualRoot = await realpath(root);
    const source = join(root, "supabase/migrations"); const workdir = join(root, "artifacts/homologacao/local-stack");
    await mkdir(source, { recursive: true }); await writeFile(join(source, "0001_real.sql"), "preserve history");
    await mkdir(join(workdir, "supabase"), { recursive: true });
    await writeFile(join(workdir, "runner-owner.json"), JSON.stringify({ projectId: projectIdForRoot(actualRoot), root: actualRoot, stackOwned: true }));
    await symlink(source, join(workdir, "supabase/migrations"), process.platform === "win32" ? "junction" : "dir");
    const execute = vi.fn();
    await expect(prepareLocalStack({ runId: "qa", env, execute, root })).rejects.toThrow("LOCAL_STACK_WORKDIR_SYMLINK");
    expect(execute).not.toHaveBeenCalled(); expect(await readFile(join(source, "0001_real.sql"), "utf8")).toBe("preserve history");
  });
  it("never adopts an unowned running stack on a second attempt", async () => {
    const { root } = await fixture();
    const execute = vi.fn(async (command, args) => {
      if (command === "docker" && args[0] === "context") return { code: 0, stdout: '"npipe:////./pipe/dockerDesktopLinuxEngine"', stderr: "" };
      if (command === "docker") return { code: 0, stdout: "version", stderr: "" };
      if (args.includes("--help")) return { code: 0, stdout: "--exclude edge-runtime --local --no-seed", stderr: "" };
      if (args[1] === "init") {
        const path = join(root, "artifacts/homologacao/local-stack/supabase/config.toml");
        await mkdir(dirname(path), { recursive: true }); await writeFile(path, 'project_id = "local-stack"\n[local_smtp]\nport = 54324\n');
      }
      return { code: 0, stdout: "{}", stderr: "" };
    });
    for (const runId of ["first", "second"]) await expect(prepareLocalStack({ runId, env, execute, root })).rejects.toThrow("LOCAL_STACK_UNOWNED_RUNNING_STACK");
    const owner = JSON.parse(await readFile(join(root, "artifacts/homologacao/local-stack/runner-owner.json"), "utf8"));
    expect(owner.stackOwned).toBe(false);
    expect(execute.mock.calls.some(call => !call[1].includes("--help") && (call[1][1] === "start" || call[1].includes("reset")))).toBe(false);
  });
  it("configures isolated ports, TOTP and adversarial signup without enabling unrelated services", () => {
    const ports = { api: 18001, db: 18002, shadow: 18003, studio: 18004, mail: 18005, smtp: 18006, pop3: 18007, analytics: 18008 };
    const toml = configureLocalToml('project_id = "restore-local"\n[api]\nport = 54321\n[db]\nport = 54322\n[local_smtp]\nport = 54324\n[auth]\nenable_signup = false\n', ports);
    expect(toml).toContain('project_id = "odonto-homologation"');
    expect(toml).not.toContain("54321"); expect(toml).toContain("enroll_enabled = true");
    expect(toml).not.toContain("54324"); expect(toml).not.toContain("[inbucket]");
    expect(toml).toContain("sql_paths = []"); expect(toml).toContain("enable_signup = true");
  });
  it.each(["mailpit", "inbucket"])("uses generated %s SMTP section without adding unsupported sections", section => {
    const ports = { api: 18001, db: 18002, shadow: 18003, studio: 18004, mail: 18005, smtp: 18006, pop3: 18007, analytics: 18008 };
    const config = configureLocalToml(`[${section}]\nport = 54324\n`, ports);
    expect(config).not.toContain("54324"); expect(config).not.toContain("[local_smtp]");
  });
  it("fails before mutation when Docker is unavailable and releases its owned lock", async () => {
    const { root } = await fixture(); const execute = vi.fn(async () => ({ code: 1, stdout: "", stderr: "" }));
    await expect(prepareLocalStack({ runId: "qa-run", env, execute, root })).rejects.toThrow("DOCKER_UNAVAILABLE");
    expect(execute.mock.calls.map(call => call[0])).toEqual(["docker"]);
    await expect(stat(join(root, "artifacts/homologacao/local-stack/runner.lock"))).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("resumes owner setup after Docker recovery and resets only its local baseline before bootstrap", async () => {
    const { root } = await fixture();
    await expect(prepareLocalStack({ runId: "first", env, execute: async () => ({ code: 1 }), root })).rejects.toThrow("DOCKER_UNAVAILABLE");
    await mkdir(join(root, "supabase/migrations"), { recursive: true });
    for (let version = 1; version <= 33; version++) await writeFile(join(root, "supabase/migrations", `${String(version).padStart(4, "0")}_qa.sql`), "-- fake SQL, never executed");
    let statusCalls = 0;
    const execute = vi.fn(async (command, args) => {
      if (command === "docker" && args[0] === "context") return { code: 0, stdout: '"npipe:////./pipe/dockerDesktopLinuxEngine"', stderr: "" };
      if (command === "docker") return { code: 0, stdout: "test-version", stderr: "" };
      if (args.includes("--help")) return { code: 0, stdout: "--exclude edge-runtime --local --no-seed", stderr: "" };
      if (args[1] === "init") {
        const config = join(root, "artifacts/homologacao/local-stack/supabase/config.toml");
        await mkdir(dirname(config), { recursive: true });
        await writeFile(config, 'project_id = "local-stack"\n[local_smtp]\nport = 54324\n');
      }
      if (args[1] === "status") {
        if (statusCalls++ === 0) return { code: 1, stdout: "", stderr: "" };
        return { code: 0, stdout: JSON.stringify({ API_URL: "http://localhost:15000", DB_URL: "postgresql://localhost:15001/postgres", ANON_KEY: "fake", SERVICE_ROLE_KEY: "fake" }), stderr: "" };
      }
      return { code: 0, stdout: "", stderr: "" };
    });
    const beforeBootstrap = vi.fn(async () => ({ status: "BLOCKED" }));
    await expect(prepareLocalStack({ runId: "second", env, execute, root, beforeBootstrap })).rejects.toThrow("LOCAL_STACK_BASELINE_FAILED");
    expect(beforeBootstrap).toHaveBeenCalledOnce();
    const cliArgs = execute.mock.calls.filter(call => call[0] !== "docker").map(call => call[1]);
    expect(cliArgs.some(args => args[1] === "start")).toBe(true);
    expect(cliArgs.some(args => args[1] === "db" && args[2] === "reset" && args.includes("--local") && args.includes("--no-seed"))).toBe(true);
    expect(cliArgs.some(args => args.includes("--linked") || args.includes("--db-url"))).toBe(false);
    expect(await readFile(join(root, "artifacts/homologacao/local-stack/supabase/config.toml"), "utf8")).toContain(`project_id = "${projectIdForRoot(root)}"`);
  });
  it("refuses unowned workdir and never touches an existing restore stack", async () => {
    const { root } = await fixture(); const directory = join(root, "artifacts/homologacao/local-stack");
    await mkdir(directory, { recursive: true }); await writeFile(join(directory, "unowned"), "keep"); const execute = vi.fn();
    await expect(prepareLocalStack({ runId: "qa-run", env, execute, root })).rejects.toThrow("LOCAL_STACK_UNOWNED_WORKDIR");
    expect(await readFile(join(directory, "unowned"), "utf8")).toBe("keep"); expect(execute).not.toHaveBeenCalled();
  });
  it.each(["container", "volume"])("refuses orphaned stopped %s resources before start/reset", async kind => {
    const { root } = await fixture(); const projectId = projectIdForRoot(await realpath(root));
    const execute = vi.fn(async (_command, args) => {
      if (args[0] === "context") return { code: 0, stdout: '"unix:///var/run/docker.sock"' };
      return { code: 0, stdout: (kind === "container" && args[0] === "ps") || (kind === "volume" && args[0] === "volume") ? `supabase_db_${projectId}` : "version" };
    });
    await expect(prepareLocalStack({ runId: "qa", env, execute, root })).rejects.toThrow("LOCAL_STACK_UNOWNED_RESOURCE_PRESENT");
    expect(execute.mock.calls.every(call => call[0] === "docker")).toBe(true);
  });
  it("forbids a remote Docker host before contacting the daemon", async () => {
    const { root } = await fixture(); const execute = vi.fn();
    await expect(prepareLocalStack({ runId: "qa", env: { ...env, DOCKER_HOST: "tcp://production.example.test:2375" }, execute, root })).rejects.toThrow("DOCKER_REMOTE_DAEMON_FORBIDDEN");
    expect(execute).not.toHaveBeenCalled();
  });
  it("rejects a remote selected Docker context before docker info", async () => {
    const { root } = await fixture(); const execute = vi.fn(async () => ({ code: 0, stdout: '"ssh://production.example.test"' }));
    await expect(prepareLocalStack({ runId: "qa", env: { ...env, DOCKER_CONTEXT: "remote" }, execute, root })).rejects.toThrow("DOCKER_REMOTE_DAEMON_FORBIDDEN");
    expect(execute).toHaveBeenCalledOnce(); expect(execute.mock.calls[0][1]).toContain("remote");
  });
  it("recognizes only local Docker endpoints", () => {
    for (const endpoint of ["unix:///var/run/docker.sock", "npipe:////./pipe/docker_engine", "tcp://127.0.0.1:2375", "tcp://[::1]:2375"]) expect(isLocalDockerEndpoint(endpoint)).toBe(true);
    for (const endpoint of ["ssh://localhost", "tcp://remote.test:2375", "unix://remote.test/socket", "invalid"]) expect(isLocalDockerEndpoint(endpoint)).toBe(false);
  });
});
