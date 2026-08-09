/** @import { ProviderRuntime } from "../../types/internal.js" */
/** @import { GcpOptions, GcpSecretManagerClient, ProviderDescriptor, SecretsKitError } from "../../types/public.js" */

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

/** @typedef {Pick<typeof import("@google-cloud/secret-manager"), "SecretManagerServiceClient">} GcpSdk */

const authenticationCodes = new Set([16, "UNAUTHENTICATED"])
const accessDeniedCodes = new Set([7, "PERMISSION_DENIED"])
const notFoundCodes = new Set([5, "NOT_FOUND"])
const rateLimitCodes = new Set([8, "RESOURCE_EXHAUSTED"])
const retryableCodes = new Set([
  4,
  8,
  10,
  13,
  14,
  "ABORTED",
  "DEADLINE_EXCEEDED",
  "INTERNAL",
  "RESOURCE_EXHAUSTED",
  "UNAVAILABLE",
])

/**
 * Creates a Google Cloud Secret Manager provider.
 *
 * @param {GcpOptions} [options]
 * @returns {ProviderDescriptor}
 */
export function gcp(options = {}) {
  return createGcpProvider(options)
}

/**
 * Internal factory with an injectable SDK loader for explicit tests.
 *
 * @param {GcpOptions} options
 * @param {() => Promise<GcpSdk>} [loadSdk]
 * @returns {ProviderDescriptor}
 */
export function createGcpProvider(options, loadSdk = () => import("@google-cloud/secret-manager")) {
  const normalized = normalizeOptions(options)

  return createProviderDescriptor({
    name: "gcp",
    async createRuntime() {
      if (normalized.client !== undefined) {
        return createRuntime(normalized.client, normalized)
      }

      const { SecretManagerServiceClient } = await loadSdk()
      const client = new SecretManagerServiceClient(
        normalized.location === undefined
          ? {}
          : { apiEndpoint: regionalEndpoint(normalized.location) },
      )
      return createRuntime(client, normalized, () => client.close())
    },
  })
}

/**
 * @param {GcpSecretManagerClient} client
 * @param {{ location?: string, projectId?: string }} options
 * @param {() => Promise<void>} [close]
 * @returns {ProviderRuntime}
 */
function createRuntime(client, options, close) {
  /** @type {Promise<string> | undefined} */
  let projectIdPromise

  async function resolveProjectId() {
    if (options.projectId !== undefined) return options.projectId
    projectIdPromise ??= client.getProjectId()
    const projectId = await projectIdPromise
    if (typeof projectId !== "string" || projectId.length === 0) {
      throw SecretInvalidValueError("GCP resolved an invalid project ID", {
        provider: "gcp",
      })
    }
    return projectId
  }

  return {
    async close() {
      await close?.()
    },
    async read(sourceId) {
      try {
        const projectId = await resolveProjectId()
        const name =
          options.location === undefined
            ? `projects/${projectId}/secrets/${sourceId}/versions/latest`
            : `projects/${projectId}/locations/${options.location}/secrets/${sourceId}/versions/latest`
        const [response] = await client.accessSecretVersion({ name })
        const data = response.payload?.data

        if (!(data instanceof Uint8Array)) {
          throw SecretInvalidValueError("GCP returned no binary secret payload", {
            provider: "gcp",
          })
        }
        return { kind: "bytes", value: new Uint8Array(data) }
      } catch (error) {
        throw mapGcpError(error)
      }
    },
  }
}

/**
 * @param {GcpOptions} options
 * @returns {{ client?: GcpSecretManagerClient, location?: string, projectId?: string }}
 */
function normalizeOptions(options) {
  if (typeof options !== "object" || options === null || Array.isArray(options)) {
    throw configurationError("GCP options must be an object")
  }

  const unknown = Object.keys(options).filter(
    (key) => key !== "client" && key !== "location" && key !== "projectId",
  )
  if (unknown.length > 0) {
    throw configurationError("GCP options contain unknown properties")
  }
  for (const [name, value] of [
    ["location", options.location],
    ["projectId", options.projectId],
  ]) {
    if (value !== undefined && (typeof value !== "string" || value.length === 0)) {
      throw configurationError(`GCP ${name} must be a non-empty string`)
    }
  }
  if (options.client !== undefined && !isClient(options.client)) {
    throw configurationError("GCP client must be an official Secret Manager client")
  }
  if (
    options.client !== undefined &&
    options.location !== undefined &&
    options.client.apiEndpoint !== regionalEndpoint(options.location)
  ) {
    throw configurationError("GCP injected client endpoint does not match the configured location")
  }

  return Object.freeze({
    ...(options.client === undefined ? {} : { client: options.client }),
    ...(options.location === undefined ? {} : { location: options.location }),
    ...(options.projectId === undefined ? {} : { projectId: options.projectId }),
  })
}

/**
 * @param {unknown} value
 * @returns {value is GcpSecretManagerClient}
 */
function isClient(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (/** @type {Partial<GcpSecretManagerClient>} */ (value).accessSecretVersion) ===
      "function" &&
    typeof (/** @type {Partial<GcpSecretManagerClient>} */ (value).getProjectId) === "function" &&
    typeof (/** @type {Partial<GcpSecretManagerClient>} */ (value).apiEndpoint) === "string"
  )
}

/**
 * @param {string} location
 * @returns {string}
 */
function regionalEndpoint(location) {
  return `secretmanager.${location}.rep.googleapis.com`
}

/**
 * @param {unknown} error
 * @returns {SecretsKitError}
 */
function mapGcpError(error) {
  if (error instanceof SecretInvalidValueError) {
    return /** @type {SecretsKitError} */ (error)
  }

  const code = readCode(error)
  const options = {
    cause: error,
    provider: "gcp",
    ...(code === undefined ? {} : { providerCode: String(code) }),
    ...(code === undefined ? {} : { retryable: retryableCodes.has(code) }),
  }

  if (code !== undefined && notFoundCodes.has(code)) {
    return /** @type {SecretsKitError} */ (SecretNotFoundError("GCP secret was not found", options))
  }
  if (code !== undefined && authenticationCodes.has(code)) {
    return /** @type {SecretsKitError} */ (
      SecretAuthenticationError("GCP authentication failed", options)
    )
  }
  if (code !== undefined && accessDeniedCodes.has(code)) {
    return /** @type {SecretsKitError} */ (
      SecretAccessDeniedError("GCP denied access to the secret", options)
    )
  }
  if (code !== undefined && rateLimitCodes.has(code)) {
    return /** @type {SecretsKitError} */ (
      SecretRateLimitError("GCP rate limited the secret read", options)
    )
  }
  return /** @type {SecretsKitError} */ (SecretProviderError("GCP secret read failed", options))
}

/**
 * @param {unknown} error
 * @returns {number | string | undefined}
 */
function readCode(error) {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined
  }
  return typeof error.code === "number" || typeof error.code === "string" ? error.code : undefined
}

/**
 * @param {string} message
 * @returns {import("../../types/public.js").SecretsKitConfigurationError}
 */
function configurationError(message) {
  return /** @type {import("../../types/public.js").SecretsKitConfigurationError} */ (
    SecretsKitConfigurationError(message, { provider: "gcp" })
  )
}
