import test from "node:test";
import assert from "node:assert/strict";
import { detectEnvironmentCredentialIssues } from "./repository-env-guard.mjs";

test("rejects tracked non-template env files", () => {
  assert.deepEqual(detectEnvironmentCredentialIssues(".env.production", ""), ["tracked_environment_file"]);
});
test("allows blank sensitive fields and harmless opt-in switches", () => {
  assert.deepEqual(detectEnvironmentCredentialIssues(".env.homologacao.example",
    "SUPABASE_TEST_DB_URL=\nSUPABASE_SECRET_KEY=\nSUPABASE_TEST_HOMOLOGATION=I_ACKNOWLEDGE_FAKE_DATA_ONLY\n"), []);
});
test("rejects a populated credential without disclosing its value", () => {
  const findings = detectEnvironmentCredentialIssues(".env.test.example",
    "SUPABASE_TEST_DB_URL=postgres" + "ql://fixture:fictional@localhost:5432/db");
  assert.deepEqual(findings, ["credential_uri_in_SUPABASE_TEST_DB_URL"]);
});
test("rejects pasted secret keys even when URI format is not used", () => {
  const findings = detectEnvironmentCredentialIssues(".env.example", "SUPABASE_SECRET_KEY=not-a-real-secret");
  assert.deepEqual(findings, ["nonempty_sensitive_SUPABASE_SECRET_KEY"]);
});
test("allows named placeholders for local setup", () => {
  assert.deepEqual(detectEnvironmentCredentialIssues(".env.sample",
    "SUPABASE_SECRET_KEY=${SUPABASE_SECRET_KEY}\nDB_PASSWORD=<local-only>"), []);
});
test("does not scan unrelated source files", () => {
  assert.deepEqual(detectEnvironmentCredentialIssues("src/config.ts", "API_KEY=opaque"), []);
});
