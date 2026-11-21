import { readFileSync, existsSync } from "node:fs";
import { parseEnv } from "node:util";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
export const ACK = "I_ACKNOWLEDGE_FAKE_DATA_ONLY";
export function readEnvironment(root = ROOT, inherited = process.env) {
  const loaded = {};
  for (const name of [".env.local", ".env.test.local", ".env.homologacao.local"]) {
    const path = resolve(root, name);
    if (existsSync(path)) Object.assign(loaded, parseEnv(readFileSync(path, "utf8")));
  }
  return { ...loaded, ...inherited };
}

// Do not let Vite/Next restore remote values from .env files in the local lab.
export function localEnvironment(base, local) {
  const env = { ...base };
  for (const name of Object.keys(env)) {
    if (/SUPABASE|HOMOLOGATION|QA_|VERCEL|DATABASE_URL|PGPASSWORD|PGHOST|PGUSER/.test(name)) delete env[name];
  }
  return { ...env, ...local, NEXT_PUBLIC_SUPABASE_URL: local.SUPABASE_TEST_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: local.SUPABASE_TEST_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: local.SUPABASE_TEST_SERVICE_ROLE_KEY,
    SUPABASE_TEST_HOMOLOGATION: ACK, SUPABASE_TEST_ENVIRONMENT: "local" };
}
