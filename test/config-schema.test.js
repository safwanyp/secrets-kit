import { describe, expect, it } from "vitest"

import validateConfig from "../generated/validate-config.js"

function createValidConfig() {
  return {
    cache: {
      refreshAheadMs: 1_000,
      ttlMs: 10_000,
    },
    onBackgroundError() {},
    secrets: {
      DATABASE_URL: {
        field: "url",
        source: "primary",
        sourceId: "production/database",
      },
    },
    sources: [
      {
        id: "primary",
        provider: Object.freeze({}),
      },
    ],
  }
}

describe("generated configuration validator", () => {
  it("accepts the complete configuration shape", () => {
    const config = createValidConfig()

    expect(validateConfig(config)).toBe(true)
    expect(validateConfig.errors).toBeNull()
  })

  it("collects all structural issues", () => {
    const config = {
      cache: {
        refreshAheadMs: -1,
        ttlMs: 0,
        unknown: true,
      },
      secrets: {
        "": {
          source: "",
          sourceId: "",
        },
      },
      sources: [],
      unknown: true,
    }

    expect(validateConfig(config)).toBe(false)
    expect(validateConfig.errors?.length).toBeGreaterThanOrEqual(7)
  })

  it("does not coerce, remove properties, or apply defaults", () => {
    const config = {
      ...createValidConfig(),
      cache: { ttlMs: 10_000 },
    }
    const original = {
      cache: { ...config.cache },
      secrets: structuredClone(config.secrets),
      sources: config.sources.map((source) => ({ ...source })),
    }

    expect(validateConfig(config)).toBe(true)
    expect(config.cache).toEqual(original.cache)
    expect(config.secrets).toEqual(original.secrets)
    expect(config.sources).toEqual(original.sources)
  })

  it("rejects number-like strings rather than coercing them", () => {
    const config = createValidConfig()
    config.cache.ttlMs = /** @type {never} */ ("10000")

    expect(validateConfig(config)).toBe(false)
    expect(validateConfig.errors).toContainEqual(
      expect.objectContaining({ instancePath: "/cache/ttlMs", keyword: "type" }),
    )
  })
})
