# Secrets Kit

Secrets Kit is a small, read-only Node.js SDK for retrieving application-declared secrets from AWS Secrets Manager, Google Cloud Secret Manager, and Infisical through one API.

Secret values travel directly from the provider to your application. Secrets Kit has no hosted service, proxy, control plane, filesystem storage, or environment-variable mutation.

## Requirements

- Node.js `^22.13.0`, `^24.0.0`, or `^26.0.0`
- ESM or a Node version that can synchronously `require()` ESM

## Install

```sh
npm install secrets-kit
```

All three official provider SDKs are included. You do not need a separate provider package.

The package exposes named root exports only. It has no default export or public provider subpath.

## Quick start

```js
import { aws, createSecretsKit } from "secrets-kit"

const secrets = createSecretsKit({
  sources: [
    {
      id: "primary",
      provider: aws({ region: "eu-north-1" }),
    },
  ],
  secrets: {
    DATABASE_URL: {
      source: "primary",
      sourceId: "production/database",
      field: "url",
    },
  },
})

try {
  const databaseUrl = await secrets.get("DATABASE_URL")
  // Use the value without logging it.
} finally {
  await secrets.close()
}
```

`createSecretsKit()` validates configuration synchronously. Provider SDK loading, client creation, authentication, project discovery, and remote reads remain lazy until the first `get()` or `getBytes()` call.

## Configuration

```ts
createSecretsKit({
  sources,
  secrets,
  cache?,
  onBackgroundError?,
})
```

- `sources` is a non-empty array of `{ id, provider }` entries. IDs are exact, case-sensitive strings and must be unique.
- `secrets` maps application-owned logical names to `{ source, sourceId, field?, cache? }` definitions.
- `cache` optionally enables process-memory TTL caching globally.
- `onBackgroundError(error)` optionally receives refresh-ahead failures. Exceptions thrown by this callback are swallowed.

Unknown configuration properties are rejected. Inputs are copied and normalized without being mutated or frozen. Reads are allowed only for logical names declared in `secrets`; there is no arbitrary provider-ID read method.

### Secret definitions

```js
secrets: {
  DATABASE_URL: {
    source: "primary",
    sourceId: "production/database",
    field: "url",
    cache: {
      ttlMs: 60_000,
      refreshAheadMs: 10_000,
    },
  },
}
```

- `source` references a configured source ID.
- `sourceId` is interpreted by that provider and is never included in sanitized public error messages.
- `field` selects one exact, immediate JSON property. The secret must be valid UTF-8 JSON containing an object, and the selected value must be a string. Dotted paths are not traversed.
- `cache` completely replaces the global policy for that secret. Set it to `false` to disable caching.

Empty secret values are valid. Secrets Kit never performs implicit Base64 encoding or decoding.

## Provider factories

### `aws(options?)`

Creates an AWS Secrets Manager source. Reads always request the `AWSCURRENT` value. `sourceId` may be a secret name or ARN.

```js
import { aws } from "secrets-kit"

aws()
aws({ region: "eu-north-1" })
```

These forms use the AWS SDK's native region and default credential resolution. Workload identity, attached roles, and other provider-native mechanisms are preferred.

For advanced configuration, inject the official aggregated `SecretsManager` client. The injected client must expose `getSecretValue()`; it is never destroyed by Secrets Kit, and using it does not load the AWS package through the adapter.

```js
import { SecretsManager } from "@aws-sdk/client-secrets-manager"
import { aws } from "secrets-kit"

const client = new SecretsManager({
  endpoint: "http://127.0.0.1:4566",
  region: "eu-north-1",
})

const provider = aws({ client })
```

`client` and `region` are mutually exclusive. The application owns an injected client and must destroy it when appropriate.

### `gcp(options?)`

Creates a Google Cloud Secret Manager source. Reads always request the `latest` version. `sourceId` is a secret ID.

```js
import { gcp } from "secrets-kit"

gcp()
gcp({ projectId: "example-project" })
gcp({ projectId: "example-project", location: "europe-north1" })
```

Authentication uses Application Default Credentials. When `projectId` is omitted, the official client resolves it lazily. A `location` selects a regional secret, changes the resource name, and configures the official regional endpoint.

An injected official `SecretManagerServiceClient` can supply advanced credentials, endpoints, retries, or transports:

```js
import { SecretManagerServiceClient } from "@google-cloud/secret-manager"
import { gcp } from "secrets-kit"

const location = "europe-north1"
const client = new SecretManagerServiceClient({
  apiEndpoint: `secretmanager.${location}.rep.googleapis.com`,
})

const provider = gcp({ client, location, projectId: "example-project" })
```

For regional secrets, an injected client's `apiEndpoint` must match the configured location. Injected clients are never closed by Secrets Kit.

### `infisical(options)`

Creates an Infisical source. Reads always use the current value. Imported secrets and secret-reference expansion are disabled.

Universal Auth is the first-class authentication method:

```js
import { infisical } from "secrets-kit"

const provider = infisical({
  projectId: "project-id",
  environment: "prod",
  secretPath: "/database",
  auth: {
    clientId: process.env.INFISICAL_CLIENT_ID,
    clientSecret: process.env.INFISICAL_CLIENT_SECRET,
  },
})
```

- `projectId` and `environment` are required.
- `secretPath` defaults to `/`.
- `siteUrl` defaults to `https://app.infisical.com`.
- `siteUrl` must use HTTPS, except that HTTP is accepted for loopback development URLs.
- Login, renewal, and reauthentication are request-driven and coalesced; Secrets Kit creates no proactive authentication timer.

Other official authentication methods use an already authenticated injected `InfisicalSDK` client:

```js
const provider = infisical({
  projectId: "project-id",
  environment: "prod",
  client: authenticatedInfisicalClient,
})
```

`auth` and `client` are mutually exclusive. Injected clients are never authenticated, renewed, or closed by Secrets Kit.

## Instance methods

### `get(name, options?)`

```ts
get(name, { signal? }): Promise<string>
```

Returns the complete secret as text, or the configured `field`. Native bytes must be strict UTF-8; invalid byte sequences reject with `SecretInvalidValueError`.

The optional `AbortSignal` stops only that caller's wait. It does not cancel a provider request shared by other callers.

```js
const controller = new AbortController()
const value = await secrets.get("API_TOKEN", { signal: controller.signal })
```

TypeScript and JSDoc-aware editors infer declared logical names and report literal typos. JavaScript and TypeScript both enforce the allowlist at runtime with `SecretDefinitionNotFoundError`.

### `getBytes(name, options?)`

```ts
getBytes(name, { signal? }): Promise<Uint8Array>
```

Returns a new caller-owned byte array. Native text is encoded as UTF-8. Cached or SDK-owned mutable buffers are never returned directly.

### `invalidate(name?)`

```ts
invalidate(name?): void
```

With a logical name, evicts that entry and every cached alias backed by the same `(source, sourceId)`. With no argument, clears the complete cache.

A provider request that began before invalidation may finish for its waiting caller, but its result cannot repopulate the invalidated cache generation.

### `close()`

```ts
close(): Promise<void>
```

Stops new reads immediately, waits for active provider reads and refreshes, clears cached values, and closes only provider clients created internally by Secrets Kit. It never closes injected clients. Calling `close()` more than once returns the same promise.

Operations after closing fail with `SecretsKitClosedError`.

## Caching and concurrency

Caching is disabled by default. Enable it globally or per secret:

```js
cache: {
  ttlMs: 60_000,
  refreshAheadMs: 10_000,
}
```

- `ttlMs` is a positive integer.
- `refreshAheadMs` defaults to `0`, must be non-negative, and must be less than `ttlMs`.
- Cached values exist only in this process and are never persisted or serialized.
- Errors and missing values are not cached.
- Expired values are never served as a stale fallback.
- Concurrent reads for the same `(source, sourceId)` share one provider request even when caching is disabled.

Refresh-ahead is triggered by a read. Inside the refresh window, the still-valid value returns immediately while one background refresh begins. A failed refresh is reported to `onBackgroundError`; the old value remains usable only until its original expiry.

## Errors

Every intentional failure is a concrete error extending `SecretsKitError` with a stable `code`:

| Error                           | Code                          |
| ------------------------------- | ----------------------------- |
| `SecretsKitConfigurationError`  | `SECRETS_KIT_CONFIGURATION`   |
| `SecretsKitClosedError`         | `SECRETS_KIT_CLOSED`          |
| `SecretDefinitionNotFoundError` | `SECRET_DEFINITION_NOT_FOUND` |
| `SecretNotFoundError`           | `SECRET_NOT_FOUND`            |
| `SecretAuthenticationError`     | `SECRET_AUTHENTICATION`       |
| `SecretAccessDeniedError`       | `SECRET_ACCESS_DENIED`        |
| `SecretRateLimitError`          | `SECRET_RATE_LIMIT`           |
| `SecretReadAbortedError`        | `SECRET_READ_ABORTED`         |
| `SecretInvalidValueError`       | `SECRET_INVALID_VALUE`        |
| `SecretProviderError`           | `SECRET_PROVIDER`             |

```js
import { SecretNotFoundError } from "secrets-kit"

try {
  await secrets.get("API_TOKEN")
} catch (error) {
  if (error instanceof SecretNotFoundError) {
    // Handle the missing declaration's remote value without logging the error cause.
  }
}
```

Public messages and enumerable fields contain only sanitized context. The original provider failure is available as the non-enumerable `cause`; explicitly inspecting or logging `cause` may expose provider metadata or secret locators.

The error exports are callable factory functions, not class declarations:

```ts
SecretProviderError(message, options?): SecretProviderError
```

Every error in the table follows that signature and supports `instanceof`. `options` may contain `cause` and sanitized context fields such as `secretName`, `source`, `provider`, `providerCode`, `requestId`, and `retryable`. Applications normally consume these factories only as `instanceof` targets; adapters use them to create domain errors.

## Security boundaries

Secrets Kit reduces its own trust boundary, but it cannot protect an application whose process, provider identity, IAM policy, dependencies, or runtime memory are compromised.

In particular, it does not claim secure JavaScript memory erasure, protection after a value is returned to application code, correction of overbroad provider permissions, or equivalence between static credentials and workload identity.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the repository workflow, architecture, tests, generated artifacts, and provider contribution checklist.

## License

MIT
