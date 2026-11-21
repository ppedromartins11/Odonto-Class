import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { copyFile, lstat, mkdir, open, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Client } from "pg";
import { createClient } from "@supabase/supabase-js";
import { isLoopback } from "./test-runner.mjs";

const PROJECT_ID = "odonto-homologation";
const ACK = "I_ACKNOWLEDGE_FAKE_DATA_ONLY";

export function projectIdForRoot(root) {
  const path = resolve(root);
  return `${PROJECT_ID}-${createHash("sha256").update(process.platform === "win32" ? path.toLowerCase() : path).digest("hex").slice(0, 12)}`;
}

export function isolatedLocalEnvironment(env) {
  const isolated = { ...env };
  for (const name of Object.keys(isolated)) {
    if (/^(SUPABASE_|NEXT_PUBLIC_SUPABASE_|HOMOLOGATION_|HOMOLOGATE_|VERCEL_)/.test(name)) delete isolated[name];
  }
  return isolated;
}

export function isLocalDockerEndpoint(endpoint) {
  if (typeof endpoint !== "string") return false;
  if (/^unix:\/\/\//.test(endpoint)) return true;
  if (/^npipe:\/\/\/\/\.\/pipe\/[A-Za-z0-9_.-]+$/.test(endpoint)) return true;
  try { const url = new URL(endpoint); return url.protocol === "tcp:" && isLoopback(endpoint); }
  catch { return false; }
}

export function mapLocalStatus(status, env) {
  const url = status.API_URL ?? status.api_url;
  const dbUrl = status.DB_URL ?? status.db_url;
  const anon = status.ANON_KEY ?? status.anon_key ?? status.PUBLISHABLE_KEY;
  const service = status.SERVICE_ROLE_KEY ?? status.service_role_key ?? status.SECRET_KEY;
  if (!isLoopback(url) || !isLoopback(dbUrl) || !anon || !service) throw new Error("LOCAL_STACK_STATUS_INVALID");
  if (!/^https?:$/.test(new URL(url).protocol) || !/^postgres(?:ql)?:$/.test(new URL(dbUrl).protocol)) throw new Error("LOCAL_STACK_STATUS_INVALID");
  return { ...isolatedLocalEnvironment(env), SUPABASE_TEST_URL: url, SUPABASE_TEST_DB_URL: dbUrl,
    SUPABASE_TEST_ANON_KEY: anon, SUPABASE_TEST_SERVICE_ROLE_KEY: service,
    SUPABASE_TEST_HOMOLOGATION: ACK, HOMOLOGATION_LOCAL_SIGNUP_ADVERSARIAL: "1",
    NEXT_PUBLIC_SUPABASE_URL: url, NEXT_PUBLIC_SUPABASE_ANON_KEY: anon };
}

export function setTomlValue(source, section, key, value) {
  const header = section ? `[${section}]` : null;
  const lines = source.split(/\r?\n/);
  let start = header ? lines.findIndex(line => line.trim() === header) : -1;
  if (header && start < 0) return `${source}\n${header}\n${key} = ${value}\n`;
  start += 1;
  let end = lines.findIndex((line, index) => index >= start && /^\s*\[/.test(line));
  if (end < 0) end = lines.length;
  const existing = lines.findIndex((line, index) => index >= start && index < end && new RegExp(`^\\s*${key}\\s*=`).test(line));
  if (existing >= 0) lines[existing] = `${key} = ${value}`;
  else lines.splice(end, 0, `${key} = ${value}`);
  return lines.join("\n");
}

async function availablePort(reserved) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const port = await new Promise((accept, reject) => {
      const server = createServer();
      server.once("error", reject);
      server.listen(0, "0.0.0.0", () => {
        const chosen = server.address().port;
        server.close(error => error ? reject(error) : accept(chosen));
      });
    });
    if (!reserved.has(port)) { reserved.add(port); return port; }
  }
  throw new Error("LOCAL_STACK_FREE_PORT_UNAVAILABLE");
}

export function configureLocalToml(source, ports, projectId = PROJECT_ID) {
  const smtpSection = ["local_smtp", "mailpit", "inbucket"].find(section => new RegExp(`^\\[${section}\\]\\s*$`, "m").test(source));
  if (!smtpSection) throw new Error("LOCAL_STACK_SMTP_CONFIG_UNSUPPORTED");
  const settings = [
    ["", "project_id", JSON.stringify(projectId)],
    ["api", "port", ports.api], ["db", "port", ports.db], ["db", "shadow_port", ports.shadow],
    ["studio", "enabled", false], ["studio", "port", ports.studio],
    [smtpSection, "port", ports.mail], [smtpSection, "smtp_port", ports.smtp], [smtpSection, "pop3_port", ports.pop3],
    ["analytics", "enabled", false], ["analytics", "port", ports.analytics], ["db.pooler", "enabled", false],
    ["db.seed", "enabled", false], ["db.seed", "sql_paths", "[]"],
    // Local-only adversarial signup proves the provisioning trigger is fail-closed.
    ["auth", "enable_signup", true], ["auth.email", "enable_signup", true],
    ["auth.mfa.totp", "enroll_enabled", true], ["auth.mfa.totp", "verify_enabled", true],
    ["auth.rate_limit", "token_refresh", 10000], ["auth.rate_limit", "sign_in_sign_ups", 10000],
    ["auth.rate_limit", "token_verifications", 10000], ["auth.rate_limit", "email_sent", 10000],
  ];
  return settings.reduce((config, [section, key, value]) => setTomlValue(config, section, key, String(value)), source);
}

function parseStatus(response) {
  if (response.code !== 0) throw new Error("LOCAL_STACK_STATUS_UNAVAILABLE");
  try { return JSON.parse(response.stdout); }
  catch { throw new Error("LOCAL_STACK_STATUS_INVALID"); }
}

export async function prepareLocalStack({ runId, env, execute, root, beforeBootstrap }) {
  if (env.SUPABASE_TEST_HOMOLOGATION !== ACK) throw new Error("LOCAL_STACK_ACK_REQUIRED");
  if (!/^[A-Za-z0-9_.-]+$/.test(runId)) throw new Error("LOCAL_STACK_RUN_ID_INVALID");
  const realRoot = await realpath(root);
  const projectId = projectIdForRoot(realRoot);
  const workdir = resolve(realRoot, "artifacts/homologacao/local-stack");
  // Do not follow a junction/symlink into another workspace when initializing,
  // cleaning copied migrations or acquiring the ownership marker.
  for (const path of [resolve(realRoot, "artifacts"), resolve(realRoot, "artifacts/homologacao"), workdir,
    join(workdir, "runner-owner.json"), join(workdir, "runner.lock"), join(workdir, "supabase"),
    join(workdir, "supabase/config.toml"), join(workdir, "supabase/migrations"),
    join(workdir, "supabase/.temp"), join(workdir, "supabase/.temp/project-ref")]) {
    try { if ((await lstat(path)).isSymbolicLink()) throw new Error("LOCAL_STACK_WORKDIR_SYMLINK"); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  const markerPath = join(workdir, "runner-owner.json");
  const lockPath = join(workdir, "runner.lock");
  await mkdir(workdir, { recursive: true });
  let marker;
  try { marker = JSON.parse(await readFile(markerPath, "utf8")); }
  catch (error) { if (error.code !== "ENOENT") throw new Error("LOCAL_STACK_OWNER_INVALID"); }
  const legacyOwner = marker?.projectId === PROJECT_ID && marker.root === realRoot;
  if (marker && (!legacyOwner && marker.projectId !== projectId || marker.root !== realRoot)) throw new Error("LOCAL_STACK_OWNER_MISMATCH");
  if (!marker) {
    const contents = await readdir(workdir);
    if (contents.length) throw new Error("LOCAL_STACK_UNOWNED_WORKDIR");
    await writeFile(markerPath, JSON.stringify({ projectId, root: realRoot, stackOwned: false }), { flag: "wx", mode: 0o600 });
  }
  let lock;
  try { lock = await open(lockPath, "wx", 0o600); await lock.writeFile(JSON.stringify({ runId, pid: process.pid })); }
  catch { throw new Error("LOCAL_STACK_RUN_ALREADY_ACTIVE"); }
  let bootstrapId;
  let localEnv;
  let baseline;
  let service;
  const cliEnv = isolatedLocalEnvironment(env);
  const cli = (args, timeoutMs = 60_000) => execute(process.execPath, [resolve(root, "node_modules/supabase/dist/supabase.js"), ...args, "--workdir", workdir], { env: cliEnv, cwd: root, timeoutMs });
  let released = false;
  const release = async () => { if (released) return; released = true; await lock.close(); await rm(lockPath, { force: true }); };
  const removeBootstrap = async () => {
    if (!bootstrapId || !localEnv) return;
    const database = new Client({ connectionString: localEnv.SUPABASE_TEST_DB_URL });
    await database.connect();
    try {
      await database.query("begin");
      if ((await database.query("select to_regclass('bootstrap_private.initial_admin_authorization') relation")).rows[0].relation) {
        await database.query("delete from bootstrap_private.initial_admin_authorization where usuario_id=$1", [bootstrapId]);
      }
      if ((await database.query("select to_regclass('public.convites_provisionamento') relation")).rows[0].relation) {
        await database.query("delete from public.convites_provisionamento where created_by=$1", [bootstrapId]);
      }
      await database.query("delete from public.auditoria where usuario_id=$1 or entidade_id=$1", [bootstrapId]);
      await database.query("delete from public.usuarios where id=$1", [bootstrapId]);
      await database.query("commit");
      const deleted = await service.auth.admin.deleteUser(bootstrapId);
      if (deleted.error) throw new Error("LOCAL_STACK_BOOTSTRAP_CLEANUP_FAILED");
      if ((await database.query("select id from auth.users where id=$1", [bootstrapId])).rowCount) throw new Error("LOCAL_STACK_BOOTSTRAP_CLEANUP_PROOF_FAILED");
      bootstrapId = null;
    } catch { await database.query("rollback").catch(() => {}); throw new Error("LOCAL_STACK_BOOTSTRAP_CLEANUP_FAILED"); }
    finally { await database.end(); }
  };
  try {
    if (env.DOCKER_HOST && !isLocalDockerEndpoint(env.DOCKER_HOST)) throw new Error("DOCKER_REMOTE_DAEMON_FORBIDDEN");
    // DOCKER_CONTEXT overrides DOCKER_HOST. Preserve the caller's selection only
    // after checking every effective endpoint, before contacting any daemon.
    if (env.DOCKER_CONTEXT || !env.DOCKER_HOST) {
      const contextArgs = ["context", "inspect", ...(env.DOCKER_CONTEXT ? [env.DOCKER_CONTEXT] : []), "--format", "{{json .Endpoints.docker.Host}}"];
      const context = await execute("docker", contextArgs, { env: cliEnv, cwd: root, timeoutMs: 20_000 });
      if (context.code !== 0) throw new Error("DOCKER_UNAVAILABLE");
      let endpoint;
      try { endpoint = JSON.parse(context.stdout.trim()); } catch { throw new Error("LOCAL_DOCKER_CONTEXT_UNVERIFIED"); }
      if (!isLocalDockerEndpoint(endpoint)) throw new Error("DOCKER_REMOTE_DAEMON_FORBIDDEN");
    }
    const docker = await execute("docker", ["info", "--format", "{{.ServerVersion}}"], { env: cliEnv, cwd: root, timeoutMs: 20_000 });
    if (docker.code !== 0) throw new Error("DOCKER_UNAVAILABLE");
    if (marker?.stackOwned !== true) {
      // A stopped container or an orphaned volume can be restored by `start`.
      // Absence of a healthy status endpoint does not authorize adopting either.
      for (const args of [["ps", "-a", "--format", "{{.Names}}"], ["volume", "ls", "--format", "{{.Name}}"]]) {
        const inventory = await execute("docker", args, { env: cliEnv, cwd: root, timeoutMs: 20_000 });
        if (inventory.code !== 0) throw new Error("LOCAL_STACK_RESOURCE_INVENTORY_FAILED");
        if (inventory.stdout.split(/\r?\n/).some(name => name.trim().startsWith("supabase_") && name.trim().endsWith(`_${projectId}`))) throw new Error("LOCAL_STACK_UNOWNED_RESOURCE_PRESENT");
      }
    }
    if (legacyOwner) {
      const inventory = await execute("docker", ["ps", "-a", "--format", "{{.Names}}"], { env: cliEnv, cwd: root, timeoutMs: 20_000 });
      if (inventory.code !== 0 || inventory.stdout.split(/\r?\n/).some(name => /^supabase_.+_odonto-homologation$/.test(name.trim()))) throw new Error("LOCAL_STACK_LEGACY_OWNER_CONTAINER_PRESENT");
      // Migrate only the ownership/config marker, never old Docker volumes.
      await writeFile(markerPath, JSON.stringify({ projectId, root: realRoot, stackOwned: false }), { mode: 0o600 });
    }
    for (const args of [["init"], ["start"], ["status"], ["db", "reset"], ["migration", "up"], ["stop"]]) {
      const help = await cli([...args, "--help"]);
      if (help.code !== 0) throw new Error("LOCAL_STACK_CLI_HELP_UNAVAILABLE");
      if (args[0] === "start" && (!help.stdout.includes("--exclude") || !help.stdout.includes("edge-runtime"))) throw new Error("LOCAL_STACK_CLI_EXCLUSION_UNSUPPORTED");
      if (args[0] === "db" && (!help.stdout.includes("--local") || !help.stdout.includes("--no-seed"))) throw new Error("LOCAL_STACK_CLI_RESET_UNSUPPORTED");
    }
    const configPath = join(workdir, "supabase/config.toml");
    let config;
    let configInitialized = false;
    try { config = await readFile(configPath, "utf8"); }
    catch {
      const initialized = await cli(["init"]);
      if (initialized.code !== 0) throw new Error("LOCAL_STACK_INIT_FAILED");
      config = await readFile(configPath, "utf8");
      configInitialized = true;
    }
    if (await readFile(join(workdir, "supabase/.temp/project-ref"), "utf8").then(() => true).catch(() => false)) throw new Error("LOCAL_STACK_MUST_NOT_BE_LINKED");
    if (legacyOwner && config.includes(`project_id = "${PROJECT_ID}"`)) {
      config = setTomlValue(config, "", "project_id", JSON.stringify(projectId));
      await writeFile(configPath, config);
    }
    if (marker && !configInitialized && !config.includes(`project_id = "${projectId}"`)) throw new Error("LOCAL_STACK_PROJECT_ID_MISMATCH");
    if (!marker || configInitialized) {
      // init derives a project ID from the directory name. Replace it before status,
      // so discovery can never select another stack named after that directory.
      config = setTomlValue(config, "", "project_id", JSON.stringify(projectId));
      await writeFile(configPath, config);
    }
    const oldStatus = await cli(["status", "--output", "json"]);
    // A marker proves workspace ownership, not ownership of existing containers.
    // A failed unowned discovery must remain unowned on every subsequent retry.
    if (oldStatus.code === 0 && marker?.stackOwned !== true) throw new Error("LOCAL_STACK_UNOWNED_RUNNING_STACK");
    if (oldStatus.code !== 0) {
      const ports = {};
      const reserved = new Set();
      for (const key of ["api", "db", "shadow", "studio", "mail", "smtp", "pop3", "analytics"]) ports[key] = await availablePort(reserved);
      config = configureLocalToml(config, ports, projectId);
      await writeFile(configPath, config);
    } else {
      // Reject a remote endpoint before the only reset this module supports.
      mapLocalStatus(parseStatus(oldStatus), cliEnv);
    }
    const migrationDirectory = join(workdir, "supabase/migrations");
    await mkdir(migrationDirectory, { recursive: true });
    for (const name of await readdir(migrationDirectory)) {
      if (!/^\d{4}_[A-Za-z0-9_]+\.sql$/.test(name)) throw new Error("LOCAL_STACK_MIGRATION_DIRECTORY_UNEXPECTED");
      if ((await lstat(join(migrationDirectory, name))).isSymbolicLink()) throw new Error("LOCAL_STACK_WORKDIR_SYMLINK");
      await rm(join(migrationDirectory, name));
    }
    const migrations = (await readdir(resolve(root, "supabase/migrations"))).filter(name => /^\d{4}_.+\.sql$/.test(name)).sort();
    if (migrations.length !== 33 || migrations.some((name, index) => !name.startsWith(String(index + 1).padStart(4, "0") + "_"))) throw new Error("LOCAL_STACK_MIGRATION_SEQUENCE_INVALID");
    for (const name of migrations.slice(0, 29)) await copyFile(resolve(root, "supabase/migrations", name), join(migrationDirectory, name));
    if (oldStatus.code !== 0) {
      const started = await cli(["start", "--exclude", "studio,postgres-meta,edge-runtime,imgproxy,realtime,logflare,vector,supavisor"], 300_000);
      if (started.code !== 0) throw new Error(/port is already allocated|address already in use|Bind for/i.test(started.stdout + started.stderr) ? "LOCAL_STACK_PORT_CONFLICT" : "LOCAL_STACK_START_FAILED");
    }
    // start can restore an old owned volume containing 0032. Establish the same
    // 0001–0029 baseline on every run, after validating actual loopback status.
    mapLocalStatus(parseStatus(await cli(["status", "--output", "json"])), env);
    if (oldStatus.code !== 0) {
      await writeFile(markerPath, JSON.stringify({ projectId, root: realRoot, stackOwned: true, createdByRun: runId }), { mode: 0o600 });
    }
    const reset = await cli(["db", "reset", "--local", "--no-seed"], 180_000);
    if (reset.code !== 0) throw new Error("LOCAL_STACK_RESET_FAILED");
    localEnv = mapLocalStatus(parseStatus(await cli(["status", "--output", "json"])), env);
    baseline = beforeBootstrap ? await beforeBootstrap(localEnv) : undefined;
    if (beforeBootstrap && baseline?.status !== "PASS") throw new Error("LOCAL_STACK_BASELINE_FAILED");
    for (const name of migrations.slice(29)) await copyFile(resolve(root, "supabase/migrations", name), join(migrationDirectory, name));
    const applied = await cli(["migration", "up", "--local"], 180_000);
    if (applied.code !== 0) throw new Error("LOCAL_STACK_FINAL_MIGRATIONS_FAILED");
    const proof = new Client({ connectionString: localEnv.SUPABASE_TEST_DB_URL });
    await proof.connect();
    try {
      const versions = (await proof.query("select version::text from supabase_migrations.schema_migrations order by version")).rows.map(row => row.version);
      if (JSON.stringify(versions) !== JSON.stringify(migrations.map(name => name.slice(0, 4)))) throw new Error("LOCAL_STACK_MIGRATIONS_MISMATCH");
    } finally { await proof.end(); }
    service = createClient(localEnv.SUPABASE_TEST_URL, localEnv.SUPABASE_TEST_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const email = `homologation_bootstrap_${randomUUID()}@example.test`;
    const password = `QA-${randomUUID()}-a9!`;
    const token = randomBytes(32).toString("hex");
    const database = new Client({ connectionString: localEnv.SUPABASE_TEST_DB_URL });
    await database.connect();
    try {
      await database.query("begin");
      await database.query("select pg_catalog.pg_advisory_xact_lock(179384612, 320032)");
      await database.query(`insert into bootstrap_private.initial_admin_authorization
        (email,nome,token_hash,expires_at) values ($1,$2,$3,clock_timestamp()+interval '10 minutes')`,
      [email, `QA_HOMOLOGATION_BOOTSTRAP_${runId}`, createHash("sha256").update(token).digest("hex")]);
      await database.query("commit");
    } catch (error) { await database.query("rollback").catch(() => {}); throw error; }
    finally { await database.end(); }
    const assertRejectedWithoutOrphan = async (attributes) => {
      const attempted = await service.auth.admin.createUser(attributes);
      if (!attempted.error || attempted.data.user) throw new Error("LOCAL_STACK_BOOTSTRAP_NEGATIVE_CASE_FAILED");
      const check = new Client({ connectionString: localEnv.SUPABASE_TEST_DB_URL });
      await check.connect();
      try {
        const rows = await check.query(`select
          (select count(*)::int from auth.users) auth_count,
          (select count(*)::int from public.usuarios) profile_count,
          (select count(*)::int from bootstrap_private.initial_admin_authorization where consumed_at is not null) consumed_count`);
        if (Object.values(rows.rows[0]).some(value => value !== 0)) throw new Error("LOCAL_STACK_BOOTSTRAP_NEGATIVE_ORPHAN");
      } finally { await check.end(); }
    };
    await assertRejectedWithoutOrphan({ email, password, email_confirm: true,
      app_metadata: { initial_admin_bootstrap_token: randomBytes(32).toString("hex") },
      user_metadata: { perfil: "administrador" } });
    await assertRejectedWithoutOrphan({ email: `mismatch_${randomUUID()}@example.test`, password,
      email_confirm: true, app_metadata: { initial_admin_bootstrap_token: token } });
    const expiry = new Client({ connectionString: localEnv.SUPABASE_TEST_DB_URL });
    await expiry.connect();
    try {
      await expiry.query("update bootstrap_private.initial_admin_authorization set created_at=clock_timestamp()-interval '2 hours', expires_at=clock_timestamp()-interval '1 hour'");
      await assertRejectedWithoutOrphan({ email, password, email_confirm: true,
        app_metadata: { initial_admin_bootstrap_token: token } });
      await expiry.query("update bootstrap_private.initial_admin_authorization set created_at=clock_timestamp(), expires_at=clock_timestamp()+interval '10 minutes'");
    } finally { await expiry.end(); }
    const [created, competitor] = await Promise.all([
      service.auth.admin.createUser({ email, password, email_confirm: true,
        app_metadata: { initial_admin_bootstrap_token: token } }),
      service.auth.admin.createUser({ email, password, email_confirm: true,
        app_metadata: { initial_admin_bootstrap_token: randomBytes(32).toString("hex") } }),
    ]);
    if (created.error || !created.data.user) throw new Error(`LOCAL_STACK_BOOTSTRAP_AUTH_FAILED_${String(created.error?.code ?? created.error?.status ?? "UNKNOWN").replace(/[^A-Z0-9_]/gi, "_").toUpperCase()}`);
    if (!competitor.error || competitor.data.user) throw new Error("LOCAL_STACK_BOOTSTRAP_CONCURRENCY_FAILED");
    bootstrapId = created.data.user.id;
    const replayed = await service.auth.admin.createUser({ email: `replay_${randomUUID()}@example.test`, password,
      email_confirm: true, app_metadata: { initial_admin_bootstrap_token: token } });
    if (!replayed.error || replayed.data.user) throw new Error("LOCAL_STACK_BOOTSTRAP_REPLAY_FAILED");
    const check = new Client({ connectionString: localEnv.SUPABASE_TEST_DB_URL });
    await check.connect();
    try {
      const row = await check.query(`select u.id from public.usuarios u
        join bootstrap_private.initial_admin_authorization b on b.usuario_id=u.id
        join auth.users a on a.id=u.id
        where u.id=$1 and u.perfil='administrador' and u.status='ativo'
          and b.consumed_at is not null and not (a.raw_app_meta_data ? 'initial_admin_bootstrap_token')`, [bootstrapId]);
      if (row.rowCount !== 1) throw new Error("LOCAL_STACK_BOOTSTRAP_PROOF_FAILED");
    } finally { await check.end(); }
    localEnv.SUPABASE_TEST_ADMIN_EMAIL = email;
    localEnv.SUPABASE_TEST_ADMIN_PASSWORD = password;
    const cleanup = async () => {
      await removeBootstrap();
      return { status: "PASS" };
    };
    return { env: localEnv, workdir, cleanup, release, baseline, migrationState: { status: "PASS", count: migrations.length, latest: migrations.at(-1).slice(0, 4) }, projectId };
  } catch (error) {
    let cleanupFailed = false;
    try { await removeBootstrap(); } catch { cleanupFailed = true; }
    await release();
    if (cleanupFailed) throw new Error("LOCAL_STACK_SETUP_CLEANUP_FAILED");
    if (error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)) throw error;
    throw new Error("LOCAL_STACK_PREPARATION_FAILED");
  }
}
