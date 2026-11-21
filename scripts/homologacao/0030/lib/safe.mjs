import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ARTIFACT_ROOT } from "../config.mjs";

const SENSITIVE_KEYS = /(password|passwd|secret|token|jwt|authorization|apikey|api_key|service.?role|otp|totp|signed.?url|magic.?link|connection.?string|email|cid|patient.?name)/i;
const SECRET_VALUE_PATTERNS = [
  /\beyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\b/g,
  /\b(?:sb_secret|sb_publishable)_[A-Za-z0-9_-]{12,}\b/g,
  /\b(?:Bearer\s+)?[A-Za-z0-9_-]{32,}\b/g,
  /https?:\/\/[^\s"']+\/storage\/v1\/object\/sign\/[^\s"']+/gi,
];
export const REQUIRED_SCENARIO_KEYS = ["H01-A", "H01-B", "H01-C", "H01-D", "H01-E", "H02-A", "H02-B", "H02-C", "H02-D", "H02-E", "H02-F"];

export function redactText(value) {
  let result = String(value);
  for (const pattern of SECRET_VALUE_PATTERNS) result = result.replace(pattern, "[REDACTED]");
  return result;
}

export function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, SENSITIVE_KEYS.test(key) ? "[REDACTED]" : sanitize(item)]));
  }
  return typeof value === "string" ? redactText(value) : value;
}

export function classify(ok, blocked = false) {
  if (blocked) return "BLOCKED";
  return ok ? "PASS" : "FAIL";
}

export function mergePriorScenarioResults(report, previous) {
  if (!previous || previous.git?.branch !== report.git?.branch || previous.git?.head !== report.git?.head
    || previous.projectRefMasked !== report.projectRefMasked
    || previous.harnessRevision !== report.harnessRevision
    || previous.database?.migration0030 !== report.database?.migration0030
    || previous.database?.migration0031 !== report.database?.migration0031) return report;
  for (const name of REQUIRED_SCENARIO_KEYS) {
    const item = previous.scenarios?.[name];
    if (item && ["PASS", "FAIL"].includes(item.status) && typeof item.evidence === "string") report.scenarios[name] = sanitize(item);
  }
  return report;
}

export function createRunId() {
  return `${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${randomUUID()}`;
}

export async function saveReport(report) {
  await mkdir(ARTIFACT_ROOT, { recursive: true });
  const safe = sanitize(report);
  const jsonPath = join(ARTIFACT_ROOT, "0030-report.json");
  const mdPath = join(ARTIFACT_ROOT, "0030-report.md");
  await writeFile(jsonPath, `${JSON.stringify(safe, null, 2)}\n`, { mode: 0o600 });
  await writeFile(mdPath, renderMarkdown(safe), { mode: 0o600 });
  return { jsonPath, mdPath };
}

function renderMarkdown(report) {
  const lines = [
    "# Homologação migration 0030",
    "",
    `- Timestamp: ${report.timestamp}`,
    `- Branch: ${report.git?.branch ?? "indisponível"}`,
    `- HEAD: ${report.git?.head ?? "indisponível"}`,
    `- Projeto: ${report.projectRefMasked ?? "indisponível"}`,
    `- Preflight: ${report.preflight?.status ?? "BLOCKED"}`,
    `- Migration 0030: ${report.database?.migration0030 ?? "BLOCKED"}`,
    `- Migration 0031: ${report.database?.migration0031 ?? "BLOCKED"}`,
    `- Signup público: ${report.auth?.signupDisabled === true ? "desabilitado" : report.auth?.signupDisabled === false ? "habilitado" : "não confirmado"}`,
    `- Orphans Auth → perfil: ${report.database?.authWithoutProfile ?? "não confirmado"}`,
    `- Orphans perfil → Auth: ${report.database?.profileWithoutAuth ?? "não confirmado"}`,
    "",
    "## Fixtures",
    "",
    ...Object.entries(report.fixtures ?? {}).map(([name, item]) => `- ${name}: ${item.status}${item.reason ? ` (${item.reason})` : ""}`),
    "",
    "## Login QA configurado localmente",
    "",
    ...Object.entries(report.actorLoginReady ?? {}).map(([name, ready]) => `- ${name}: ${ready ? "configurado" : "pendente"}`),
    "",
    "## Cenários",
    "",
    ...Object.entries(report.scenarios ?? {}).map(([name, item]) => `- ${name}: ${item.status}${item.evidence ? ` — ${item.evidence}` : ""}`),
    "",
    `- H03: ${report.knownResults?.H03 ?? "não informado"}`,
    `- H04: ${report.knownResults?.H04 ?? "não informado"}`,
    `- H05: ${report.knownResults?.H05 ?? "não informado"}`,
    `- 0030_HOMOLOGATION: ${report.final?.homologation ?? "BLOCKED"}`,
    `- 0031_GATE: ${report.final?.migration0031Gate ?? "BLOCKED"}`,
    "",
    "Relatório sanitizado; sem credenciais, IDs de usuários, dados clínicos ou URLs assinadas.",
    "",
  ];
  return lines.join("\n");
}
