/**
 * @typedef {object} ErrorContext
 * @property {string} [secretName] The application-owned logical secret name.
 * @property {string} [source] The application-owned source name.
 * @property {string} [provider] The provider adapter name.
 * @property {string} [providerCode] A sanitized provider error code.
 * @property {string} [requestId] A sanitized provider request identifier.
 * @property {boolean} [retryable] Whether the provider reported a retryable failure.
 */

/** @typedef {ErrorOptions & ErrorContext} SecretsKitErrorOptions */

/**
 * @typedef {Error & ErrorContext & { code: string }} DomainError
 */

/**
 * @typedef {((message: string, options?: SecretsKitErrorOptions) => DomainError) & {
 *   prototype: DomainError
 * }} ErrorFactory
 */

const contextKeys = /** @type {const} */ ([
  "secretName",
  "source",
  "provider",
  "providerCode",
  "requestId",
  "retryable",
])

/**
 * Creates an Error-compatible factory with a dedicated prototype.
 *
 * @param {string} name
 * @param {string} code
 * @param {ErrorFactory | ErrorConstructor} parent
 * @returns {ErrorFactory}
 */
function createErrorFactory(name, code, parent) {
  /**
   * @param {string} message
   * @param {SecretsKitErrorOptions} [options]
   * @returns {DomainError}
   */
  function createError(message, options = {}) {
    const error = /** @type {DomainError} */ (new Error(message, options))

    Object.setPrototypeOf(error, createError.prototype)
    Object.defineProperties(error, {
      code: {
        configurable: false,
        enumerable: true,
        value: code,
        writable: false,
      },
      name: {
        configurable: true,
        enumerable: false,
        value: name,
        writable: true,
      },
    })

    for (const key of contextKeys) {
      if (options[key] !== undefined) {
        Object.defineProperty(error, key, {
          configurable: false,
          enumerable: true,
          value: options[key],
          writable: false,
        })
      }
    }

    Error.captureStackTrace?.(error, createError)
    return error
  }

  Object.defineProperty(createError, "name", { value: name })
  createError.prototype = Object.create(parent.prototype, {
    constructor: {
      configurable: true,
      value: createError,
      writable: true,
    },
  })

  return /** @type {ErrorFactory} */ (createError)
}

export const SecretsKitError = createErrorFactory("SecretsKitError", "SECRETS_KIT_ERROR", Error)

export const SecretsKitConfigurationError = createErrorFactory(
  "SecretsKitConfigurationError",
  "SECRETS_KIT_CONFIGURATION",
  SecretsKitError,
)

export const SecretsKitClosedError = createErrorFactory(
  "SecretsKitClosedError",
  "SECRETS_KIT_CLOSED",
  SecretsKitError,
)

export const SecretDefinitionNotFoundError = createErrorFactory(
  "SecretDefinitionNotFoundError",
  "SECRET_DEFINITION_NOT_FOUND",
  SecretsKitError,
)

export const SecretNotFoundError = createErrorFactory(
  "SecretNotFoundError",
  "SECRET_NOT_FOUND",
  SecretsKitError,
)

export const SecretAuthenticationError = createErrorFactory(
  "SecretAuthenticationError",
  "SECRET_AUTHENTICATION",
  SecretsKitError,
)

export const SecretAccessDeniedError = createErrorFactory(
  "SecretAccessDeniedError",
  "SECRET_ACCESS_DENIED",
  SecretsKitError,
)

export const SecretRateLimitError = createErrorFactory(
  "SecretRateLimitError",
  "SECRET_RATE_LIMIT",
  SecretsKitError,
)

export const SecretReadAbortedError = createErrorFactory(
  "SecretReadAbortedError",
  "SECRET_READ_ABORTED",
  SecretsKitError,
)

export const SecretInvalidValueError = createErrorFactory(
  "SecretInvalidValueError",
  "SECRET_INVALID_VALUE",
  SecretsKitError,
)

export const SecretProviderError = createErrorFactory(
  "SecretProviderError",
  "SECRET_PROVIDER",
  SecretsKitError,
)
