import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";

const HOMOLOGATION_ACK = "I_ACKNOWLEDGE_FAKE_DATA_ONLY";
const CLEANUP_CONFIRMATION = "DELETE HOMOLOG_SEED DATA";
const PROJECT_REF_PATTERN = /^[a-z0-9]{20}$/;

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Variavel de seguranca ${name} nao configurada.`);
  return value;
}

function projectRefFromUrl(value) {
  const hostname = new URL(value).hostname.toLowerCase();
  const suffix = ".supabase.co";
  if (!hostname.endsWith(suffix)) throw new Error("URL de homologacao fora do dominio Supabase esperado.");
  const projectRef = hostname.slice(0, -suffix.length);
  if (!PROJECT_REF_PATTERN.test(projectRef)) throw new Error("Project ref da URL de homologacao invalido.");
  return projectRef;
}

export function assertHomologationEnvironment() {
  if (process.env.SUPABASE_TEST_HOMOLOGATION !== HOMOLOGATION_ACK) {
    throw new Error("Homologacao ficticia nao confirmada.");
  }

  const expectedProjectRef = required("SUPABASE_TEST_PROJECT_REF");
  if (!PROJECT_REF_PATTERN.test(expectedProjectRef)) throw new Error("Project ref permitido invalido.");

  const testUrl = required("SUPABASE_TEST_URL");
  const appUrl = required("NEXT_PUBLIC_SUPABASE_URL");
  if (projectRefFromUrl(testUrl) !== expectedProjectRef || projectRefFromUrl(appUrl) !== expectedProjectRef) {
    throw new Error("Projeto solicitado nao corresponde a allowlist de homologacao.");
  }

  const linkedProjectRefPath = resolve(process.cwd(), "supabase", ".temp", "project-ref");
  let linkedProjectRef;
  try {
    linkedProjectRef = readFileSync(linkedProjectRefPath, "utf8").trim();
  } catch {
    throw new Error("Projeto Supabase nao esta vinculado; operacao de homologacao bloqueada.");
  }
  if (linkedProjectRef !== expectedProjectRef) {
    throw new Error("Projeto Supabase vinculado nao corresponde a allowlist de homologacao.");
  }

  return testUrl;
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
