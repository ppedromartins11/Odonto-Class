import { existsSync, readFileSync } from "node:fs";
import { readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
export const EXPECTED_BRANCH = "rc/sprint-22.7-pre-homologation";
export const HOMOLOGATION_ACK = "I_ACKNOWLEDGE_FAKE_DATA_ONLY";
export const PROJECT_REF_PATTERN = /^[a-z0-9]{20}$/;
// Independently observed in Vercel Production. Never use this ref for QA mutations.
export const KNOWN_PRODUCTION_REFS = new Set(["sqouddqzpmkofenyufuj"]);
export const KNOWN_DR_REFS = new Set(["qprzxkolbbnqfopamfhj"]);
export const APPROVED_QA_REFS = new Set(["zxvpyxvhymuibaxgxetf"]);
export const ARTIFACT_ROOT = resolve(ROOT, "artifacts/homologacao/0030");

const envFiles = [".env.homologacao.local", ".env.test.local", ".env.local"];
let envLoaded = false;
let originalProcessEnvironment = null;

export function loadLocalEnvironment() {
  if (envLoaded) return;
  envLoaded = true;
  originalProcessEnvironment ??= new Set(Object.keys(process.env));
  if (typeof process.loadEnvFile !== "function") return;
  for (const file of envFiles) {
    try {
      process.loadEnvFile(resolve(ROOT, file));
    } catch (error) {
      if (error?.code !== "ENOENT") throw new Error(`Falha ao carregar configuração local (${file}).`);
    }
  }
}

export function reloadLocalEnvironment() {
  loadLocalEnvironment();
  const refreshNames = [
    "SUPABASE_TEST_HOMOLOGATION", "SUPABASE_TEST_URL", "SUPABASE_TEST_PROJECT_REF", "SUPABASE_TEST_ANON_KEY",
    "SUPABASE_TEST_DB_URL", "SUPABASE_TEST_SERVICE_ROLE_KEY", "NEXT_PUBLIC_SUPABASE_URL", "HOMOLOGATION_BASE_URL", "VERCEL_AUTOMATION_BYPASS_SECRET",
    "QA_SUPABASE_PROJECT_REF", "PRODUCTION_SUPABASE_PROJECT_REF", "DR_SUPABASE_PROJECT_REF", "VERCEL_PREVIEW_SUPABASE_PROJECT_REF", "VERCEL_PRODUCTION_SUPABASE_PROJECT_REF",
    "HOMOLOGATION_ADMIN_EMAIL", "HOMOLOGATION_ADMIN_PASSWORD", "HOMOLOGATION_DENTIST_A_EMAIL",
    "HOMOLOGATION_DENTIST_A_PASSWORD", "HOMOLOGATION_DENTIST_B_EMAIL", "HOMOLOGATION_DENTIST_B_PASSWORD",
    "HOMOLOGATION_RECEPTION_EMAIL", "HOMOLOGATION_RECEPTION_PASSWORD",
  ];
  for (const name of refreshNames) {
    if (!originalProcessEnvironment.has(name)) delete process.env[name];
  }
  envLoaded = false;
  loadLocalEnvironment();
}

export function projectRefFromUrl(value) {
  if (!value) return null;
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    const suffix = ".supabase.co";
    if (!hostname.endsWith(suffix)) return null;
    const ref = hostname.slice(0, -suffix.length);
    return PROJECT_REF_PATTERN.test(ref) ? ref : null;
  } catch {
    return null;
  }
}

export function databaseRef(value) {
  try {
    const u = new URL(value);
    if (!["postgres:", "postgresql:"].includes(u.protocol) || !u.password || !u.username) return null;
    const direct = /^db\.([a-z0-9]{20})\.supabase\.co$/.exec(u.hostname);
    if (direct && decodeURIComponent(u.username) === "postgres") return direct[1];
    if (/^[a-z0-9-]+\.pooler\.supabase\.com$/.test(u.hostname)) {
      return /^postgres\.([a-z0-9]{20})$/.exec(decodeURIComponent(u.username))?.[1] ?? null;
    }
  } catch { /* fail closed */ }
  return null;
}

export function inspectProjectGuard(env = process.env, linkedRef = null) {
  const expected = env.SUPABASE_TEST_PROJECT_REF?.trim() ?? "";
  const qaRef = env.QA_SUPABASE_PROJECT_REF?.trim() ?? "";
  const productionRef = env.PRODUCTION_SUPABASE_PROJECT_REF?.trim() ?? "";
  const drRef = env.DR_SUPABASE_PROJECT_REF?.trim() ?? "";
  const previewRef = env.VERCEL_PREVIEW_SUPABASE_PROJECT_REF?.trim() ?? "";
  const vercelProductionRef = env.VERCEL_PRODUCTION_SUPABASE_PROJECT_REF?.trim() ?? "";
  const testRef = projectRefFromUrl(env.SUPABASE_TEST_URL?.trim());
  const dbRef = databaseRef(env.SUPABASE_TEST_DB_URL);
  const publicUrl = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const publicRef = publicUrl ? projectRefFromUrl(publicUrl) : null;
  const expectedValid = PROJECT_REF_PATTERN.test(expected);
  const checks = {
    acknowledgement: env.SUPABASE_TEST_HOMOLOGATION === HOMOLOGATION_ACK,
    expectedRefValid: expectedValid,
    qaRefValid: PROJECT_REF_PATTERN.test(qaRef),
    productionRefValid: PROJECT_REF_PATTERN.test(productionRef),
    drRefValid: PROJECT_REF_PATTERN.test(drRef),
    officialRefsMatch: APPROVED_QA_REFS.has(qaRef) && KNOWN_PRODUCTION_REFS.has(productionRef) && KNOWN_DR_REFS.has(drRef),
    refsDistinct: new Set([qaRef, productionRef, drRef]).size === 3,
    targetIsQa: expectedValid && expected === qaRef,
    targetIsApprovedQa: expectedValid && APPROVED_QA_REFS.has(expected),
    targetNotProduction: expectedValid && expected !== productionRef && !KNOWN_PRODUCTION_REFS.has(expected),
    targetNotDr: expectedValid && expected !== drRef && !KNOWN_DR_REFS.has(expected),
    previewBindingIsQa: PROJECT_REF_PATTERN.test(previewRef) && previewRef === qaRef,
    productionBindingMatches: PROJECT_REF_PATTERN.test(vercelProductionRef) && vercelProductionRef === productionRef,
    testUrlMatches: !!testRef && expectedValid && testRef === expected,
    dbUrlMatches: !!dbRef && expectedValid && dbRef === expected,
    publicUrlMatches: !!publicRef && expectedValid && publicRef === expected,
    linkedRefMatches: !!linkedRef && expectedValid && linkedRef === expected,
  };
  return { checks, pass: Object.values(checks).every(Boolean), expectedRef: expectedValid ? expected : null };
}

export function currentGitState() {
  const run = (args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  return {
    branch: run(["branch", "--show-current"]),
    head: run(["rev-parse", "--short", "HEAD"]),
    dirty: run(["status", "--short"]).length > 0,
  };
}

export function readLinkedProjectRef() {
  const path = resolve(ROOT, "supabase/.temp/project-ref");
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf8").trim();
}

export function requiredEnvironment(env = process.env) {
  const names = [
    "SUPABASE_TEST_HOMOLOGATION",
    "SUPABASE_TEST_URL",
    "SUPABASE_TEST_PROJECT_REF",
    "QA_SUPABASE_PROJECT_REF",
    "PRODUCTION_SUPABASE_PROJECT_REF",
    "DR_SUPABASE_PROJECT_REF",
    "VERCEL_PREVIEW_SUPABASE_PROJECT_REF",
    "VERCEL_PRODUCTION_SUPABASE_PROJECT_REF",
    "SUPABASE_TEST_ANON_KEY",
    "SUPABASE_TEST_DB_URL",
  ];
  return names.filter((name) => !env[name]?.trim());
}

export function maskedProjectRef(ref) {
  if (!ref || ref.length < 8) return "ausente";
  return `${ref.slice(0, 4)}…${ref.slice(-4)}`;
}

export function harnessRevision() {
  const root = resolve(ROOT, "scripts/homologacao/0030");
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && entry.name.endsWith(".mjs")) files.push(path);
    }
  };
  visit(root);
  files.sort();
  const hasher = createHash("sha256");
  for (const path of files) hasher.update(path.slice(root.length)).update(readFileSync(path));
  const packageJson = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8"));
  const scripts = Object.fromEntries(Object.entries(packageJson.scripts ?? {}).filter(([name]) => name.startsWith("homologate:0030")));
  hasher.update(JSON.stringify(scripts));
  return hasher.digest("hex").slice(0, 24);
}
