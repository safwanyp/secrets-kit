import { describe, expect, it } from "vitest"

import {
  SecretAccessDeniedError,
  SecretAuthenticationError,
  SecretDefinitionNotFoundError,
  SecretInvalidValueError,
  SecretNotFoundError,
  SecretProviderError,
  SecretRateLimitError,
  SecretReadAbortedError,
  SecretsKitClosedError,
  SecretsKitConfigurationError,
  SecretsKitError,
} from "../src/index.js"

/** @type {Array<[typeof SecretsKitError, string]>} */
const cases = [
  [SecretsKitConfigurationError, "SECRETS_KIT_CONFIGURATION"],
  [SecretsKitClosedError, "SECRETS_KIT_CLOSED"],
  [SecretDefinitionNotFoundError, "SECRET_DEFINITION_NOT_FOUND"],
  [SecretNotFoundError, "SECRET_NOT_FOUND"],
  [SecretAuthenticationError, "SECRET_AUTHENTICATION"],
  [SecretAccessDeniedError, "SECRET_ACCESS_DENIED"],
  [SecretRateLimitError, "SECRET_RATE_LIMIT"],
  [SecretReadAbortedError, "SECRET_READ_ABORTED"],
  [SecretInvalidValueError, "SECRET_INVALID_VALUE"],
  [SecretProviderError, "SECRET_PROVIDER"],
]

describe("domain errors", () => {
  it.each(cases)("creates %s with a stable code", (createError, code) => {
    const error = createError("safe message")

    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(SecretsKitError)
    expect(error).toBeInstanceOf(createError)
    expect(error).toMatchObject({ code, message: "safe message" })
  })

  it("retains cause as a non-enumerable property", () => {
    const cause = new Error("provider metadata")
    const error = SecretProviderError("provider failed", {
      cause,
      provider: "aws",
      providerCode: "ServiceUnavailableException",
      retryable: true,
    })

    expect(error.cause).toBe(cause)
    expect(Object.keys(error)).toEqual(["code", "provider", "providerCode", "retryable"])
    expect(JSON.stringify(error)).not.toContain("provider metadata")
  })
})
