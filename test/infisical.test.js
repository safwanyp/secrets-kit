import { describe, expect, it, vi } from "vitest"

import {
  createSecretsKit,
  infisical,
  SecretAccessDeniedError,
  SecretAuthenticationError,
  SecretInvalidValueError,
  SecretNotFoundError,
  SecretProviderError,
  SecretRateLimitError,
  SecretsKitConfigurationError,
} from "../src/index.js"
import { createInfisicalProvider } from "../src/providers/infisical.js"
import { createDeferred } from "./helpers/provider.js"

/**
 * @param {ReturnType<typeof vi.fn>} getSecret
 * @param {Record<string, unknown>} [auth]
 */
function createClient(getSecret, auth) {
  return {
    ...(auth === undefined ? {} : { auth: () => auth }),
    secrets: () => ({ getSecret }),
  }
}

/**
 * @param {ReturnType<typeof infisical>} provider
 * @param {Record<string, { source: string, sourceId: string }>} [secrets]
 */
function createReader(
  provider,
  secrets = { VALUE: { source: "infisical", sourceId: "provider-secret-id" } },
) {
  return createSecretsKit({
    secrets,
    sources: [{ id: "infisical", provider }],
  })
}

function universalAuthOptions() {
  return {
    auth: { clientId: "client-id", clientSecret: "client-secret" },
    environment: "prod",
    projectId: "project-id",
  }
}

describe("infisical provider", () => {
  it("logs in lazily and reads the current unexpanded value", async () => {
    const getSecret = vi.fn().mockResolvedValue({ secretValue: "value" })
    const authenticatedClient = createClient(getSecret, {
      universalAuth: { renew: vi.fn() },
    })
    const login = vi.fn().mockResolvedValue(authenticatedClient)
    const baseClient = createClient(vi.fn(), {
      universalAuth: { login },
    })
    const createClientCall = vi.fn()
    /** @param {unknown} options */
    function InfisicalSDK(options) {
      createClientCall(options)
      return baseClient
    }
    const loadSdk = vi.fn().mockResolvedValue({ InfisicalSDK })
    const secrets = createReader(
      createInfisicalProvider(universalAuthOptions(), /** @type {never} */ (loadSdk)),
    )

    expect(loadSdk).not.toHaveBeenCalled()
    await expect(secrets.get("VALUE")).resolves.toBe("value")
    expect(createClientCall).toHaveBeenCalledWith({
      siteUrl: "https://app.infisical.com",
    })
    expect(login).toHaveBeenCalledWith({
      clientId: "client-id",
      clientSecret: "client-secret",
    })
    expect(getSecret).toHaveBeenCalledWith({
      environment: "prod",
      expandSecretReferences: false,
      includeImports: false,
      projectId: "project-id",
      secretName: "provider-secret-id",
      secretPath: "/",
      viewSecretValue: true,
    })
    expect(getSecret.mock.calls[0]?.[0]).not.toHaveProperty("version")
  })

  it("coalesces concurrent Universal Auth login", async () => {
    const loginResult = createDeferred()
    const getSecret = vi.fn().mockResolvedValue({ secretValue: "value" })
    const authenticatedClient = createClient(getSecret, {
      universalAuth: { renew: vi.fn() },
    })
    const login = vi.fn(() => loginResult.promise)
    const baseClient = createClient(vi.fn(), {
      universalAuth: { login },
    })
    function InfisicalSDK() {
      return baseClient
    }
    const secrets = createReader(
      createInfisicalProvider(
        universalAuthOptions(),
        /** @type {never} */ (vi.fn().mockResolvedValue({ InfisicalSDK })),
      ),
      {
        FIRST: { source: "infisical", sourceId: "first" },
        SECOND: { source: "infisical", sourceId: "second" },
      },
    )

    const first = secrets.get("FIRST")
    const second = secrets.get("SECOND")
    await vi.waitFor(() => expect(login).toHaveBeenCalledTimes(1))
    loginResult.resolve(authenticatedClient)
    await expect(Promise.all([first, second])).resolves.toEqual(["value", "value"])
  })

  it("renews once after an expired token and retries the read", async () => {
    const expired = Object.assign(new Error("[StatusCode=401] expired"), {
      statusCode: 401,
    })
    const initialGetSecret = vi.fn().mockRejectedValue(expired)
    const renewedGetSecret = vi.fn().mockResolvedValue({ secretValue: "renewed" })
    const renewedClient = createClient(renewedGetSecret, {
      universalAuth: { renew: vi.fn() },
    })
    const renew = vi.fn().mockResolvedValue(renewedClient)
    const initialClient = createClient(initialGetSecret, {
      universalAuth: { renew },
    })
    const baseClient = createClient(vi.fn(), {
      universalAuth: { login: vi.fn().mockResolvedValue(initialClient) },
    })
    function InfisicalSDK() {
      return baseClient
    }
    const secrets = createReader(
      createInfisicalProvider(
        universalAuthOptions(),
        /** @type {never} */ (vi.fn().mockResolvedValue({ InfisicalSDK })),
      ),
    )

    await expect(secrets.get("VALUE")).resolves.toBe("renewed")
    expect(renew).toHaveBeenCalledTimes(1)
    expect(renewedGetSecret).toHaveBeenCalledTimes(1)
  })

  it("coalesces concurrent token renewal", async () => {
    const expired = Object.assign(new Error("[StatusCode=401] expired"), {
      statusCode: 401,
    })
    const renewResult = createDeferred()
    const renew = vi.fn(() => renewResult.promise)
    const initialClient = createClient(vi.fn().mockRejectedValue(expired), {
      universalAuth: { renew },
    })
    const renewedClient = createClient(vi.fn().mockResolvedValue({ secretValue: "renewed" }), {
      universalAuth: { renew: vi.fn() },
    })
    const login = vi.fn().mockResolvedValue(initialClient)
    const baseClient = createClient(vi.fn(), {
      universalAuth: { login },
    })
    function InfisicalSDK() {
      return baseClient
    }
    const secrets = createReader(
      createInfisicalProvider(
        universalAuthOptions(),
        /** @type {never} */ (vi.fn().mockResolvedValue({ InfisicalSDK })),
      ),
      {
        FIRST: { source: "infisical", sourceId: "first" },
        SECOND: { source: "infisical", sourceId: "second" },
      },
    )

    const first = secrets.get("FIRST")
    const second = secrets.get("SECOND")
    await vi.waitFor(() => expect(renew).toHaveBeenCalledTimes(1))
    renewResult.resolve(renewedClient)
    await expect(Promise.all([first, second])).resolves.toEqual(["renewed", "renewed"])
  })

  it("reauthenticates when token renewal fails", async () => {
    const expired = Object.assign(new Error("[StatusCode=401] expired"), {
      statusCode: 401,
    })
    const firstClient = createClient(vi.fn().mockRejectedValue(expired), {
      universalAuth: { renew: vi.fn().mockRejectedValue(new Error("cannot renew")) },
    })
    const secondClient = createClient(
      vi.fn().mockResolvedValue({ secretValue: "reauthenticated" }),
      { universalAuth: { renew: vi.fn() } },
    )
    const login = vi.fn().mockResolvedValueOnce(firstClient).mockResolvedValueOnce(secondClient)
    const baseClient = createClient(vi.fn(), {
      universalAuth: { login },
    })
    function InfisicalSDK() {
      return baseClient
    }
    const secrets = createReader(
      createInfisicalProvider(
        universalAuthOptions(),
        /** @type {never} */ (vi.fn().mockResolvedValue({ InfisicalSDK })),
      ),
    )

    await expect(secrets.get("VALUE")).resolves.toBe("reauthenticated")
    expect(login).toHaveBeenCalledTimes(2)
  })

  it("uses an injected client without authenticating or loading the SDK", async () => {
    const getSecret = vi.fn().mockResolvedValue({ secretValue: "value" })
    const client = createClient(getSecret)
    const loadSdk = vi.fn(() => Promise.reject(new Error("must not load")))
    const secrets = createReader(
      createInfisicalProvider(
        {
          client: /** @type {never} */ (client),
          environment: "prod",
          projectId: "project-id",
        },
        /** @type {never} */ (loadSdk),
      ),
    )

    await expect(secrets.get("VALUE")).resolves.toBe("value")
    await secrets.close()
    expect(loadSdk).not.toHaveBeenCalled()
  })

  it("rejects a response without a secret string", async () => {
    const client = createClient(vi.fn().mockResolvedValue({}))
    const secrets = createReader(
      infisical({
        client: /** @type {never} */ (client),
        environment: "prod",
        projectId: "project-id",
      }),
    )

    await expect(secrets.get("VALUE")).rejects.toBeInstanceOf(SecretInvalidValueError)
  })

  it.each([
    [404, SecretNotFoundError],
    [401, SecretAuthenticationError],
    [403, SecretAccessDeniedError],
    [429, SecretRateLimitError],
    [503, SecretProviderError],
  ])("maps HTTP status %s to a sanitized domain error", async (status, ErrorFactory) => {
    const providerError = Object.assign(
      new Error(`[URL=https://example.test/provider-secret-id] [StatusCode=${status}] raw body`),
      { status },
    )
    const client = createClient(vi.fn().mockRejectedValue(providerError))
    const secrets = createReader(
      infisical({
        client: /** @type {never} */ (client),
        environment: "prod",
        projectId: "project-id",
      }),
    )

    const error = await secrets.get("VALUE").catch((reason) => reason)
    expect(error).toBeInstanceOf(ErrorFactory)
    expect(error).toMatchObject({
      provider: "infisical",
      providerCode: String(status),
      retryable: status === 429 || status === 503,
    })
    expect(error.message).not.toContain("provider-secret-id")
    expect(error.message).not.toContain("raw body")
    expect(error.cause).toBe(providerError)
  })

  it.each([
    ["http://localhost:8080"],
    ["http://127.0.0.1:8080"],
    ["http://[::1]:8080"],
    ["https://infisical.example.com"],
  ])("accepts secure or loopback site URL %s", (siteUrl) => {
    expect(() => infisical({ ...universalAuthOptions(), siteUrl })).not.toThrow()
  })

  it.each([
    [/** @type {never} */ (undefined)],
    [{ environment: "", projectId: "project", auth: universalAuthOptions().auth }],
    [{ environment: "prod", projectId: "", auth: universalAuthOptions().auth }],
    [{ ...universalAuthOptions(), auth: { clientId: "", clientSecret: "secret" } }],
    [{ ...universalAuthOptions(), client: /** @type {never} */ ({}) }],
    [{ ...universalAuthOptions(), secretPath: "" }],
    [{ ...universalAuthOptions(), siteUrl: "http://example.com" }],
    [{ ...universalAuthOptions(), siteUrl: "not a URL" }],
    [{ ...universalAuthOptions(), unknown: true }],
  ])("rejects invalid options %#", (options) => {
    expect(() => infisical(/** @type {never} */ (options))).toThrow(SecretsKitConfigurationError)
  })
})
