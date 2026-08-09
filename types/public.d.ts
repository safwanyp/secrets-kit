export type SecretsKitErrorCode =
  | "SECRETS_KIT_ERROR"
  | "SECRETS_KIT_CONFIGURATION"
  | "SECRETS_KIT_CLOSED"
  | "SECRET_DEFINITION_NOT_FOUND"
  | "SECRET_NOT_FOUND"
  | "SECRET_AUTHENTICATION"
  | "SECRET_ACCESS_DENIED"
  | "SECRET_RATE_LIMIT"
  | "SECRET_READ_ABORTED"
  | "SECRET_INVALID_VALUE"
  | "SECRET_PROVIDER"

export interface SecretsKitErrorOptions extends ErrorOptions {
  readonly secretName?: string
  readonly source?: string
  readonly provider?: string
  readonly providerCode?: string
  readonly requestId?: string
  readonly retryable?: boolean
}

export interface SecretsKitError extends Error {
  readonly code: SecretsKitErrorCode
  readonly secretName?: string
  readonly source?: string
  readonly provider?: string
  readonly providerCode?: string
  readonly requestId?: string
  readonly retryable?: boolean
}

interface SecretsKitErrorFactory<TError extends SecretsKitError> {
  (message: string, options?: SecretsKitErrorOptions): TError
  readonly prototype: TError
}

export interface SecretsKitConfigurationError extends SecretsKitError {
  readonly code: "SECRETS_KIT_CONFIGURATION"
}

export interface SecretsKitClosedError extends SecretsKitError {
  readonly code: "SECRETS_KIT_CLOSED"
}

export interface SecretDefinitionNotFoundError extends SecretsKitError {
  readonly code: "SECRET_DEFINITION_NOT_FOUND"
}

export interface SecretNotFoundError extends SecretsKitError {
  readonly code: "SECRET_NOT_FOUND"
}

export interface SecretAuthenticationError extends SecretsKitError {
  readonly code: "SECRET_AUTHENTICATION"
}

export interface SecretAccessDeniedError extends SecretsKitError {
  readonly code: "SECRET_ACCESS_DENIED"
}

export interface SecretRateLimitError extends SecretsKitError {
  readonly code: "SECRET_RATE_LIMIT"
}

export interface SecretReadAbortedError extends SecretsKitError {
  readonly code: "SECRET_READ_ABORTED"
}

export interface SecretInvalidValueError extends SecretsKitError {
  readonly code: "SECRET_INVALID_VALUE"
}

export interface SecretProviderError extends SecretsKitError {
  readonly code: "SECRET_PROVIDER"
}

export const SecretsKitError: SecretsKitErrorFactory<SecretsKitError>
export const SecretsKitConfigurationError: SecretsKitErrorFactory<SecretsKitConfigurationError>
export const SecretsKitClosedError: SecretsKitErrorFactory<SecretsKitClosedError>
export const SecretDefinitionNotFoundError: SecretsKitErrorFactory<SecretDefinitionNotFoundError>
export const SecretNotFoundError: SecretsKitErrorFactory<SecretNotFoundError>
export const SecretAuthenticationError: SecretsKitErrorFactory<SecretAuthenticationError>
export const SecretAccessDeniedError: SecretsKitErrorFactory<SecretAccessDeniedError>
export const SecretRateLimitError: SecretsKitErrorFactory<SecretRateLimitError>
export const SecretReadAbortedError: SecretsKitErrorFactory<SecretReadAbortedError>
export const SecretInvalidValueError: SecretsKitErrorFactory<SecretInvalidValueError>
export const SecretProviderError: SecretsKitErrorFactory<SecretProviderError>
