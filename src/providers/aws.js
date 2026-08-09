/** @import { ProviderRuntime, ProviderValue } from "../../types/internal.js" */
/** @import { AwsOptions, AwsSecretsManagerClient, ProviderDescriptor, SecretsKitError } from "../../types/public.js" */

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

/** @typedef {Pick<typeof import("@aws-sdk/client-secrets-manager"), "SecretsManager">} AwsSdk */

const authenticationCodes = new Set([
  "ExpiredToken",
  "ExpiredTokenException",
  "IncompleteSignature",
  "InvalidClientTokenId",
  "SignatureDoesNotMatch",
  "UnrecognizedClientException",
])
const accessDeniedCodes = new Set(["AccessDenied", "AccessDeniedException"])
const rateLimitCodes = new Set([
  "LimitExceededException",
  "Throttling",
  "ThrottlingException",
  "TooManyRequestsException",
])

/**
 * Creates an AWS Secrets Manager provider.
 *
 * @param {AwsOptions} [options]
 * @returns {ProviderDescriptor}
 */
export function aws(options = {}) {
  return createAwsProvider(options)
}

/**
 * Internal factory with an injectable SDK loader for explicit tests.
 *
 * @param {AwsOptions} options
 * @param {() => Promise<AwsSdk>} [loadSdk]
 * @returns {ProviderDescriptor}
 */
export function createAwsProvider(
  options,
  loadSdk = () => import("@aws-sdk/client-secrets-manager"),
) {
  const normalized = normalizeOptions(options)

  return createProviderDescriptor({
    name: "aws",
    async createRuntime() {
      if (normalized.client !== undefined) {
        return createRuntime(normalized.client)
      }

      const { SecretsManager } = await loadSdk()
      const client = new SecretsManager(
        normalized.region === undefined ? {} : { region: normalized.region },
      )
      return createRuntime(client, () => client.destroy())
    },
  })
}

/**
 * @param {AwsSecretsManagerClient} client
 * @param {() => void} [destroy]
 * @returns {ProviderRuntime}
 */
function createRuntime(client, destroy) {
  return {
    async close() {
      destroy?.()
    },
    async read(sourceId) {
      try {
        const result = await client.getSecretValue({
          SecretId: sourceId,
          VersionStage: "AWSCURRENT",
        })

        if (result.SecretString !== undefined) {
          return { kind: "text", value: result.SecretString }
        }
        if (result.SecretBinary !== undefined) {
          return {
            kind: "bytes",
            value: new Uint8Array(result.SecretBinary),
          }
        }
        throw SecretInvalidValueError("AWS returned no secret value", {
          provider: "aws",
        })
      } catch (error) {
        throw mapAwsError(error)
      }
    },
  }
}

/**
 * @param {AwsOptions} options
 * @returns {{ client?: AwsSecretsManagerClient, region?: string }}
 */
function normalizeOptions(options) {
  if (typeof options !== "object" || options === null || Array.isArray(options)) {
    throw configurationError("AWS options must be an object")
  }

  const unknown = Object.keys(options).filter((key) => key !== "client" && key !== "region")
  if (unknown.length > 0) {
    throw configurationError("AWS options contain unknown properties")
  }
  if (options.client !== undefined && options.region !== undefined) {
    throw configurationError("AWS client and region are mutually exclusive")
  }
  if (
    options.region !== undefined &&
    (typeof options.region !== "string" || options.region.length === 0)
  ) {
    throw configurationError("AWS region must be a non-empty string")
  }
  if (
    options.client !== undefined &&
    (typeof options.client !== "object" ||
      options.client === null ||
      typeof options.client.getSecretValue !== "function")
  ) {
    throw configurationError("AWS client must be an official client with getSecretValue()")
  }

  return Object.freeze({
    ...(options.client === undefined ? {} : { client: options.client }),
    ...(options.region === undefined ? {} : { region: options.region }),
  })
}

/**
 * @param {unknown} error
 * @returns {SecretsKitError}
 */
function mapAwsError(error) {
  if (error instanceof SecretInvalidValueError) {
    return /** @type {SecretsKitError} */ (error)
  }

  const code = readString(error, "name") ?? readString(error, "Code")
  const requestId = readRequestId(error)
  const retryable = readRetryable(error)
  const options = {
    cause: error,
    provider: "aws",
    ...(code === undefined ? {} : { providerCode: code }),
    ...(requestId === undefined ? {} : { requestId }),
    ...(retryable === undefined ? {} : { retryable }),
  }

  if (code === "ResourceNotFoundException") {
    return /** @type {SecretsKitError} */ (SecretNotFoundError("AWS secret was not found", options))
  }
  if (code !== undefined && authenticationCodes.has(code)) {
    return /** @type {SecretsKitError} */ (
      SecretAuthenticationError("AWS authentication failed", options)
    )
  }
  if (code !== undefined && accessDeniedCodes.has(code)) {
    return /** @type {SecretsKitError} */ (
      SecretAccessDeniedError("AWS denied access to the secret", options)
    )
  }
  if (code !== undefined && rateLimitCodes.has(code)) {
    return /** @type {SecretsKitError} */ (
      SecretRateLimitError("AWS rate limited the secret read", options)
    )
  }
  return /** @type {SecretsKitError} */ (SecretProviderError("AWS secret read failed", options))
}

/**
 * @param {unknown} error
 * @returns {string | undefined}
 */
function readRequestId(error) {
  if (typeof error !== "object" || error === null || !("$metadata" in error)) {
    return undefined
  }
  return readString(error.$metadata, "requestId")
}

/**
 * @param {unknown} error
 * @returns {boolean | undefined}
 */
function readRetryable(error) {
  if (typeof error !== "object" || error === null || !("$retryable" in error)) {
    return undefined
  }
  const retryable = error.$retryable
  if (typeof retryable === "boolean") return retryable
  return typeof retryable === "object" && retryable !== null ? true : undefined
}

/**
 * @param {unknown} value
 * @param {string} property
 * @returns {string | undefined}
 */
function readString(value, property) {
  if (typeof value !== "object" || value === null || !(property in value)) {
    return undefined
  }
  const result = /** @type {Record<string, unknown>} */ (value)[property]
  return typeof result === "string" ? result : undefined
}

/**
 * @param {string} message
 * @returns {import("../../types/public.js").SecretsKitConfigurationError}
 */
function configurationError(message) {
  return /** @type {import("../../types/public.js").SecretsKitConfigurationError} */ (
    SecretsKitConfigurationError(message, { provider: "aws" })
  )
}
