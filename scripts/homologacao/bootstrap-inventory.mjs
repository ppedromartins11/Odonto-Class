import { Client } from "pg";
import { readBootstrapEnvironment } from "./bootstrap-provisioner.mjs";
import { assertGuard } from "./lib/safety.mjs";
import { readLinkedProjectRef } from "./0030/config.mjs";

const env = readBootstrapEnvironment();
assertGuard(env, readLinkedProjectRef(), "remote");
const db = new Client({ connectionString: env.SUPABASE_TEST_DB_URL, connectionTimeoutMillis: 8000,
  application_name: "odonto-qa-bootstrap-inventory-readonly" });
try {
  await db.connect();
  await db.query("begin read only");
  const result = await db.query(`select
    (select count(*)::int from auth.users) auth_users,
    (select count(*)::int from public.usuarios) profiles,
    (select count(*)::int from public.convites_provisionamento) invitations,
    (select count(*)::int from supabase_migrations.schema_migrations) migrations`);
  await db.query("rollback");
  console.log(JSON.stringify({ environmentIsolation: "PASS", ...result.rows[0] }));
} catch {
  await db.query("rollback").catch(() => {});
  console.error("QA_BOOTSTRAP_READONLY_INVENTORY: BLOCKED");
  process.exitCode = 1;
} finally {
  await db.end().catch(() => {});
}
