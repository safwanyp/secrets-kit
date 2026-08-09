import { describe, expect, it, vi } from "vitest"

import {
  createSecretsKit,
  SecretDefinitionNotFoundError,
  SecretProviderError,
  SecretReadAbortedError,
  SecretsKitClosedError,
} from "../src/index.js"
import { createDeferred, createStubProvider, text } from "./helpers/provider.js"

describe("secrets client", () => {
  it("rejects undeclared logical names", async () => {
    const provider = createStubProvider(vi.fn().mockResolvedValue(text("value")))
    const secrets = createSecretsKit({
      secrets: {},
      sources: [{ id: "primary", provider: provider.descriptor }],
    })

    await expect(secrets.get(/** @type {never} */ ("UNKNOWN"))).rejects.toBeInstanceOf(
      SecretDefinitionNotFoundError,
    )
  })

  it("coalesces aliases backed by the same provider secret", async () => {
    const deferred = createDeferred()
    const read = vi.fn(() => deferred.promise)
    const provider = createStubProvider(read)
    const secrets = createSecretsKit({
      secrets: {
        FIRST: { source: "primary", sourceId: "shared" },
        SECOND: { source: "primary", sourceId: "shared" },
      },
      sources: [{ id: "primary", provider: provider.descriptor }],
    })

    const first = secrets.get("FIRST")
    const second = secrets.get("SECOND")
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1))
    deferred.resolve(text("value"))

    await expect(Promise.all([first, second])).resolves.toEqual(["value", "value"])
  })

  it("uses an opt-in TTL cache", async () => {
    vi.useFakeTimers()
    const read = vi.fn().mockResolvedValueOnce(text("first")).mockResolvedValueOnce(text("second"))
    const provider = createStubProvider(read)
    const secrets = createSecretsKit({
      cache: { ttlMs: 1_000 },
      secrets: { TOKEN: { source: "primary", sourceId: "token" } },
      sources: [{ id: "primary", provider: provider.descriptor }],
    })

    await expect(secrets.get("TOKEN")).resolves.toBe("first")
    await expect(secrets.get("TOKEN")).resolves.toBe("first")
    expect(read).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1_000)
    await expect(secrets.get("TOKEN")).resolves.toBe("second")
    expect(read).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })

  it("refreshes ahead while returning the valid cached value", async () => {
    vi.useFakeTimers()
    const refreshed = createDeferred()
    const read = vi
      .fn()
      .mockResolvedValueOnce(text("first"))
      .mockImplementationOnce(() => refreshed.promise)
    const provider = createStubProvider(read)
    const backgroundError = vi.fn()
    const secrets = createSecretsKit({
      cache: { refreshAheadMs: 200, ttlMs: 1_000 },
      onBackgroundError: backgroundError,
      secrets: { TOKEN: { source: "primary", sourceId: "token" } },
      sources: [{ id: "primary", provider: provider.descriptor }],
    })

    await expect(secrets.get("TOKEN")).resolves.toBe("first")
    await vi.advanceTimersByTimeAsync(800)
    await expect(secrets.get("TOKEN")).resolves.toBe("first")
    expect(read).toHaveBeenCalledTimes(2)

    refreshed.resolve(text("second"))
    await vi.waitFor(async () => {
      await expect(secrets.get("TOKEN")).resolves.toBe("second")
    })
    expect(backgroundError).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it("reports refresh failures and never serves a value after expiry", async () => {
    vi.useFakeTimers()
    const failure = new Error("outage")
    const read = vi.fn().mockResolvedValueOnce(text("first")).mockRejectedValue(failure)
    const provider = createStubProvider(read)
    const backgroundError = vi.fn(() => {
      throw new Error("telemetry failed")
    })
    const secrets = createSecretsKit({
      cache: { refreshAheadMs: 200, ttlMs: 1_000 },
      onBackgroundError: backgroundError,
      secrets: { TOKEN: { source: "primary", sourceId: "token" } },
      sources: [{ id: "primary", provider: provider.descriptor }],
    })

    await expect(secrets.get("TOKEN")).resolves.toBe("first")
    await vi.advanceTimersByTimeAsync(800)
    await expect(secrets.get("TOKEN")).resolves.toBe("first")
    await vi.waitFor(() => expect(backgroundError).toHaveBeenCalledTimes(1))

    await vi.advanceTimersByTimeAsync(200)
    await expect(secrets.get("TOKEN")).rejects.toBeInstanceOf(SecretProviderError)
    vi.useRealTimers()
  })

  it("invalidates aliases and prevents an older read from repopulating cache", async () => {
    const firstRead = createDeferred()
    const read = vi
      .fn()
      .mockImplementationOnce(() => firstRead.promise)
      .mockResolvedValue(text("fresh"))
    const provider = createStubProvider(read)
    const secrets = createSecretsKit({
      cache: { ttlMs: 10_000 },
      secrets: {
        FIRST: { source: "primary", sourceId: "shared" },
        SECOND: { source: "primary", sourceId: "shared" },
      },
      sources: [{ id: "primary", provider: provider.descriptor }],
    })

    const pending = secrets.get("FIRST")
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1))
    secrets.invalidate("SECOND")
    firstRead.resolve(text("old"))
    await expect(pending).resolves.toBe("old")
    await expect(secrets.get("FIRST")).resolves.toBe("fresh")
    expect(read).toHaveBeenCalledTimes(2)
  })

  it("aborts one caller without cancelling a shared provider read", async () => {
    const deferred = createDeferred()
    const read = vi.fn(() => deferred.promise)
    const provider = createStubProvider(read)
    const secrets = createSecretsKit({
      secrets: { TOKEN: { source: "primary", sourceId: "token" } },
      sources: [{ id: "primary", provider: provider.descriptor }],
    })
    const controller = new AbortController()

    const aborted = secrets.get("TOKEN", { signal: controller.signal })
    const active = secrets.get("TOKEN")
    controller.abort("caller stopped waiting")

    await expect(aborted).rejects.toBeInstanceOf(SecretReadAbortedError)
    expect(read).toHaveBeenCalledTimes(1)
    deferred.resolve(text("value"))
    await expect(active).resolves.toBe("value")
  })

  it("closes once after active reads settle and rejects later operations", async () => {
    const deferred = createDeferred()
    const read = vi.fn(() => deferred.promise)
    const closeRuntime = vi.fn().mockResolvedValue(undefined)
    const provider = createStubProvider(read, closeRuntime)
    const secrets = createSecretsKit({
      secrets: { TOKEN: { source: "primary", sourceId: "token" } },
      sources: [{ id: "primary", provider: provider.descriptor }],
    })

    const pending = secrets.get("TOKEN")
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1))
    const firstClose = secrets.close()
    const secondClose = secrets.close()

    expect(secondClose).toBe(firstClose)
    await expect(secrets.get("TOKEN")).rejects.toBeInstanceOf(SecretsKitClosedError)
    expect(() => secrets.invalidate()).toThrow(SecretsKitClosedError)
    expect(closeRuntime).not.toHaveBeenCalled()

    deferred.resolve(text("value"))
    await expect(pending).resolves.toBe("value")
    await expect(firstClose).resolves.toBeUndefined()
    expect(closeRuntime).toHaveBeenCalledTimes(1)
  })
})
