import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { sourceFingerprint } from "../scripts/homologacao/preflight.mjs";

const required = ["app", "components", "lib", "scripts", "tests", "public", "supabase/migrations", ".github/workflows"];
const roots = [];

async function put(root, path, bytes) {
  const target = join(root, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, bytes);
}

async function fixture(reverse = false) {
  const root = await mkdtemp(join(tmpdir(), "odonto-source-fingerprint-"));
  roots.push(root);
  for (const directory of required) await mkdir(join(root, directory), { recursive: true });
  const entries = [
    ["app/page.tsx", "page"], ["components/ui/Button.tsx", "button"], ["lib/auth/session.ts", "session"],
    ["proxy.ts", "proxy"], ["scripts/homologacao/preflight.mjs", "preflight"],
    ["tests/example.test.mjs", "test"], ["public/logo.png", Buffer.from([1, 2, 3])],
    ["supabase/migrations/0001_initial.sql", "migration"], [".github/workflows/ci.yml", "ci"],
    ["next.config.ts", "config"], ["package.json", "package"], [".node-version", "24"],
  ];
  for (const [path, bytes] of reverse ? entries.reverse() : entries) await put(root, path, bytes);
  return root;
}

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("source fingerprint v2", () => {
  it("changes for executable source, migrations, runtime config and CI inputs", async () => {
    const root = await fixture();
    for (const path of ["proxy.ts", "components/ui/Button.tsx", "app/page.tsx", "lib/auth/session.ts",
      "supabase/migrations/0001_initial.sql", "next.config.ts", "eslint.config.mjs", ".node-version", ".github/workflows/ci.yml",
      "scripts/recovery/check.ps1", "scripts/recovery/check.sh", "lib/secrets.ts", "lib/runtime.env.ts",
      "tests/example.test.mjs"]) {
      const before = sourceFingerprint(root);
      await put(root, path, `changed:${path}`);
      expect(sourceFingerprint(root), path).not.toBe(before);
    }
  });

  it("ignores local secrets, generated files and temporary artifacts", async () => {
    const root = await fixture();
    const baseline = sourceFingerprint(root);
    for (const path of [".env.local", "tests/.env.test.local",
      "scripts/tmp/output.js", "app/node_modules/generated.js", "public/.next/generated.js",
      "artifacts/release/approval.json", "tsconfig.tsbuildinfo", "scripts/recovery/run.log",
      "scripts/recovery/legacy-pg-dump.env.ts.txt"]) {
      await put(root, path, "local-only");
      expect(sourceFingerprint(root), path).toBe(baseline);
    }
  });

  it("is independent of directory enumeration order for identical paths and bytes", async () => {
    const first = await fixture();
    const second = await fixture(true);
    expect(sourceFingerprint(second)).toBe(sourceFingerprint(first));
    await put(second, "components/ui/Extra.tsx", "new component");
    expect(sourceFingerprint(second)).not.toBe(sourceFingerprint(first));
  });

  it("fails closed for unclassified source files", async () => {
    const root = await fixture();
    await put(root, "scripts/new-tool.bin", "unknown executable");
    expect(() => sourceFingerprint(root)).toThrow("SOURCE_FINGERPRINT_UNCLASSIFIED_FILE");
  });

  it("does not silently omit a route beneath a generated-looking directory", async () => {
    const root = await fixture();
    await put(root, "app/build/page.tsx", "route");
    expect(() => sourceFingerprint(root)).toThrow("SOURCE_FINGERPRINT_UNCLASSIFIED_DIRECTORY");
  });

  it("blocks ambiguous credential data and PDFs instead of silently omitting them", async () => {
    const root = await fixture();
    await put(root, "scripts/credentials.json", "synthetic credential fixture");
    expect(() => sourceFingerprint(root)).toThrow("SOURCE_FINGERPRINT_SENSITIVE_FILE");
    await rm(join(root, "scripts/credentials.json"));
    await put(root, "public/handbook.pdf", "synthetic PDF fixture");
    expect(() => sourceFingerprint(root)).toThrow("SOURCE_FINGERPRINT_SENSITIVE_FILE");
  });
});
