/** @import { ProviderRuntime } from "../../types/internal.js" */
/** @import { InfisicalClient, InfisicalOptions, ProviderDescriptor, SecretsKitError } from "../../types/public.js" */

import {
  SecretAccessDeniedError,
  SecretAuthenticationError,
  SecretInvalidValueError,
  SecretNotFoundError,
  SecretProviderError,
  SecretRateLimitError,
  SecretsKitConfigurationError,
} from "../errors.js"
import { createProviderDescriptor } from "../provider.js"

/** @typedef {Pick<typeof import("@infisical/sdk"), "InfisicalSDK">} InfisicalSdkModule */
/** @typedef {{ clientId: string, clientSecret: string }} UniversalAuthCredentials */

const defaultSiteUrl = "https://app.infisical.com"
const retryableStatuses = new Set([408, 429, 500, 502, 503, 504])

/**
 * Creates an Infisical provider.
 *
 * @param {InfisicalOptions} options
 * @returns {ProviderDescriptor}
 */
export function infisical(options) {
  return createInfisicalProvider(options)
}

/**
 * Internal factory with an injectable SDK loader for explicit tests.
 *
 * @param {InfisicalOptions} options
 * @param {() => Promise<InfisicalSdkModule>} [loadSdk]
 * @returns {ProviderDescriptor}
 */
export function createInfisicalProvider(options, loadSdk = () => import("@infisical/sdk")) {
  const normalized = normalizeOptions(options)

  return createProviderDescriptor({
    name: "infisical",
    async createRuntime() {
      if (normalized.client !== undefined) {
        return createInjectedRuntime(normalized.client, normalized)
      }

      const { InfisicalSDK } = await loadSdk()
      const client = new InfisicalSDK({ siteUrl: normalized.siteUrl })
      return createUniversalAuthRuntime(
        client,
        /** @type {UniversalAuthCredentials} */ (normalized.auth),
        normalized,
      )
    },
  })
}

/**
 * @param {InfisicalClient} client
 * @param {{ environment: string, projectId: string, secretPath: string }} options
 * @returns {ProviderRuntime}
 */
function createInjectedRuntime(client, options) {
  return {
    async close() {},
    async read(sourceId) {
      try {
        return await readSecret(client, sourceId, options)
      } catch (error) {
        throw mapInfisicalError(error)
      }
    },
  }
}

/**
 * @param {import("@infisical/sdk").InfisicalSDK} initialClient
 * @param {UniversalAuthCredentials} initialCredentials
 * @param {{ environment: string, projectId: string, secretPath: string }} options
 * @returns {ProviderRuntime}
 */
function createUniversalAuthRuntime(initialClient, initialCredentials, options) {
  /** @type {import("@infisical/sdk").InfisicalSDK | undefined} */
  let loginClient = initialClient
  /** @type {UniversalAuthCredentials | undefined} */
  let credentials = initialCredentials
  /** @type {InfisicalClient | undefined} */
  let authenticatedClient
  /** @type {Promise<InfisicalClient> | undefined} */
  let loginPromise
  /** @type {Promise<InfisicalClient> | undefined} */
  let refreshPromise

  function login() {
    if (authenticatedClient !== undefined) return Promise.resolve(authenticatedClient)
    if (loginPromise !== undefined) return loginPromise
    if (loginClient === undefined || credentials === undefined) {
      return Promise.reject(new Error("Infisical runtime is closed"))
    }

    const pending = loginClient.auth().universalAuth.login(credentials)
    loginPromise = pending.then((client) => {
      authenticatedClient = client
      return client
    })
    void loginPromise.then(clearLoginPromise, clearLoginPromise)
    return loginPromise
  }

  /**
   * @param {InfisicalClient} staleClient
   * @returns {Promise<InfisicalClient>}
   */
  function refresh(staleClient) {
    if (authenticatedClient !== staleClient && authenticatedClient !== undefined) {
      return Promise.resolve(authenticatedClient)
    }
    if (refreshPromise !== undefined) return refreshPromise

    const pending = renewOrLogin(staleClient)
    refreshPromise = pending.then((client) => {
      authenticatedClient = client
      return client
    })
    void refreshPromise.then(clearRefreshPromise, clearRefreshPromise)
    return refreshPromise
  }

  /**
   * @param {InfisicalClient} staleClient
   * @returns {Promise<InfisicalClient>}
   */
  async function renewOrLogin(staleClient) {
    if (!hasUniversalAuth(staleClient)) {
      throw new Error("Infisical authenticated client cannot renew Universal Auth")
    }

    try {
      return await staleClient.auth().universalAuth.renew()
    } catch {
      authenticatedClient = undefined
      return login()
    }
  }

  function clearLoginPromise() {
    loginPromise = undefined
  }

  function clearRefreshPromise() {
    refreshPromise = undefined
  }

  return {
    async close() {
      authenticatedClient = undefined
      credentials = undefined
      loginClient = undefined
      loginPromise = undefined
      refreshPromise = undefined
    },
    async read(sourceId) {
      /** @type {InfisicalClient | undefined} */
      let client
      try {
        client = await login()
        return await readSecret(client, sourceId, options)
      } catch (error) {
        if (client !== undefined && readStatus(error) === 401) {
          try {
            const refreshedClient = await refresh(client)
            return await readSecret(refreshedClient, sourceId, options)
          } catch (refreshError) {
            throw mapInfisicalError(refreshError)
          }
        }
        throw mapInfisicalError(error)
      }
    },
  }
}

/**
 * @param {InfisicalClient} client
 * @param {string} sourceId
 * @param {{ environment: string, projectId: string, secretPath: string }} options
 * @returns {Promise<import("../../types/internal.js").ProviderValue>}
 */
async function readSecret(client, sourceId, options) {
  const secret = await client.secrets().getSecret({
    environment: options.environment,
    expandSecretReferences: false,
    includeImports: false,
    projectId: options.projectId,
    secretName: sourceId,
    secretPath: options.secretPath,
    viewSecretValue: true,
  })
  if (typeof secret.secretValue !== "string") {
    throw SecretInvalidValueError("Infisical returned no secret value", {
      provider: "infisical",
    })
  }
  return { kind: "text", value: secret.secretValue }
}

/**
 * @param {InfisicalOptions} options
 * @returns {{ auth?: UniversalAuthCredentials, client?: InfisicalClient, environment: string, projectId: string, secretPath: string, siteUrl: string }}
 */
function normalizeOptions(options) {
  if (typeof options !== "object" || options === null || Array.isArray(options)) {
    throw configurationError("Infisical options must be an object")
  }

  const unknown = Object.keys(options).filter(
    (key) =>
      key !== "auth" &&
      key !== "client" &&
      key !== "environment" &&
      key !== "projectId" &&
      key !== "secretPath" &&
      key !== "siteUrl",
  )
  if (unknown.length > 0) {
    throw configurationError("Infisical options contain unknown properties")
  }
  for (const [name, value] of [
    ["environment", options.environment],
    ["projectId", options.projectId],
  ]) {
    if (typeof value !== "string" || value.length === 0) {
      throw configurationError(`Infisical ${name} must be a non-empty string`)
    }
  }
  if (
    options.secretPath !== undefined &&
    (typeof options.secretPath !== "string" || options.secretPath.length === 0)
  ) {
    throw configurationError("Infisical secretPath must be a non-empty string")
  }
  if ((options.auth === undefined) === (options.client === undefined)) {
    throw configurationError("Infisical requires exactly one of auth or client")
  }
  if (options.auth !== undefined && !isUniversalAuth(options.auth)) {
    throw configurationError("Infisical auth requires only a non-empty clientId and clientSecret")
  }
  if (options.client !== undefined && !isClient(options.client)) {
    throw configurationError("Infisical client must be an authenticated official client")
  }

  const siteUrl = normalizeSiteUrl(options.siteUrl)
  return Object.freeze({
    ...(options.auth === undefined
      ? {}
      : {
          auth: Object.freeze({
            clientId: options.auth.clientId,
            clientSecret: options.auth.clientSecret,
          }),
        }),
    ...(options.client === undefined ? {} : { client: options.client }),
    environment: /** @type {string} */ (options.environment),
    projectId: /** @type {string} */ (options.projectId),
    secretPath: options.secretPath ?? "/",
    siteUrl,
  })
}

/**
 * @param {unknown} value
 * @returns {value is UniversalAuthCredentials}
 */
function isUniversalAuth(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).every((key) => key === "clientId" || key === "clientSecret") &&
    "clientId" in value &&
    typeof value.clientId === "string" &&
    value.clientId.length > 0 &&
    "clientSecret" in value &&
    typeof value.clientSecret === "string" &&
    value.clientSecret.length > 0
  )
}

/**
 * @param {unknown} value
 * @returns {value is InfisicalClient}
 */
function isClient(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (/** @type {Partial<InfisicalClient>} */ (value).secrets) === "function"
  )
}

/**
 * @param {InfisicalClient} value
 * @returns {value is import("@infisical/sdk").InfisicalSDK}
 */
function hasUniversalAuth(value) {
  return (
    typeof (/** @type {Partial<import("@infisical/sdk").InfisicalSDK>} */ (value).auth) ===
    "function"
  )
}

/**
 * @param {string | undefined} value
 * @returns {string}
 */
function normalizeSiteUrl(value) {
  if (value !== undefined && typeof value !== "string") {
    throw configurationError("Infisical siteUrl must be a URL string")
  }

  /** @type {URL} */
  let url
  try {
    url = new URL(value ?? defaultSiteUrl)
  } catch {
    throw configurationError("Infisical siteUrl must be a valid URL")
  }

  if (url.username !== "" || url.password !== "") {
    throw configurationError("Infisical siteUrl must not contain credentials")
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback(url.hostname))) {
    throw configurationError("Infisical siteUrl requires HTTPS except on loopback")
  }
  return url.toString().replace(/\/$/, "")
}

/**
 * @param {string} hostname
 * @returns {boolean}
 */
function isLoopback(hostname) {
  return hostname === "localhost" || hostname === "[::1]" || /^127(?:\.\d{1,3}){3}$/.test(hostname)
}

/**
 * @param {unknown} error
 * @returns {SecretsKitError}
 */
function mapInfisicalError(error) {
  if (error instanceof SecretInvalidValueError) {
    return /** @type {SecretsKitError} */ (error)
  }

  const status = readStatus(error)
  const options = {
    cause: error,
    provider: "infisical",
    ...(status === undefined ? {} : { providerCode: String(status) }),
    ...(status === undefined ? {} : { retryable: retryableStatuses.has(status) }),
  }

  if (status === 404) {
    return /** @type {SecretsKitError} */ (
      SecretNotFoundError("Infisical secret was not found", options)
    )
  }
  if (status === 401) {
    return /** @type {SecretsKitError} */ (
      SecretAuthenticationError("Infisical authentication failed", options)
    )
  }
  if (status === 403) {
    return /** @type {SecretsKitError} */ (
      SecretAccessDeniedError("Infisical denied access to the secret", options)
    )
  }
  if (status === 429) {
    return /** @type {SecretsKitError} */ (
      SecretRateLimitError("Infisical rate limited the secret read", options)
    )
  }
  return /** @type {SecretsKitError} */ (
    SecretProviderError("Infisical secret read failed", options)
  )
}

/**
 * @param {unknown} error
 * @returns {number | undefined}
 */
function readStatus(error) {
  if (typeof error !== "object" || error === null) return undefined

  for (const candidate of [
    "status" in error ? error.status : undefined,
    "statusCode" in error ? error.statusCode : undefined,
    readResponseStatus(/** @type {Record<string, unknown>} */ (error)),
  ]) {
    if (typeof candidate === "number") return candidate
  }

  if ("message" in error && typeof error.message === "string") {
    const match = /\[StatusCode=(\d{3})\]/.exec(error.message)
    if (match?.[1] !== undefined) return Number(match[1])
  }
  return undefined
}

/**
 * @param {Record<string, unknown>} error
 * @returns {unknown}
 */
function readResponseStatus(error) {
  if (typeof error.response !== "object" || error.response === null) return undefined
  return "status" in error.response ? error.response.status : undefined
}

/**
 * @param {string} message
 * @returns {import("../../types/public.js").SecretsKitConfigurationError}
 */
function configurationError(message) {
  return /** @type {import("../../types/public.js").SecretsKitConfigurationError} */ (
    SecretsKitConfigurationError(message, { provider: "infisical" })
  )
}
