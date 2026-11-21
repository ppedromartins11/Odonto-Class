import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { ROOT } from "./lib/env.mjs";
import { execute, npmCommand, supabaseCommand } from "./lib/process.mjs";
import { projectGuard } from "./lib/safety.mjs";
import { aggregate } from "./lib/report.mjs";

export function migrationInventory(root = ROOT) {
  return readdirSync(resolve(root,"supabase/migrations")).filter(f=>f.endsWith(".sql")).sort().map(file=>({
    file, version: file.split("_")[0], sha256: createHash("sha256").update(readFileSync(resolve(root,"supabase/migrations",file))).digest("hex") }));
}
export function integrationInventory(root = ROOT) {
  return readdirSync(resolve(root,"tests/integration")).filter(file=>file.endsWith(".test.ts")).sort().map(file=>{
    const path=`tests/integration/${file}`;
    const source=readFileSync(resolve(root,path),"utf8");
    // Any skipIf safety condition must run in a local lab; remote is explicit allowlist.
    return {path,localOnly:/describe\.skipIf\(!local|\bisLocal\b|function local\(/.test(source),cleanup:file.includes("cleanup"),critical:true};
  });
}
export const SOURCE_FINGERPRINT_VERSION = 2;

// Runtime, validation, release tooling and deploy inputs. Local state and secrets
// are excluded by name before any file content is read.
const SOURCE_DIRECTORIES = ["app", "components", "lib", "server", "types", "scripts", "tests", "public",
  "supabase/migrations", "supabase/functions", "supabase/tests", ".github/workflows", ".github/actions"];
const REQUIRED_DIRECTORIES = ["app", "components", "lib", "scripts", "tests", "public", "supabase/migrations", ".github/workflows"];
const EXCLUDED_DIRECTORIES = new Set(["node_modules", ".next", ".git", ".vercel", ".turbo", "__pycache__", ".temp", ".branches"]);
const EXCLUDED_SOURCE_DIRECTORIES = new Set(["scripts/tmp"]);
const AMBIGUOUS_GENERATED_DIRECTORIES = new Set(["coverage", "artifacts", "build", "dist", "out", "tmp", "temp"]);
const EXCLUDED_FILE = /(^\.env(?:\.|$)|^\.npmrc$|^next-env\.d\.ts$|^\.gitkeep$|\.(?:log|tmp|temp|tsbuildinfo|dump|backup)$)/i;
const SENSITIVE_FILE = /(?:credential|secret|private[-_.]?key)[^/]*\.(?:json|ya?ml|toml|txt)$|\.(?:pem|key|p12|pfx|crt|pdf)$/i;
const EXCLUDED_SOURCE_PATH = new Set(["scripts/recovery/legacy-pg-dump.env.ts.txt"]);
const SOURCE_FILE = /\.(?:ts|tsx|js|jsx|mjs|mts|cjs|cts|json|css|scss|sass|less|mdx|sql|sh|ps1|py|svg|png|jpe?g|webp|gif|ico|woff2?|ttf|wasm|toml|ya?ml|graphql|gql)$/i;
const ROOT_CONFIG = /^(?:proxy|middleware|instrumentation|sentry\.[^.]+\.config|next\.config|eslint\.config|postcss\.config|tailwind\.config|playwright\.config|vitest(?:\.integration)?\.config)\.(?:ts|tsx|js|mjs|mts|cjs|cts)$|^tsconfig(?:\.[^.]+)?\.json$|^(?:package(?:-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|vercel\.json|\.node-version|\.gitignore)$/;

function assertNoSymlink(root, path) {
  let current=root;
  for(const segment of path.split("/")) {
    current=resolve(current,segment);
    if(lstatSync(current).isSymbolicLink())throw new Error("SOURCE_FINGERPRINT_SYMLINK_UNSUPPORTED");
  }
}

export function sourceFingerprint(root = ROOT) {
  const files=[];
  const visit=(directory)=>{
    for(const item of readdirSync(resolve(root,directory),{withFileTypes:true})) {
      const path=`${directory}/${item.name}`;
      if(item.isSymbolicLink())throw new Error("SOURCE_FINGERPRINT_SYMLINK_UNSUPPORTED");
      if(item.isDirectory()) {
        if(EXCLUDED_DIRECTORIES.has(item.name)||EXCLUDED_SOURCE_DIRECTORIES.has(path))continue;
        if(AMBIGUOUS_GENERATED_DIRECTORIES.has(item.name))throw new Error("SOURCE_FINGERPRINT_UNCLASSIFIED_DIRECTORY");
        visit(path);
      } else if(item.isFile()&&!EXCLUDED_FILE.test(item.name)&&!EXCLUDED_SOURCE_PATH.has(path)) {
        if(SENSITIVE_FILE.test(item.name))throw new Error("SOURCE_FINGERPRINT_SENSITIVE_FILE");
        if(!SOURCE_FILE.test(item.name))throw new Error("SOURCE_FINGERPRINT_UNCLASSIFIED_FILE");
        files.push(path);
      }
    }
  };
  for(const directory of REQUIRED_DIRECTORIES)if(!existsSync(resolve(root,directory)))throw new Error("SOURCE_FINGERPRINT_REQUIRED_DIRECTORY_MISSING");
  for(const directory of SOURCE_DIRECTORIES)if(existsSync(resolve(root,directory))) {
    assertNoSymlink(root,directory);
    visit(directory);
  }
  for(const item of readdirSync(root,{withFileTypes:true})) {
    if(item.isSymbolicLink()&&ROOT_CONFIG.test(item.name))throw new Error("SOURCE_FINGERPRINT_SYMLINK_UNSUPPORTED");
    if(item.isFile()&&ROOT_CONFIG.test(item.name))files.push(item.name);
  }
  if(existsSync(resolve(root,"supabase/config.toml"))) {
    assertNoSymlink(root,"supabase/config.toml");
    files.push("supabase/config.toml");
  }
  const hash=createHash("sha256").update(`odonto-source-fingerprint-v${SOURCE_FINGERPRINT_VERSION}\0`);
  for(const path of files.sort()) {
    const bytes=readFileSync(resolve(root,path));
    hash.update(path).update("\0").update(String(bytes.length)).update("\0").update(bytes).update("\0");
  }
  return hash.digest("hex");
}
export async function preflight(env, root = ROOT, run = execute) {
  const checks=[], versions={};
  const git={};
  for(const [name,args] of [["branch",["branch","--show-current"]],["head",["rev-parse","HEAD"]],["worktree",["status","--short"]]]) {
    const result=await run("git",args,{cwd:root});
    checks.push({name:`git.${name}`,status:result.code===0?"PASS":"BLOCKED"});
    if(name==="worktree") git.dirty=!!result.stdout.trim(); else git[name]=result.stdout.trim();
  }
  checks.push({name:"node",status:process.versions.node.startsWith("24.")?"PASS":"FAIL"}); versions.node=process.versions.node;
  const commands=[["npm",npmCommand(),["--version"]],["supabase",supabaseCommand(),["--version"]],["docker",["docker"],["version","--format","{{.Server.Version}}"]]];
  for(const [name,command,args] of commands) {
    const result=await run(command[0],[...command.slice(1),...args],{env,cwd:root,timeoutMs:30_000});
    checks.push({name,status:result.code===0&&!!result.stdout.trim()?"PASS":"BLOCKED",reason:result.code===0?undefined:"command_unavailable_or_service_stopped"});
    // Versions only: never store stderr or arbitrary command output.
    versions[name]=/\d+\.\d+(?:\.\d+)?/.exec(result.stdout)?.[0]??"UNKNOWN";
  }
  const migrations=migrationInventory(root), suites=integrationInventory(root);
  const sequential=migrations.every((m,i)=>m.version===String(i+1).padStart(4,"0"));
  checks.push({name:"localMigrations",status:sequential&&migrations.length>=31?"PASS":"FAIL"});
  checks.push({name:"integrationConfiguration",status:existsSync(resolve(root,"vitest.integration.config.mts"))&&suites.length>0?"PASS":"FAIL"});
  const envFiles=[".env.local",".env.test.local",".env.homologacao.local"].map(name=>({name,present:existsSync(resolve(root,name))}));
  checks.push({name:"environmentFiles",status:envFiles.some(f=>f.present)?"PASS":"BLOCKED",reason:"local_lab_uses_ephemeral_process_environment"});
  const linkedPath=resolve(root,"supabase/.temp/project-ref");
  const linkedRef=existsSync(linkedPath)?readFileSync(linkedPath,"utf8").trim():null;
  const guard=projectGuard(env,linkedRef);
  // Remote prerequisites remain a separate gate, so they do not prevent local proof.
  return {status:aggregate(checks.filter(c=>c.name!=="environmentFiles")),checks,git,versions,migrations,suites,envFiles,
    sourceFingerprintVersion:SOURCE_FINGERPRINT_VERSION,sourceSha256:sourceFingerprint(root),remoteGuard:guard,linkedRef};
}
