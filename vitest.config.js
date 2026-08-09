import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    coverage: {
      include: ["src/**/*.js"],
      provider: "v8",
      reporter: ["text", "json-summary"],
      thresholds: {
        branches: 90,
        functions: 95,
        lines: 95,
        statements: 95,
      },
    },
    include: ["test/**/*.test.js"],
    exclude: ["test/live/**"],
    mockReset: true,
    restoreMocks: true,
  },
})
