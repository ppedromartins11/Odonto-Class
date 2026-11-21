import { lstat, mkdir, readFile, readdir, realpath, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { basename, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT } from "./lib/env.mjs";

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const SAFE_COMPONENT = /^[a-z0-9._-]+$/i;
const EXTENSIONS = new Set([".json", ".jsonl", ".md", ".log", ".txt"]);
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_FILES = 10_000;
const RUN_ID = /^\d{14,20}-[0-9a-f]{8}-[0-9a-f-]{27}$/i;

function candidateId(record) {
  if (typeof record.id === "string" && UUID.test(record.id)) return record.id.toLowerCase();
  if (typeof record.key === "string") return UUID.exec(record.key)?.[0]?.toLowerCase() ?? null;
  return null;
}

export function candidatesFromInventory(inventory) {
  if (!Array.isArray(inventory.records) || !Array.isArray(inventory.audit)) {
    throw new Error("UUID_TRACE_INVALID_INVENTORY");
  }
  const candidates = new Map();
  for (const record of inventory.records) {
    const id = candidateId(record);
    if (!id || typeof record.table !== "string" || !SAFE_COMPONENT.test(record.table)) {
      throw new Error("UUID_TRACE_INVALID_RECORD");
    }
    const previous = candidates.get(id);
    if (previous && previous !== record.table) throw new Error("UUID_TRACE_CONFLICTING_ENTITY_TYPE");
    candidates.set(id, record.table);
  }
  for (const record of inventory.audit) {
    const id = candidateId(record);
    if (!id) throw new Error("UUID_TRACE_INVALID_AUDIT");
    const previous = candidates.get(id);
    if (previous && previous !== "auditoria") throw new Error("UUID_TRACE_CONFLICTING_ENTITY_TYPE");
    candidates.set(id, "auditoria");
  }
  if (candidates.size === 0 || candidates.size > 1_000) throw new Error("UUID_TRACE_INVALID_CANDIDATE_COUNT");
  return candidates;
}

async function safeFile(path) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_FILE_BYTES) {
    throw new Error("UUID_TRACE_UNSAFE_ARTIFACT");
  }
  return path;
}

async function historicalFiles(archive) {
  const files = [];
  async function descend(path, segments) {
    if ((await lstat(path)).isSymbolicLink()) throw new Error("UUID_TRACE_UNSAFE_ARTIFACT");
    for (const entry of await readdir(path, { withFileTypes: true })) {
      if (!SAFE_COMPONENT.test(entry.name) || entry.isSymbolicLink()) throw new Error("UUID_TRACE_UNSAFE_ARTIFACT");
      const nextSegments = [...segments, entry.name];
      const next = join(path, entry.name);
      if (entry.isDirectory()) {
        if (segments.length === 0 && !["runs", "logs", "0030"].includes(entry.name)) continue;
        await descend(next, nextSegments);
      } else if (entry.isFile()) {
        if (segments.length === 0 && !["latest.json", "latest.md"].includes(entry.name)) continue;
        if (!EXTENSIONS.has(entry.name.slice(entry.name.lastIndexOf(".")))) continue;
        files.push({ path: await safeFile(next), artifact: nextSegments.join("/") });
        if (files.length > MAX_FILES) throw new Error("UUID_TRACE_TOO_MANY_ARTIFACTS");
      } else throw new Error("UUID_TRACE_UNSAFE_ARTIFACT");
    }
  }
  await descend(archive, []);
  return files.sort((a, b) => a.artifact.localeCompare(b.artifact));
}

function runFromArtifact(artifact) {
  const stem = basename(artifact).replace(/\.(jsonl|json|md|log|txt)$/i, "");
  return RUN_ID.test(stem) ? stem : "NONE";
}

export async function traceArtifactUuids({ root = ROOT, inventoryPath } = {}) {
  const archive = resolve(root, "artifacts/homologacao");
  const source = inventoryPath ? resolve(inventoryPath) : join(archive, "remote-inventory", "latest.json");
  const rel = relative(await realpath(archive), await realpath(source));
  if (rel.startsWith(".." + sep) || rel === ".." || rel.startsWith(sep)) throw new Error("UUID_TRACE_INVENTORY_OUTSIDE_ARCHIVE");
  await safeFile(source);
  const candidates = candidatesFromInventory(JSON.parse(await readFile(source, "utf8")));
  const files = await historicalFiles(archive);
  const hits = new Map([...candidates.keys()].map(id => [id, []]));
  for (const file of files) {
    const contents = (await readFile(file.path, "utf8")).toLowerCase();
    for (const id of candidates.keys()) {
      if (contents.includes(id)) hits.get(id).push({ artifact: file.artifact, run: runFromArtifact(file.artifact) });
    }
  }
  const rows = [...candidates].sort(([a], [b]) => a.localeCompare(b)).map(([uuid, entity_type]) => {
    const found = hits.get(uuid);
    const runs = found.map(item => item.run).filter(run => run !== "NONE").sort();
    return {
      uuid, entity_type,
      first_seen_run: runs[0] ?? "NONE",
      last_seen_run: runs.at(-1) ?? "NONE",
      artifact: found.length ? found.map(item => item.artifact) : ["NONE"],
    };
  });
  return { readOnlySource: true, candidateCount: rows.length, scannedArtifactCount: files.length,
    hits: rows.filter(row => row.artifact[0] !== "NONE").length, rows };
}

export async function writeUuidTrace(report, root = ROOT) {
  const dir = resolve(root, "artifacts/homologacao/ownership-history");
  await mkdir(dir, { recursive: true });
  const lines = ["# Histórico local de UUIDs candidatos", "", `Candidatos: ${report.candidateCount}; artefatos examinados: ${report.scannedArtifactCount}; UUIDs encontrados: ${report.hits}.`, "", "O índice não prova origem; somente registra aparições literais em relatórios e logs históricos.", "", "| UUID | Entidade | Primeiro run | Último run | Artefato |", "| --- | --- | --- | --- | --- |", ...report.rows.map(row => `| ${row.uuid} | ${row.entity_type} | ${row.first_seen_run} | ${row.last_seen_run} | ${row.artifact.join(", ")} |`), ""];
  for (const [suffix, contents] of [["json", JSON.stringify(report, null, 2) + "\n"], ["md", lines.join("\n")]]) {
    const tmp = join(dir, `latest.${suffix}.${randomUUID()}.tmp`);
    await writeFile(tmp, contents, { mode: 0o600 });
    await rename(tmp, join(dir, `latest.${suffix}`));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length !== 2) {
    process.stderr.write("UUID_TRACE_BLOCKED: arguments are not supported\n");
    process.exitCode = 2;
  } else {
    try {
      const report = await traceArtifactUuids();
      await writeUuidTrace(report);
      process.stdout.write(`UUID_TRACE: candidates=${report.candidateCount}; scanned=${report.scannedArtifactCount}; hits=${report.hits}; report=artifacts/homologacao/ownership-history/latest.md\n`);
    } catch (error) {
      process.stderr.write(`UUID_TRACE_BLOCKED: ${error.message}\n`);
      process.exitCode = 1;
    }
  }
}
