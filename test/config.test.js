import { inspect } from "node:util"

import { describe, expect, it, vi } from "vitest"

import { createSecretsKit, SecretsKitConfigurationError } from "../src/index.js"
import { createStubProvider, text } from "./helpers/provider.js"

describe("configuration", () => {
  it("creates synchronously without initializing a provider", () => {
    const provider = createStubProvider(vi.fn().mockResolvedValue(text("value")))

    const secrets = createSecretsKit({
      secrets: {},
      sources: [{ id: "primary", provider: provider.descriptor }],
    })

    expect(secrets).toBeTypeOf("object")
    expect(provider.createRuntime).not.toHaveBeenCalled()
  })

  it("keeps provider descriptors frozen and opaque", () => {
    const provider = createStubProvider(vi.fn().mockResolvedValue(text("value")))

    expect(Object.isFrozen(provider.descriptor)).toBe(true)
    expect(Object.keys(provider.descriptor)).toEqual([])
    expect(JSON.stringify(provider.descriptor)).toBe("{}")
    expect(inspect(provider.descriptor)).not.toContain("createRuntime")
  })

  it("collects schema and semantic issues in one domain error", () => {
    expect(() =>
      createSecretsKit({
        cache: { refreshAheadMs: 10, ttlMs: 10 },
        onBackgroundError: /** @type {never} */ (true),
        secrets: {
          DATABASE_URL: {
            source: "missing",
            sourceId: "database",
          },
        },
        sources: [
          { id: "duplicate", provider: /** @type {never} */ ({}) },
          { id: "duplicate", provider: /** @type {never} */ ({}) },
        ],
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "SECRETS_KIT_CONFIGURATION",
        message: expect.stringMatching(
          /provider factory[\s\S]*must be unique[\s\S]*onBackgroundError[\s\S]*refreshAheadMs[\s\S]*declared source/,
        ),
      }),
    )
  })

  it("does not mutate or freeze caller-owned configuration", async () => {
    const read = vi.fn().mockResolvedValue(text("value"))
    const provider = createStubProvider(read)
    const source = { id: "primary", provider: provider.descriptor }
    const definition = { source: "primary", sourceId: "original" }
    const config = {
      secrets: { TOKEN: definition },
      sources: [source],
    }
    const secrets = createSecretsKit(config)

    source.id = "changed"
    definition.sourceId = "changed"

    await expect(secrets.get("TOKEN")).resolves.toBe("value")
    expect(read).toHaveBeenCalledWith("original")
    expect(Object.isFrozen(config)).toBe(false)
    expect(Object.isFrozen(source)).toBe(false)
    expect(Object.isFrozen(definition)).toBe(false)
  })

  it("rejects unknown provider descriptors", () => {
    expect(() =>
      createSecretsKit({
        secrets: {},
        sources: [{ id: "primary", provider: /** @type {never} */ ({}) }],
      }),
    ).toThrow(SecretsKitConfigurationError)
  })
})
