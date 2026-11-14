import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { projectGuard } from "./homologacao/lib/safety.mjs";

const CLEANUP_CONFIRMATION = "DELETE HOMOLOG_SEED DATA";

export function assertHomologationEnvironment() {
  const linkedProjectRefPath = resolve(process.cwd(), "supabase", ".temp", "project-ref");
  let linkedProjectRef;
  try {
    linkedProjectRef = readFileSync(linkedProjectRefPath, "utf8").trim();
  } catch {
    throw new Error("Projeto Supabase nao esta vinculado; operacao de homologacao bloqueada.");
  }
  if (!projectGuard(process.env, linkedProjectRef).pass) {
    throw new Error("FATAL — ENVIRONMENT ISOLATION GUARD FAILED");
  }
  return process.env.SUPABASE_TEST_URL;
}

export async function confirmHomologationCleanup() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("Cleanup destrutivo exige confirmacao humana em terminal interativo.");
  }
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await terminal.question(`Digite exatamente \"${CLEANUP_CONFIRMATION}\" para remover somente fixtures HOMOLOG_SEED_: `);
    if (answer !== CLEANUP_CONFIRMATION) throw new Error("Confirmacao de cleanup recusada.");
  } finally {
    terminal.close();
  }
}
