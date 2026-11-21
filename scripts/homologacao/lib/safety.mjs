import { ACK } from "./env.mjs";
import { inspectProjectGuard, projectRefFromUrl, databaseRef } from "../0030/config.mjs";
export { databaseRef } from "../0030/config.mjs";

export function loopback(value, protocols = ["http:", "https:", "postgres:", "postgresql:"]) {
  try { const u = new URL(value); return protocols.includes(u.protocol) && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname); }
  catch { return false; }
}
export function projectGuard(env, linkedRef, mode = "remote") {
  if (mode === "local") {
    const checks = { acknowledgement: env.SUPABASE_TEST_HOMOLOGATION === ACK,
      apiLoopback: loopback(env.SUPABASE_TEST_URL, ["http:"]),
      dbLoopback: loopback(env.SUPABASE_TEST_DB_URL, ["postgres:", "postgresql:"]),
      localEnvironment: env.SUPABASE_TEST_ENVIRONMENT === "local",
      publicUrlMatches: env.NEXT_PUBLIC_SUPABASE_URL === env.SUPABASE_TEST_URL,
      appLoopback: !env.SUPABASE_TEST_APP_URL || loopback(env.SUPABASE_TEST_APP_URL, ["http:"]) };
    return { pass: Object.values(checks).every(Boolean), checks };
  }
  const legacy = inspectProjectGuard(env, linkedRef);
  const ref = env.SUPABASE_TEST_PROJECT_REF;
  const denied = (env.SUPABASE_PRODUCTION_PROJECT_REFS ?? "").split(/[ ,;]+/).filter(Boolean);
  let apiCanonical = false;
  try { const u = new URL(env.SUPABASE_TEST_URL); apiCanonical = u.protocol === "https:" && !u.username && !u.password && !u.port && u.pathname === "/" && !u.search && !u.hash; } catch { /* fail closed */ }
  const publicUrls = Object.entries(env).filter(([name]) => /^(NEXT_PUBLIC_|PUBLIC_).*SUPABASE.*URL$/.test(name));
  const checks = { ...legacy.checks, linkedRefRequired: !!linkedRef && linkedRef === ref,
    environment: env.SUPABASE_TEST_ENVIRONMENT === "homologation",
    apiCanonical, dbMatches: databaseRef(env.SUPABASE_TEST_DB_URL) === ref && !!ref,
    nonProduction: !denied.includes(ref) && ![env.HOMOLOGATION_ENVIRONMENT, env.APP_ENV, env.NODE_ENV === "production" ? "" : env.NODE_ENV].some(v => /^(prod|production)$/i.test(v ?? "")),
    publicUrlsMatch: publicUrls.every(([,value]) => projectRefFromUrl(value) === ref) };
  return { pass: Object.values(checks).every(Boolean), checks };
}
export function assertGuard(env, linkedRef, mode) {
  const guard = projectGuard(env, linkedRef, mode);
  if (!guard.pass) throw new Error("FATAL — ENVIRONMENT ISOLATION GUARD FAILED");
  return guard;
}
