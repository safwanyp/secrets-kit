export { createSecretsKit } from "./client.js"
export { aws } from "./providers/aws.js"

export {
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
} from "./errors.js"
