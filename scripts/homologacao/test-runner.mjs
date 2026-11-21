import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { npmCommand } from "./lib/process.mjs";

export function isLoopback(value) {
  try { return ["localhost", "127.0.0.1", "[::1]"].includes(new URL(value).hostname.toLowerCase()); }
  catch { return false; }
}

export function isLocalOnlySource(source) {
  return /describe\.skipIf\(/.test(source) && (/!local\(url\)/.test(source) || /!localOnly/.test(source));
}

export async function discoverIntegrationSuites(root) {
  const directory = resolve(root, "tests/integration");
  const files = (await readdir(directory)).filter(name => name.endsWith(".test.ts")).sort();
  return Promise.all(files.map(async name => ({
    path: `tests/integration/${name}`,
    localOnly: isLocalOnlySource(await readFile(join(directory, name), "utf8")),
    cleanupMutation: name === "qa-cleanup.test.ts" || name === "documents-official.cleanup-proof.test.ts",
  })));
}

function normalizedPath(path, root) {
  return relative(root, isAbsolute(path) ? path : resolve(root, path)).replaceAll("\\", "/");
}

export function normalizeVitestResult(result, { files, root, code }) {
  const expected = files.map(path => normalizedPath(path, root));
  const actual = new Map((result.testResults ?? []).map(item => [normalizedPath(item.name, root), item]));
  const normalized = expected.map(path => {
    const item = actual.get(path);
    const cases = item?.assertionResults ?? [];
    const passed = cases.filter(test => test.status === "passed").length;
    const failed = cases.filter(test => test.status === "failed").length;
    const skipped = cases.filter(test => !["passed", "failed"].includes(test.status)).length;
    return {
      path, count: cases.length, passed, failed, skipped,
      caseNames: cases.map(test => String(test.fullName ?? test.title ?? "").slice(0, 250)),
      status: !item || !cases.length ? "BLOCKED" : failed || item.status === "failed" ? "FAIL" : skipped ? "BLOCKED" : "PASS",
    };
  });
  const count = normalized.reduce((sum, item) => sum + item.count, 0);
  const passed = normalized.reduce((sum, item) => sum + item.passed, 0);
  const failed = normalized.reduce((sum, item) => sum + item.failed, 0);
  const skipped = normalized.reduce((sum, item) => sum + item.skipped, 0);
  const unexpected = [...actual.keys()].some(path => !expected.includes(path));
  const status = code !== 0 || result.success === false || failed || normalized.some(item => item.status === "FAIL")
    ? "FAIL" : !count || skipped || unexpected || normalized.some(item => item.status !== "PASS") ? "BLOCKED" : "PASS";
  return { status, count, passed, failed, skipped, files: normalized, assertionsEnforced: true,
    reason: unexpected ? "unexpected_test_file" : !count ? "zero_tests" : skipped ? "critical_tests_skipped" : code !== 0 ? "test_process_failed" : undefined };
}

export async function runIntegration({ env, files, execute, root, runId }) {
  const blocked = reason => ({ status: "BLOCKED", count: 0, passed: 0, failed: 0, skipped: 0, files: [], reason });
  if (!Array.isArray(files) || !files.length) return blocked("no_test_files");
  if (env.SUPABASE_TEST_HOMOLOGATION !== "I_ACKNOWLEDGE_FAKE_DATA_ONLY") return blocked("homologation_ack_missing");
  const paths = files.map(file => normalizedPath(file, root));
  if (paths.some(path => !/^tests\/integration\/[^/]+\.test\.ts$/.test(path))) return blocked("test_path_outside_integration");
  for (const path of paths) {
    try {
      if (!(await stat(resolve(root, path))).isFile()) return blocked("test_file_missing");
      const source = await readFile(resolve(root, path), "utf8");
      if (isLocalOnlySource(source) && (!isLoopback(env.SUPABASE_TEST_URL) || !isLoopback(env.SUPABASE_TEST_DB_URL))) return blocked("local_only_target_required");
      // This historical cleanup searches all QA prefixes, rather than this run's IDs.
      if (path.endsWith("/qa-cleanup.test.ts") && (!isLoopback(env.SUPABASE_TEST_URL) || !isLoopback(env.SUPABASE_TEST_DB_URL))) return blocked("global_cleanup_requires_disposable_local_stack");
      if (path.endsWith("/release-highs.authorization.test.ts") && !isLoopback(env.SUPABASE_TEST_APP_URL)) return blocked("local_http_app_required");
    } catch { return blocked("test_file_missing"); }
  }
  const directory = await mkdtemp(join(tmpdir(), "odonto-homologation-vitest-"));
  const outputFile = join(directory, "result.json");
  try {
    const [command, ...prefix] = npmCommand();
    const response = await execute(command, [...prefix, "run", "test:integration", "--", "--reporter=json", `--outputFile=${outputFile}`, "--expect.requireAssertions=true", ...paths], { env, cwd: root, timeoutMs: 900_000 });
    let result;
    try { result = JSON.parse(await readFile(outputFile, "utf8")); }
    catch { return { ...blocked("vitest_report_missing_or_invalid"), status: response.code === 0 ? "BLOCKED" : "FAIL" }; }
    return { ...normalizeVitestResult(result, { files: paths, root, code: response.code }), runId };
  } finally {
    // Raw Vitest failures can contain SQL, signed URLs and Auth responses.
    await rm(directory, { recursive: true, force: true });
  }
}

export async function discoverUnitFiles(root) {
  const files = [];
  const excludedRoot = new Set(["node_modules", ".next", ".git", "artifacts", ".backups", ".dr", ".vercel",
    ".agents", ".claude", ".codex", "coverage", "out", "build"]);
  const visit = async directory => {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, item.name);
      if (item.isDirectory()) {
        const relativePath = normalizedPath(path, root);
        if ((directory === root && excludedRoot.has(item.name)) || ["node_modules", ".next", ".git"].includes(item.name)
          || ["tests/integration", "supabase/.temp", "supabase/.branches"].includes(relativePath)) continue;
        await visit(path);
      } else if (item.isFile() && /\.(test|spec)\.[cm]?[jt]sx?$/.test(item.name)) files.push(normalizedPath(path, root));
    }
  };
  await visit(root);
  return files.sort();
}

export async function runUnit({ env, execute, root, runId }) {
  const files = await discoverUnitFiles(root);
  const directory = await mkdtemp(join(tmpdir(), "odonto-homologation-unit-"));
  const outputFile = join(directory, "result.json");
  try {
    const [command, ...prefix] = npmCommand();
    const response = await execute(command, [...prefix, "test", "--", "--reporter=json", `--outputFile=${outputFile}`, "--expect.requireAssertions=true"], { env, cwd: root, timeoutMs: 600_000 });
    let result;
    try { result = JSON.parse(await readFile(outputFile, "utf8")); }
    catch { return { status: response.code === 0 ? "BLOCKED" : "FAIL", count: 0, passed: 0, failed: 0, skipped: 0, files: [], reason: "vitest_report_missing_or_invalid", runId }; }
    return { ...normalizeVitestResult(result, { files, root, code: response.code }), runId };
  } finally { await rm(directory, { recursive: true, force: true }); }
}
