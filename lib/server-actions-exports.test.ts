import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function typescriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return typescriptFiles(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

describe('contrato dos modulos "use server"', () => {
  it("exporta somente funcoes async", () => {
    const invalidExports: string[] = [];
    const files = [...typescriptFiles("app"), ...typescriptFiles("lib")];

    for (const file of files) {
      const source = readFileSync(file, "utf8");
      if (!/^\s*["']use server["'];/m.test(source)) continue;

      source.split(/\r?\n/).forEach((line, index) => {
        if (/^export\s+/.test(line) && !/^export\s+async\s+function\s+/.test(line)) {
          invalidExports.push(`${file}:${index + 1}: ${line.trim()}`);
        }
      });
    }

    expect(invalidExports).toEqual([]);
  });

  it("autoriza arquivo de paciente antes do upload privilegiado", () => {
    const source = readFileSync("app/(app)/pacientes/file-actions.ts", "utf8");
    const authorization = source.indexOf("await authorizePatientFileUpload");
    const deniedReturn = source.indexOf("if (!authorized) return");
    const privilegedUpload = source.indexOf('.storage.from("arquivos-paciente").upload');

    expect(authorization).toBeGreaterThan(-1);
    expect(deniedReturn).toBeGreaterThan(authorization);
    expect(privilegedUpload).toBeGreaterThan(deniedReturn);
  });
});
