import { beforeAll } from "vitest";
import { projectGuard } from "../../scripts/homologacao/lib/safety.mjs";
import { readLinkedProjectRef } from "../../scripts/homologacao/0030/config.mjs";

beforeAll(() => {
  const mode = process.env.SUPABASE_TEST_ENVIRONMENT === "local" ? "local" : "remote";
  const linkedRef = mode === "local" ? null : readLinkedProjectRef();
  if (!projectGuard(process.env, linkedRef, mode).pass) {
    throw new Error("FATAL — ENVIRONMENT ISOLATION GUARD FAILED");
  }
});
