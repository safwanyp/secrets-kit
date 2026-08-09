import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["test/live/**/*.live.test.js"],
    testTimeout: 30_000,
  },
})
