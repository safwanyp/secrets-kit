import { describe, expect, it, vi } from "vitest"

import { createSecretsKit, SecretInvalidValueError } from "../src/index.js"
import { bytes, createStubProvider, text } from "./helpers/provider.js"

/**
 * @param {import("../types/internal.js").ProviderValue} value
 * @param {string} [field]
 */
function createReader(value, field) {
  const provider = createStubProvider(vi.fn().mockResolvedValue(value))
  return createSecretsKit({
    secrets: {
      VALUE: {
        ...(field === undefined ? {} : { field }),
        source: "primary",
        sourceId: "value",
      },
    },
    sources: [{ id: "primary", provider: provider.descriptor }],
  })
}

describe("secret values", () => {
  it("converts native text to UTF-8 bytes", async () => {
    const secrets = createReader(text("héllo"))

    await expect(secrets.get("VALUE")).resolves.toBe("héllo")
    await expect(secrets.getBytes("VALUE")).resolves.toEqual(new TextEncoder().encode("héllo"))
  })

  it("returns a caller-owned byte array", async () => {
    const secrets = createReader(bytes([1, 2, 3]))
    const first = await secrets.getBytes("VALUE")
    first[0] = 9

    await expect(secrets.getBytes("VALUE")).resolves.toEqual(new Uint8Array([1, 2, 3]))
  })

  it("rejects invalid UTF-8 with a domain error", async () => {
    const secrets = createReader(bytes([0xff]))

    await expect(secrets.get("VALUE")).rejects.toBeInstanceOf(SecretInvalidValueError)
  })

  it("extracts one immediate JSON string field", async () => {
    const secrets = createReader(text('{"url":"postgres://database"}'), "url")

    await expect(secrets.get("VALUE")).resolves.toBe("postgres://database")
  })

  it.each([
    ["not json", "url"],
    ["[]", "url"],
    ['{"url":42}', "url"],
    ['{"nested":{"url":"value"}}', "nested.url"],
  ])("rejects invalid field extraction from %s", async (value, field) => {
    const secrets = createReader(text(value), field)

    await expect(secrets.get("VALUE")).rejects.toBeInstanceOf(SecretInvalidValueError)
  })
})
