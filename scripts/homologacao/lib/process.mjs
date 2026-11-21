import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { ROOT } from "./env.mjs";

const require = createRequire(import.meta.url);
export function npmCommand() {
  const npmPath = process.env.npm_execpath;
  return [process.execPath, npmPath ?? resolve(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js")];
}
export function supabaseCommand() { return [process.execPath, require.resolve("supabase/dist/supabase.js")]; }

// Captured output is never streamed: subprocess errors can contain credentials/PDF/PHI.
export function execute(command, args = [], { env = process.env, cwd = ROOT, timeoutMs = 600_000 } = {}) {
  return new Promise(resolveResult => {
    let stdout = "", stderr = "", timedOut = false, overflow = false;
    const child = spawn(command, args, { env, cwd, windowsHide: true, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    const max = 16 * 1024 * 1024;
    for (const [stream, assign] of [[child.stdout, x => { stdout += x; }], [child.stderr, x => { stderr += x; }]]) {
      stream.on("data", chunk => { if (stdout.length + stderr.length < max) assign(chunk.toString()); else { overflow = true; child.kill(); } });
    }
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
    child.once("error", () => { clearTimeout(timer); resolveResult({ code: 127, stdout: "", stderr: "command unavailable", unavailable: true }); });
    child.once("close", code => { clearTimeout(timer); resolveResult({ code: code ?? 1, stdout, stderr, timedOut, overflow }); });
  });
}
