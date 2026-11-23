import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const sensitiveName = /(?:PASSWORD|SECRET|TOKEN|DATABASE_URL|DB_URL|SERVICE_ROLE_KEY|API_KEY|ANON_KEY|JWT)/i;
const placeholder = /^(?:<[^>]+>|\$\{[^}]+\}|YOUR_[A-Z_]+|CHANGE_ME|REPLACE_ME|EXAMPLE_[A-Z_]+)$/i;
const credentialUri = /postgres(?:ql)?:\/\/[^\s/:@]+:[^\s@]+@/i;

export function detectEnvironmentCredentialIssues(filename, content) {
  const issues = [];
  const envFile = /(?:^|\/)\.env(?:\.|$)/.test(filename);
  if (!envFile) return issues;
  const sample = /(?:example|sample|template)(?:\.[^/]*)?$/i.test(filename);
  if (!sample) {
    issues.push("tracked_environment_file");
    return issues;
  }
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    const key = match[1];
    const value = match[2].replace(/^["']|["']$/g, "").trim();
    if (credentialUri.test(value)) {
      issues.push(`credential_uri_in_${key}`);
    } else if (sensitiveName.test(key) && value && !placeholder.test(value)) {
      issues.push(`nonempty_sensitive_${key}`);
    }
  }
  return issues;
}

export function checkTrackedEnvironmentFiles(root = process.cwd()) {
  const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" })
    .split("\0").filter(Boolean).filter((name) => /(?:^|\/)\.env(?:\.|$)/.test(name));
  const findings = [];
  for (const filename of tracked) {
    const checks = detectEnvironmentCredentialIssues(filename, readFileSync(resolve(root, filename), "utf8"));
    if (checks.length) findings.push({ filename, codes: checks });
  }
  return findings;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const findings = checkTrackedEnvironmentFiles();
  if (findings.length) {
    for (const issue of findings) {
      // Never log file contents, values, or raw diff.
      console.error(`REPO_ENV_GUARD_BLOCKED: ${issue.filename} [${issue.codes.join(", ")}]`);
    }
    process.exitCode = 1;
  } else {
    console.log("REPO_ENV_GUARD_PASS: tracked environment templates contain no populated credentials.");
  }
}
