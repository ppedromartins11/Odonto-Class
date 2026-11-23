import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: ["tests/integration/**", "scripts/guards/**/*.test.mjs", "node_modules/**", ".next/**"],
  },
});
