/** @import { ErrorObject } from "ajv" */
/** @import { ConfigInput, NormalizedCachePolicy, NormalizedConfig, NormalizedSecretDefinition, RawCachePolicy } from "../types/internal.js" */

import validateConfig from "../generated/validate-config.js"
import { SecretsKitConfigurationError } from "./errors.js"
import { getProviderDefinition, isProviderDescriptor } from "./provider.js"

/**
 * @param {unknown} input
 * @returns {NormalizedConfig}
 */
export function normalizeConfig(input) {
  /** @type {string[]} */
  const issues = []

  if (!validateConfig(input)) {
    issues.push(...formatSchemaIssues(validateConfig.errors ?? []))
  }

  if (!isObject(input)) {
    throw configurationError(issues)
  }

  const config = /** @type {Partial<ConfigInput>} */ (input)
  const sourceInputs = Array.isArray(config.sources) ? config.sources : []
  const sourceIds = new Set()
  /** @type {import("../types/internal.js").NormalizedSource[]} */
  const sources = []

  for (const [index, source] of sourceInputs.entries()) {
    if (!isObject(source)) continue

    if (typeof source.id === "string") {
      if (sourceIds.has(source.id)) {
        issues.push(`/sources/${index}/id must be unique`)
      } else {
        sourceIds.add(source.id)
      }
    }

    if (!isProviderDescriptor(source.provider)) {
      issues.push(`/sources/${index}/provider must come from a provider factory`)
      continue
    }

    if (typeof source.id === "string" && source.id.length > 0) {
      sources.push(
        Object.freeze({
          id: source.id,
          provider: source.provider,
          providerDefinition: getProviderDefinition(source.provider),
        }),
      )
    }
  }

  if (config.onBackgroundError !== undefined && typeof config.onBackgroundError !== "function") {
    issues.push("/onBackgroundError must be a function")
  }

  const globalCache = normalizeCachePolicy(config.cache, "/cache", issues)
  const secretInputs = isObject(config.secrets) ? config.secrets : {}
  /** @type {Record<string, NormalizedSecretDefinition>} */
  const secrets = Object.create(null)

  for (const [name, value] of Object.entries(secretInputs)) {
    if (!isObject(value)) continue
    const definition = /** @type {Partial<import("../types/public.js").SecretDefinition>} */ (value)

    if (typeof definition.source === "string" && !sourceIds.has(definition.source)) {
      issues.push(`/secrets/${escapePath(name)}/source must reference a declared source`)
    }

    const cache =
      definition.cache === undefined
        ? globalCache
        : normalizeCachePolicy(definition.cache, `/secrets/${escapePath(name)}/cache`, issues)

    if (typeof definition.source === "string" && typeof definition.sourceId === "string") {
      const normalized = {
        ...(cache === undefined ? {} : { cache }),
        ...(typeof definition.field === "string" ? { field: definition.field } : {}),
        source: definition.source,
        sourceId: definition.sourceId,
      }
      secrets[name] = Object.freeze(normalized)
    }
  }

  if (issues.length > 0) {
    throw configurationError(issues)
  }

  return Object.freeze({
    ...(typeof config.onBackgroundError === "function"
      ? { onBackgroundError: config.onBackgroundError }
      : {}),
    secrets: Object.freeze(secrets),
    sources: Object.freeze(sources),
  })
}

/**
 * @param {RawCachePolicy} policy
 * @param {string} path
 * @param {string[]} issues
 * @returns {NormalizedCachePolicy | undefined}
 */
function normalizeCachePolicy(policy, path, issues) {
  if (policy === false || policy === undefined || !isObject(policy)) {
    return undefined
  }

  if (
    Number.isInteger(policy.ttlMs) &&
    policy.ttlMs > 0 &&
    (policy.refreshAheadMs === undefined ||
      (Number.isInteger(policy.refreshAheadMs) && policy.refreshAheadMs >= 0))
  ) {
    const refreshAheadMs = policy.refreshAheadMs ?? 0
    if (refreshAheadMs >= policy.ttlMs) {
      issues.push(`${path}/refreshAheadMs must be less than ttlMs`)
      return undefined
    }
    return Object.freeze({ refreshAheadMs, ttlMs: policy.ttlMs })
  }

  return undefined
}

/**
 * @param {readonly ErrorObject[]} errors
 * @returns {string[]}
 */
function formatSchemaIssues(errors) {
  return errors.map((error) => {
    const path = error.instancePath || "/"
    return `${path} ${error.message ?? "is invalid"}`
  })
}

/**
 * @param {string[]} issues
 * @returns {import("../types/public.js").SecretsKitConfigurationError}
 */
function configurationError(issues) {
  const uniqueIssues = [...new Set(issues)]
  return /** @type {import("../types/public.js").SecretsKitConfigurationError} */ (
    SecretsKitConfigurationError(
      `Invalid Secrets Kit configuration:\n${uniqueIssues.map((issue) => `- ${issue}`).join("\n")}`,
    )
  )
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * @param {string} value
 * @returns {string}
 */
function escapePath(value) {
  return value.replaceAll("~", "~0").replaceAll("/", "~1")
}
