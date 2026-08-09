import { describe, expect, it, vi } from "vitest"

import {
  aws,
  createSecretsKit,
  SecretAccessDeniedError,
  SecretAuthenticationError,
  SecretInvalidValueError,
  SecretNotFoundError,
  SecretProviderError,
  SecretRateLimitError,
  SecretsKitConfigurationError,
} from "../src/index.js"
import { createAwsProvider } from "../src/providers/aws.js"

/**
 * @param {ReturnType<typeof aws>} provider
 */
function createReader(provider) {
  return createSecretsKit({
    secrets: { VALUE: { source: "aws", sourceId: "provider-secret-id" } },
    sources: [{ id: "aws", provider }],
  })
}

describe("aws provider", () => {
  it("loads the official SDK and creates its client lazily", async () => {
    const getSecretValue = vi.fn().mockResolvedValue({ SecretString: "value" })
    const destroy = vi.fn()
    const createClient = vi.fn()
    /** @param {unknown} options */
    function SecretsManager(options) {
      createClient(options)
      return { destroy, getSecretValue }
    }
    const loadSdk = vi.fn().mockResolvedValue({ SecretsManager })
    const provider = createAwsProvider({ region: "eu-north-1" }, /** @type {never} */ (loadSdk))
    const secrets = createReader(provider)

    expect(loadSdk).not.toHaveBeenCalled()
    await expect(secrets.get("VALUE")).resolves.toBe("value")
    expect(createClient).toHaveBeenCalledWith({ region: "eu-north-1" })
    expect(getSecretValue).toHaveBeenCalledWith({
      SecretId: "provider-secret-id",
      VersionStage: "AWSCURRENT",
    })

    await secrets.close()
    expect(destroy).toHaveBeenCalledTimes(1)
  })

  it("uses an injected client without loading or closing it", async () => {
    const getSecretValue = vi.fn().mockResolvedValue({ SecretString: "value" })
    const loadSdk = vi.fn(() => Promise.reject(new Error("must not load")))
    const provider = createAwsProvider(
      { client: /** @type {never} */ ({ getSecretValue }) },
      /** @type {never} */ (loadSdk),
    )
    const secrets = createReader(provider)

    await expect(secrets.get("VALUE")).resolves.toBe("value")
    await secrets.close()
    expect(loadSdk).not.toHaveBeenCalled()
  })

  it("returns binary secret values without decoding", async () => {
    const getSecretValue = vi.fn().mockResolvedValue({ SecretBinary: new Uint8Array([1, 2, 3]) })
    const secrets = createReader(aws({ client: /** @type {never} */ ({ getSecretValue }) }))

    await expect(secrets.getBytes("VALUE")).resolves.toEqual(new Uint8Array([1, 2, 3]))
  })

  it("rejects a successful response without a value", async () => {
    const getSecretValue = vi.fn().mockResolvedValue({})
    const secrets = createReader(aws({ client: /** @type {never} */ ({ getSecretValue }) }))

    await expect(secrets.get("VALUE")).rejects.toBeInstanceOf(SecretInvalidValueError)
  })

  it.each([
    ["ResourceNotFoundException", SecretNotFoundError],
    ["UnrecognizedClientException", SecretAuthenticationError],
    ["AccessDeniedException", SecretAccessDeniedError],
    ["ThrottlingException", SecretRateLimitError],
    ["InternalServiceError", SecretProviderError],
  ])("maps %s to a sanitized domain error", async (name, ErrorFactory) => {
    const providerError = Object.assign(new Error("raw provider body"), {
      $metadata: { requestId: "request-id" },
      $retryable: {},
      name,
    })
    const getSecretValue = vi.fn().mockRejectedValue(providerError)
    const secrets = createReader(aws({ client: /** @type {never} */ ({ getSecretValue }) }))

    const error = await secrets.get("VALUE").catch((reason) => reason)
    expect(error).toBeInstanceOf(ErrorFactory)
    expect(error).toMatchObject({
      provider: "aws",
      providerCode: name,
      requestId: "request-id",
      retryable: true,
    })
    expect(error.message).not.toContain("provider-secret-id")
    expect(error.message).not.toContain("raw provider body")
    expect(error.cause).toBe(providerError)
  })

  it.each([
    [/** @type {never} */ (null)],
    [{ region: "" }],
    [{ client: /** @type {never} */ ({}), region: "eu-north-1" }],
    [{ unknown: true }],
  ])("rejects invalid options %#", (options) => {
    expect(() => aws(/** @type {never} */ (options))).toThrow(SecretsKitConfigurationError)
  })
})
