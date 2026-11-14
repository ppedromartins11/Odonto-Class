import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

for (const [name, value] of Object.entries(loadEnv("test", process.cwd(), ""))) {
  if (process.env[name] === undefined) process.env[name] = value;
}

export default defineConfig({
  test: {
    include: ["tests/integration/**/*.test.ts"],
    setupFiles: ["tests/integration/setup-isolation.mjs"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
