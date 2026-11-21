import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ARTIFACT_ROOT } from "../config.mjs";

export function statePath(runId) {
  return join(ARTIFACT_ROOT, "runs", `${runId}.json`);
}

export async function saveRunState(state) {
  const directory = join(ARTIFACT_ROOT, "runs");
  await mkdir(directory, { recursive: true });
  await writeFile(statePath(state.runId), `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
}

export async function loadRunState(runId) {
  const parsed = JSON.parse(await readFile(statePath(runId), "utf8"));
  if (parsed.runId !== runId) throw new Error("RUN_STATE_MISMATCH");
  return parsed;
}
