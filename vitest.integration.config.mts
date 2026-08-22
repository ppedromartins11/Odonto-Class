import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

Object.assign(process.env, loadEnv("test", process.cwd(), ""));

export default defineConfig({
  test: {
    include: ["tests/integration/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
