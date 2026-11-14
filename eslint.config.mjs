import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTypescript,
  globalIgnores([
    ".next/**", "out/**", "build/**", "coverage/**", "artifacts/**", "node_modules/**",
    ".backups/**", ".dr/**", ".vercel/**", "supabase/.temp/**", "supabase/.branches/**",
    ".agents/**", ".claude/**", ".codex/**", "next-env.d.ts",
  ]),
]);

export default eslintConfig;
