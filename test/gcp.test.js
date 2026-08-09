import { describe, expect, it, vi } from "vitest"

import {
  createSecretsKit,
  gcp,
  SecretAccessDeniedError,
  SecretAuthenticationError,
  SecretInvalidValueError,
  SecretNotFoundError,
  SecretProviderError,
  SecretRateLimitError,
  SecretsKitConfigurationError,
} from "../src/index.js"
import { createGcpProvider } from "../src/providers/gcp.js"

function createClient(overrides = {}) {
  return {
    accessSecretVersion: vi
      .fn()
      .mockResolvedValue([{ payload: { data: new Uint8Array([118, 97, 108, 117, 101]) } }]),
    apiEndpoint: "secretmanager.googleapis.com",
    getProjectId: vi.fn().mockResolvedValue("resolved-project"),
    ...overrides,
  }
}

/**
 * @param {ReturnType<typeof gcp>} provider
 */
function createReader(provider) {
  return createSecretsKit({
    secrets: { VALUE: { source: "gcp", sourceId: "provider-secret-id" } },
    sources: [{ id: "gcp", provider }],
  })
}

describe("gcp provider", () => {
  it("loads the SDK and resolves the project lazily", async () => {
    const client = createClient()
    const close = vi.fn().mockResolvedValue(undefined)
    const createClientCall = vi.fn()
    /** @param {unknown} options */
    function SecretManagerServiceClient(options) {
      createClientCall(options)
      return { ...client, close }
    }
    const loadSdk = vi.fn().mockResolvedValue({ SecretManagerServiceClient })
    const secrets = createReader(createGcpProvider({}, /** @type {never} */ (loadSdk)))

    expect(loadSdk).not.toHaveBeenCalled()
    await expect(secrets.get("VALUE")).resolves.toBe("value")
    expect(createClientCall).toHaveBeenCalledWith({})
    expect(client.getProjectId).toHaveBeenCalledTimes(1)
    expect(client.accessSecretVersion).toHaveBeenCalledWith({
      name: "projects/resolved-project/secrets/provider-secret-id/versions/latest",
    })

    await secrets.close()
    expect(close).toHaveBeenCalledTimes(1)
  })

  it("uses the regional endpoint and resource name", async () => {
    const client = createClient({
      apiEndpoint: "secretmanager.europe-north1.rep.googleapis.com",
    })
    const secrets = createReader(
      gcp({
        client: /** @type {never} */ (client),
        location: "europe-north1",
        projectId: "configured-project",
      }),
    )

    await expect(secrets.get("VALUE")).resolves.toBe("value")
    expect(client.getProjectId).not.toHaveBeenCalled()
    expect(client.accessSecretVersion).toHaveBeenCalledWith({
      name: "projects/configured-project/locations/europe-north1/secrets/provider-secret-id/versions/latest",
    })
  })

  it("configures the regional endpoint for an internal client", async () => {
    const client = createClient({
      apiEndpoint: "secretmanager.europe-north1.rep.googleapis.com",
      close: vi.fn().mockResolvedValue(undefined),
    })
    const createClientCall = vi.fn()
    /** @param {unknown} options */
    function SecretManagerServiceClient(options) {
      createClientCall(options)
      return client
    }
    const secrets = createReader(
      createGcpProvider(
        { location: "europe-north1", projectId: "project" },
        /** @type {never} */ (vi.fn().mockResolvedValue({ SecretManagerServiceClient })),
      ),
    )

    await secrets.get("VALUE")
    expect(createClientCall).toHaveBeenCalledWith({
      apiEndpoint: "secretmanager.europe-north1.rep.googleapis.com",
    })
  })

  it("does not close an injected client", async () => {
    const close = vi.fn().mockResolvedValue(undefined)
    const client = createClient({ close })
    const secrets = createReader(
      gcp({ client: /** @type {never} */ (client), projectId: "project" }),
    )

    await secrets.get("VALUE")
    await secrets.close()
    expect(close).not.toHaveBeenCalled()
  })

  it("rejects an absent payload", async () => {
    const client = createClient({
      accessSecretVersion: vi.fn().mockResolvedValue([{}]),
    })
    const secrets = createReader(
      gcp({ client: /** @type {never} */ (client), projectId: "project" }),
    )

    await expect(secrets.get("VALUE")).rejects.toBeInstanceOf(SecretInvalidValueError)
  })

  it.each([
    [5, SecretNotFoundError],
    [16, SecretAuthenticationError],
    [7, SecretAccessDeniedError],
    [8, SecretRateLimitError],
    [14, SecretProviderError],
  ])("maps gRPC code %s to a sanitized domain error", async (code, ErrorFactory) => {
    const providerError = Object.assign(new Error("raw provider body"), { code })
    const client = createClient({
      accessSecretVersion: vi.fn().mockRejectedValue(providerError),
    })
    const secrets = createReader(
      gcp({ client: /** @type {never} */ (client), projectId: "project" }),
    )

    const error = await secrets.get("VALUE").catch((reason) => reason)
    expect(error).toBeInstanceOf(ErrorFactory)
    expect(error).toMatchObject({
      provider: "gcp",
      providerCode: String(code),
      retryable: code === 8 || code === 14,
    })
    expect(error.message).not.toContain("provider-secret-id")
    expect(error.message).not.toContain("raw provider body")
    expect(error.cause).toBe(providerError)
  })

  it.each([
    [/** @type {never} */ (null)],
    [{ projectId: "" }],
    [{ location: "" }],
    [{ client: /** @type {never} */ ({}) }],
    [
      {
        client: /** @type {never} */ (createClient()),
        location: "europe-north1",
      },
    ],
    [{ unknown: true }],
  ])("rejects invalid options %#", (options) => {
    expect(() => gcp(/** @type {never} */ (options))).toThrow(SecretsKitConfigurationError)
  })
})
