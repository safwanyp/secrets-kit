/** @import { CacheEntry, NormalizedSecretDefinition, NormalizedSource, ProviderRuntime, ProviderValue, ReadOptions, RuntimePromiseMap } from "../types/internal.js" */
/** @import { ProviderDescriptor, SecretDefinition, SecretsKit, SecretsKitConfig, SecretsKitError } from "../types/public.js" */

import { normalizeConfig } from "./config.js"
import {
  SecretDefinitionNotFoundError,
  SecretProviderError,
  SecretReadAbortedError,
  SecretsKitClosedError,
  SecretsKitConfigurationError,
  SecretsKitError as SecretsKitErrorFactory,
} from "./errors.js"
import { copyValue, extractField, valueToBytes, valueToString } from "./value.js"

/**
 * @template {Readonly<Record<string, SecretDefinition>>} TSecrets
 * @param {SecretsKitConfig<TSecrets>} input
 * @returns {SecretsKit<Extract<keyof TSecrets, string>>}
 */
export function createSecretsKit(input) {
  const config = normalizeConfig(input)
  const sourceById = new Map(config.sources.map((source) => [source.id, source]))
  /** @type {RuntimePromiseMap} */
  const runtimePromises = new Map()
  /** @type {Map<NormalizedSource, Map<string, Promise<ProviderValue>>>} */
  const providerReads = new Map()
  /** @type {Map<string, CacheEntry>} */
  const cache = new Map()
  /** @type {Map<string, number>} */
  const generations = new Map()
  /** @type {Map<string, Promise<void>>} */
  const backgroundRefreshes = new Map()
  /** @type {Set<Promise<unknown>>} */
  const activeOperations = new Set()
  let closed = false
  /** @type {Promise<void> | undefined} */
  let closePromise

  /**
   * @param {Extract<keyof TSecrets, string>} name
   * @param {ReadOptions} [options]
   * @returns {Promise<string>}
   */
  async function get(name, options) {
    return valueToString(await readValue(name, options), name)
  }

  /**
   * @param {Extract<keyof TSecrets, string>} name
   * @param {ReadOptions} [options]
   * @returns {Promise<Uint8Array>}
   */
  async function getBytes(name, options) {
    return valueToBytes(await readValue(name, options))
  }

  /**
   * @param {Extract<keyof TSecrets, string>} [name]
   * @returns {void}
   */
  function invalidate(name) {
    assertOpen()

    if (name === undefined) {
      for (const secretName of Object.keys(config.secrets)) {
        incrementGeneration(secretName)
      }
      cache.clear()
      return
    }

    const definition = getDefinition(name)
    for (const [secretName, candidate] of Object.entries(config.secrets)) {
      if (candidate.source === definition.source && candidate.sourceId === definition.sourceId) {
        incrementGeneration(secretName)
        cache.delete(secretName)
      }
    }
  }

  /**
   * @returns {Promise<void>}
   */
  function close() {
    if (closePromise !== undefined) return closePromise

    closed = true
    closePromise = performClose()
    return closePromise
  }

  /**
   * @param {string} name
   * @param {ReadOptions | undefined} options
   * @returns {Promise<ProviderValue>}
   */
  async function readValue(name, options) {
    assertOpen()
    const definition = getDefinition(name)
    const signal = validateReadOptions(options)

    if (signal?.aborted) {
      throw readAbortedError(name, signal)
    }

    const generation = currentGeneration(name)
    const entry = cache.get(name)
    const now = Date.now()

    if (entry !== undefined && entry.generation === generation && entry.expiresAt > now) {
      if (now >= entry.refreshAt) {
        startBackgroundRefresh(name, definition, generation)
      }
      return copyValue(entry.value)
    }

    if (entry !== undefined) cache.delete(name)

    return waitForCaller(loadDefinitionValue(name, definition, generation), signal, name)
  }

  /**
   * @param {string} name
   * @param {NormalizedSecretDefinition} definition
   * @param {number} generation
   * @returns {Promise<ProviderValue>}
   */
  async function loadDefinitionValue(name, definition, generation) {
    const source = /** @type {NormalizedSource} */ (sourceById.get(definition.source))
    const providerValue = await readProvider(source, definition.sourceId)
    const value = extractField(providerValue, definition.field, name)

    if (definition.cache !== undefined && currentGeneration(name) === generation) {
      const completedAt = Date.now()
      cache.set(name, {
        expiresAt: completedAt + definition.cache.ttlMs,
        generation,
        refreshAt: completedAt + definition.cache.ttlMs - definition.cache.refreshAheadMs,
        value: copyValue(value),
      })
    }

    return value
  }

  /**
   * @param {string} name
   * @param {NormalizedSecretDefinition} definition
   * @param {number} generation
   * @returns {void}
   */
  function startBackgroundRefresh(name, definition, generation) {
    if (backgroundRefreshes.has(name)) return

    const refresh = track(
      loadDefinitionValue(name, definition, generation).then(
        () => undefined,
        (error) => {
          notifyBackgroundError(asDomainError(error, definition.source))
        },
      ),
    )
    backgroundRefreshes.set(name, refresh)
    void refresh.then(
      () => backgroundRefreshes.delete(name),
      () => backgroundRefreshes.delete(name),
    )
  }

  /**
   * @param {NormalizedSource} source
   * @param {string} sourceId
   * @returns {Promise<ProviderValue>}
   */
  function readProvider(source, sourceId) {
    let readsById = providerReads.get(source)
    if (readsById === undefined) {
      readsById = new Map()
      providerReads.set(source, readsById)
    }

    const existing = readsById.get(sourceId)
    if (existing !== undefined) return existing

    const operation = track(
      getRuntime(source)
        .then((runtime) => runtime.read(sourceId))
        .then(assertProviderValue)
        .then(copyValue)
        .catch((error) => {
          throw asDomainError(error, source.id, source.providerDefinition.name)
        }),
    )
    readsById.set(sourceId, operation)
    void operation.then(
      () => finishProviderRead(source, sourceId, operation),
      () => finishProviderRead(source, sourceId, operation),
    )
    return operation
  }

  /**
   * @param {NormalizedSource} source
   * @param {string} sourceId
   * @param {Promise<ProviderValue>} operation
   * @returns {void}
   */
  function finishProviderRead(source, sourceId, operation) {
    const readsById = providerReads.get(source)
    if (readsById?.get(sourceId) !== operation) return

    readsById.delete(sourceId)
    if (readsById.size === 0) providerReads.delete(source)
  }

  /**
   * @param {NormalizedSource} source
   * @returns {Promise<ProviderRuntime>}
   */
  function getRuntime(source) {
    const existing = runtimePromises.get(source.provider)
    if (existing !== undefined) return existing

    const runtimePromise = Promise.resolve()
      .then(() => source.providerDefinition.createRuntime())
      .then(assertProviderRuntime)
    runtimePromises.set(source.provider, runtimePromise)
    return runtimePromise
  }

  /**
   * @returns {Promise<void>}
   */
  async function performClose() {
    await Promise.allSettled(activeOperations)

    cache.clear()

    const runtimes = await Promise.allSettled(runtimePromises.values())
    const closeResults = await Promise.allSettled(
      runtimes.flatMap((result) => (result.status === "fulfilled" ? [result.value.close()] : [])),
    )
    const failedClose = closeResults.find((result) => result.status === "rejected")
    if (failedClose?.status === "rejected") {
      throw SecretProviderError("Could not close a provider client", {
        cause: failedClose.reason,
      })
    }
  }

  /**
   * @param {string} name
   * @returns {NormalizedSecretDefinition}
   */
  function getDefinition(name) {
    const definition = config.secrets[name]
    if (definition === undefined) {
      throw SecretDefinitionNotFoundError("Secret definition is not declared", {
        secretName: name,
      })
    }
    return definition
  }

  /**
   * @returns {void}
   */
  function assertOpen() {
    if (closed) {
      throw SecretsKitClosedError("Secrets Kit is closed")
    }
  }

  /**
   * @param {string} name
   * @returns {number}
   */
  function currentGeneration(name) {
    return generations.get(name) ?? 0
  }

  /**
   * @param {string} name
   * @returns {void}
   */
  function incrementGeneration(name) {
    generations.set(name, currentGeneration(name) + 1)
  }

  /**
   * @template T
   * @param {Promise<T>} operation
   * @returns {Promise<T>}
   */
  function track(operation) {
    activeOperations.add(operation)
    void operation.then(
      () => activeOperations.delete(operation),
      () => activeOperations.delete(operation),
    )
    return operation
  }

  /**
   * @param {SecretsKitError} error
   * @returns {void}
   */
  function notifyBackgroundError(error) {
    if (config.onBackgroundError === undefined) return

    try {
      config.onBackgroundError(error)
    } catch {
      // Application telemetry must not turn a handled refresh failure into a crash.
    }
  }

  return Object.freeze({ close, get, getBytes, invalidate })
}

/**
 * @param {ReadOptions | undefined} options
 * @returns {AbortSignal | undefined}
 */
function validateReadOptions(options) {
  if (options === undefined) return undefined
  if (
    typeof options !== "object" ||
    options === null ||
    Object.keys(options).some((key) => key !== "signal")
  ) {
    throw SecretsKitConfigurationError("Read options may only contain signal")
  }

  if (options.signal !== undefined && !isAbortSignal(options.signal)) {
    throw SecretsKitConfigurationError("Read option signal must be an AbortSignal")
  }
  return options.signal
}

/**
 * @param {unknown} value
 * @returns {value is AbortSignal}
 */
function isAbortSignal(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (/** @type {AbortSignal} */ (value).aborted) === "boolean" &&
    typeof (/** @type {AbortSignal} */ (value).addEventListener) === "function" &&
    typeof (/** @type {AbortSignal} */ (value).removeEventListener) === "function"
  )
}

/**
 * @template T
 * @param {Promise<T>} operation
 * @param {AbortSignal | undefined} signal
 * @param {string} secretName
 * @returns {Promise<T>}
 */
function waitForCaller(operation, signal, secretName) {
  if (signal === undefined) return operation
  if (signal.aborted) return Promise.reject(readAbortedError(secretName, signal))

  return new Promise((resolve, reject) => {
    let settled = false

    const cleanup = () => signal.removeEventListener("abort", abort)
    const abort = () => {
      if (settled) return
      settled = true
      cleanup()
      reject(readAbortedError(secretName, signal))
    }

    signal.addEventListener("abort", abort, { once: true })
    if (signal.aborted) abort()

    void operation.then(
      (value) => {
        if (settled) return undefined
        settled = true
        cleanup()
        resolve(value)
        return undefined
      },
      (error) => {
        if (settled) return undefined
        settled = true
        cleanup()
        reject(error)
        return undefined
      },
    )
  })
}

/**
 * @param {string} secretName
 * @param {AbortSignal} signal
 * @returns {import("../types/public.js").SecretReadAbortedError}
 */
function readAbortedError(secretName, signal) {
  return /** @type {import("../types/public.js").SecretReadAbortedError} */ (
    SecretReadAbortedError("Secret read was aborted", {
      cause: signal.reason,
      secretName,
    })
  )
}

/**
 * @param {unknown} error
 * @param {string} source
 * @param {string} [provider]
 * @returns {SecretsKitError}
 */
function asDomainError(error, source, provider) {
  if (error instanceof SecretsKitErrorFactory) {
    return /** @type {SecretsKitError} */ (error)
  }
  return /** @type {SecretsKitError} */ (
    SecretProviderError("Provider operation failed", {
      cause: error,
      ...(provider === undefined ? {} : { provider }),
      source,
    })
  )
}

/**
 * @param {unknown} value
 * @returns {ProviderValue}
 */
function assertProviderValue(value) {
  if (
    typeof value === "object" &&
    value !== null &&
    ((/** @type {Partial<ProviderValue>} */ (value).kind === "text" &&
      typeof (/** @type {{ value?: unknown }} */ (value).value) === "string") ||
      (/** @type {Partial<ProviderValue>} */ (value).kind === "bytes" &&
        /** @type {{ value?: unknown }} */ (value).value instanceof Uint8Array))
  ) {
    return /** @type {ProviderValue} */ (value)
  }
  throw new TypeError("Provider returned an invalid value")
}

/**
 * @param {unknown} value
 * @returns {ProviderRuntime}
 */
function assertProviderRuntime(value) {
  if (
    typeof value === "object" &&
    value !== null &&
    typeof (/** @type {Partial<ProviderRuntime>} */ (value).read) === "function" &&
    typeof (/** @type {Partial<ProviderRuntime>} */ (value).close) === "function"
  ) {
    return /** @type {ProviderRuntime} */ (value)
  }
  throw new TypeError("Provider factory returned an invalid runtime")
}
