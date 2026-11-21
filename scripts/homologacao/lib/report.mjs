import { mkdir, writeFile, rename } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { ROOT } from "./env.mjs";

export function sanitize(value) {
  if (typeof value === "string") return value
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,"[REDACTED]")
    .replace(/\b(?:sb_secret|sb_publishable)_[A-Za-z0-9_-]{12,}\b/g,"[REDACTED]")
    .replace(/\bBearer\s+[A-Za-z0-9._-]+/gi,"[REDACTED]")
    .replace(/https?:\/\/[^\s"']+\/storage\/v1\/object\/sign\/[^\s"']+/gi,"[REDACTED_SIGNED_URL]")
    .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "[REDACTED_CONNECTION]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[REDACTED_EMAIL]");
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key,item]) => {
    const auditId = typeof item === "string" && ((key === "runId" && /^\d{14,20}-[a-f0-9-]{36}$/.test(item))
      || (["head","sha256","sourceSha256"].includes(key) && /^[a-f0-9]{40,64}$/.test(item)));
    return [key, auditId ? item : /password|passwd|secret|token|jwt|otp|authorization|api.?key|anon.?key|service.?role|connection|string.*url|email|storage.?path|signed.?url|magic.?link|cid/i.test(key) ? "[REDACTED]" : sanitize(item)];
  }));
  return value;
}
export function newReport(phase) {
  return { runId: `${new Date().toISOString().replace(/[-:.TZ]/g, "")}-${randomUUID()}`, timestamp: new Date().toISOString(), phase,
    gates: {}, suites: [], cleanup: { status: "NOT REQUIRED" }, advisors: {}, conclusion: "BLOCKED", productionGate: "BLOCKED" };
}
export function aggregate(items) {
  const statuses = items.map(v => typeof v === "string" ? v : v.status);
  return statuses.includes("FAIL") ? "FAIL" : statuses.length && statuses.every(s => s === "PASS" || s === "NOT REQUIRED") ? "PASS" : "BLOCKED";
}
export async function saveReport(report, root = ROOT) {
  const dir = resolve(root, "artifacts/homologacao");
  await mkdir(resolve(dir, "runs"), { recursive: true });
  await mkdir(resolve(dir, "logs"), { recursive: true });
  const safe = sanitize(report);
  const json = JSON.stringify(safe, null, 2) + "\n";
  const integration=(safe.suites??[]).reduce((total,suite)=>{for(const key of ["passed","failed","skipped"])total[key]+=suite[key]??0;return total;},{passed:0,failed:0,skipped:0});
  const markdown = ["# ODONTO CLASS — HOMOLOGAÇÃO", "", `Run: ${safe.runId}`, `Timestamp: ${safe.timestamp}`, `Branch: ${safe.git?.branch ?? "UNKNOWN"}`, `Commit: ${safe.git?.head ?? "UNKNOWN"}`, "",
    ...Object.entries(safe.gates).map(([name,item]) => `${name}: ${item.status}${item.reason ? ` (${item.reason})` : ""}`), "",
    ...((safe.remote?.checks??[]).filter(check=>check.status!=="PASS").map(check=>`Remote ${check.name}: ${check.status}${check.reason?` (${check.reason})`:""}`)),
    `Unit: passed=${safe.unitTests?.passed??0}; failed=${safe.unitTests?.failed??0}; skipped=${safe.unitTests?.skipped??0}`,
    `Integration: passed=${integration.passed}; failed=${integration.failed}; skipped=${integration.skipped}`,"",
    `CLEANUP: ${safe.cleanup.status}`, `HOMOLOGATION: ${safe.conclusion}`, `PRODUCTION GATE: ${safe.productionGate}`, "", "Consulte JSON para itens de preflight, suítes/contagens, advisors e evidências de cleanup.", ""].join("\n");
  for (const [suffix, content] of [["json",json],["md",markdown]]) {
    await writeFile(resolve(dir, "runs", `${report.runId}.${suffix}`), content, { mode: 0o600 });
    const tmp = resolve(dir, `latest.${suffix}.${report.runId}.tmp`);
    await writeFile(tmp, content, { mode: 0o600 });
    await rename(tmp, resolve(dir, `latest.${suffix}`));
  }
  // Diagnostic event log is intentionally allowlisted, with no raw subprocess output.
  await writeFile(resolve(dir, "logs", `${report.runId}.jsonl`), Object.entries(safe.gates).map(([gate,item]) => JSON.stringify({runId:safe.runId,gate,...item})).join("\n")+"\n", {mode:0o600});
}
