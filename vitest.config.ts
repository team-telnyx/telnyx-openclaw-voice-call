import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: ["dist/**", "node_modules/**"],
    pool: "forks",
    testTimeout: 10000,
  },
});
