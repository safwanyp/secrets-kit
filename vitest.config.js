import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    coverage: {
      include: ["src/**/*.js"],
      provider: "v8",
      reporter: ["text", "json-summary"],
      thresholds: {
        branches: 80,
        functions: 90,
        lines: 85,
        statements: 85,
      },
    },
    include: ["test/**/*.test.js"],
    exclude: ["test/live/**"],
    mockReset: true,
    restoreMocks: true,
  },
})
