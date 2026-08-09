# Secrets Kit v0.1 Design

Status: accepted

This document records the shared design decisions for Secrets Kit v0.1. It is the reference contract for implementation. Changes to these decisions should be made deliberately and reflected here.

## Purpose

Secrets Kit is a read-only Node.js SDK that gives applications one API for retrieving secrets declared in a supported provider.

The first release supports:

- AWS Secrets Manager
- Google Cloud Secret Manager
- Infisical

Secrets Kit runs entirely inside the consuming application. It has no hosted proxy or control plane, and secret values never pass through infrastructure operated by Secrets Kit.

## Scope

v0.1 supports runtime reads only. It does not provide:

- Secret creation, updates, deletion, or rotation
- Cross-provider synchronization
- Secret discovery or listing
- Historical or explicitly pinned secret versions
- Environment-variable injection or mutation of `process.env`
- Arbitrary reads using runtime-supplied provider identifiers
- Custom or third-party provider adapters
- A CLI, hosted service, or control plane

Each adapter reads the provider's current value internally:

- AWS uses `AWSCURRENT`.
- GCP uses `latest`.
- Infisical uses its current value.

Version selection may be added later if there is demonstrated demand.

## Public API

The package uses named root exports only. There is no default export and no public provider subpath.

```js
import {
  createSecretsKit,
  aws,
  gcp,
  infisical,
} from "secrets-kit"

const secrets = createSecretsKit({
  sources: [
    {
      id: "primary",
      provider: aws({
        region: "eu-north-1",
      }),
    },
  ],
  cache: {
    ttlMs: 60_000,
    refreshAheadMs: 10_000,
  },
  secrets: {
    DATABASE_URL: {
      source: "primary",
      sourceId: "production/database",
      field: "url",
    },
  },
  onBackgroundError(error) {
    // Forward to application-owned telemetry if desired.
  },
})

const databaseUrl = await secrets.get("DATABASE_URL")

await secrets.close()
```

The instance API is:

```ts
get(name, options?): Promise<string>
getBytes(name, options?): Promise<Uint8Array>
invalidate(name?): void
close(): Promise<void>
```

Read options support an optional `AbortSignal`:

```js
await secrets.get("DATABASE_URL", { signal })
```

The signal cancels that caller's wait. It does not cancel an underlying provider request that is shared with other callers.

`createSecretsKit()` is synchronous. It validates and normalizes local configuration but does not authenticate, initialize provider clients, perform network requests, or confirm that remote secrets exist.

## Configuration model

### Sources

Sources are an array of named provider instances:

```js
sources: [
  {
    id: "primary",
    provider: aws({ region: "eu-north-1" }),
  },
  {
    id: "analytics",
    provider: gcp({ projectId: "example-project" }),
  },
]
```

Using named sources permits multiple accounts, regions, projects, environments, or instances of the same provider in one Secrets Kit instance.

Provider factories return frozen, opaque descriptors. Sensitive configuration, credentials, and injected clients must not appear in enumerable properties, JSON serialization, or normal Node inspection output.

### Secret definitions

Application code uses logical names. Each logical name maps to a source and the identifier of a secret within that source:

```js
secrets: {
  DATABASE_URL: {
    source: "primary",
    sourceId: "production/database",
    field: "url",
  },
}
```

- `source` references a value from `sources[].id`.
- `sourceId` identifies the remote secret within that source.
- `field` optionally extracts one immediate property from a JSON object.
- `cache` optionally replaces the global cache policy for this definition or disables caching with `false`.

The core treats `sourceId` as opaque. Each adapter interprets it according to its provider:

- AWS accepts a secret name or ARN.
- GCP combines a secret ID with the source's project and optional location.
- Infisical combines a secret name with the source's project, environment, and path.

Source IDs, logical secret names, and `sourceId` values are strings. Empty strings are invalid; no naming regex or stylistic convention is enforced. Matching is exact and case-sensitive, and values are not trimmed or normalized.

Reads are restricted to logical names declared at construction. There is no `getFrom(source, sourceId)` escape hatch. This makes the configuration an application-level allowlist in addition to the provider's authorization policy.

The declarations infer the known logical names so TypeScript and JSDoc-aware editors can report literal-name typos. Runtime validation remains mandatory, and JavaScript and TypeScript executions both throw `SecretDefinitionNotFoundError` for an unknown name.

### Field extraction

Without `field`, `get()` returns the complete secret payload as text.

With `field`, Secrets Kit:

1. Decodes the payload as strict UTF-8.
2. Parses it as JSON.
3. Requires a JSON object.
4. Selects an exact immediate property using the configured field name.
5. Requires the selected value to be a string.

`field` does not perform dotted or nested path traversal. Nested extraction and JSON Pointer support are outside v0.1.

## Value contract

- `get()` returns a string.
- `getBytes()` returns a new `Uint8Array` owned by the caller.
- Native text is encoded as UTF-8 for `getBytes()`.
- Native bytes are decoded as strict UTF-8 for `get()`.
- Invalid UTF-8 throws `SecretInvalidValueError`.
- Secrets Kit performs no implicit Base64 encoding or decoding.
- Empty secret values remain valid values.

`getBytes()` never returns a mutable array held by the cache.

## Provider adapters

Provider SDKs are loaded dynamically on the first remote read. Provider modules must not import their official SDK at module evaluation time. Concurrent first reads coalesce SDK loading and client creation. Supplying an injected client avoids loading that provider SDK through Secrets Kit at runtime.

All official provider SDKs are regular package dependencies to preserve one-command installation. They are therefore installed even when unused, although unused adapters and SDKs are not evaluated by plain Node and may be removed by downstream bundlers.

### Authentication policy

- Prefer each provider's workload identity or default credential chain.
- Support other official authentication mechanisms only within that provider's adapter.
- Do not create a universal credential object.
- Do not silently downgrade from workload identity to static credentials.
- Permit an injected, already configured official client as the advanced escape hatch.
- Never log or serialize credentials.

### AWS Secrets Manager

Supported factory forms:

```js
aws()
aws({ region: "eu-north-1" })
aws({ client })
```

- `aws()` uses AWS's native region and credential resolution.
- `region` and `client` are mutually exclusive.
- Advanced credentials, assumed roles, endpoints, proxies, retries, and LocalStack configuration use an injected official client.
- An internally created client is lazy and owned by Secrets Kit.
- An injected client is never destroyed by Secrets Kit.

### Google Cloud Secret Manager

Supported factory forms:

```js
gcp()
gcp({ projectId: "example-project" })
gcp({
  projectId: "example-project",
  location: "europe-north1",
})
gcp({
  client,
  projectId: "example-project",
  location: "europe-north1",
})
```

- Authentication uses Application Default Credentials unless an official client is injected.
- `projectId` is resolved lazily through the client when omitted.
- Both global and regional secrets are supported.
- GCP's term is `location`, not `region`.
- For internally created regional clients, Secrets Kit configures the regional endpoint.
- An injected regional client must already target the matching endpoint.
- Injected clients are never closed by Secrets Kit.

### Infisical

Supported Universal Auth form:

```js
infisical({
  projectId: "project-id",
  environment: "prod",
  secretPath: "/database",
  siteUrl: "https://app.infisical.com",
  auth: {
    clientId: process.env.INFISICAL_CLIENT_ID,
    clientSecret: process.env.INFISICAL_CLIENT_SECRET,
  },
})
```

Supported advanced form:

```js
infisical({
  projectId: "project-id",
  environment: "prod",
  client: authenticatedInfisicalClient,
})
```

- `projectId` and `environment` are required source context.
- `secretPath` defaults to `/`.
- `siteUrl` defaults to Infisical Cloud.
- `siteUrl` requires HTTPS except for loopback HTTP used in local development.
- `auth` and `client` are mutually exclusive.
- v0.1 provides first-class Universal Auth only.
- Other Infisical authentication methods use an injected, already authenticated official client.
- Injected clients are never closed or reauthenticated by Secrets Kit.
- Universal Auth login is lazy.
- The adapter privately retains the client ID and secret for on-demand token renewal and reauthentication.
- Concurrent login and renewal attempts are coalesced.
- Authentication uses no background timers.
- Credential references are dropped on `close()` without making memory-zeroization claims.
- Imported secrets and secret-reference expansion are disabled in v0.1.

## Caching and concurrency

Caching is disabled by default. It is opt-in, process-memory-only, and TTL based.

```js
cache: {
  ttlMs: 60_000,
  refreshAheadMs: 10_000,
}
```

- `ttlMs` is a required positive integer.
- `refreshAheadMs` is an optional non-negative integer and defaults to `0`.
- `refreshAheadMs` must be less than `ttlMs`.
- Cache entries are never persisted, serialized, or shared between processes.
- Errors and missing values are never cached.
- Expired values are never returned as a stale fallback.

A per-secret cache object is a complete replacement policy, not a partial merge with the global policy:

```js
secrets: {
  ROTATING_TOKEN: {
    source: "primary",
    sourceId: "production/token",
    cache: {
      ttlMs: 5_000,
      refreshAheadMs: 1_000,
    },
  },
  UNCACHED_VALUE: {
    source: "primary",
    sourceId: "production/uncached",
    cache: false,
  },
}
```

Per-secret cache configuration may enable caching even when there is no global policy.

### Refresh-ahead

Refresh-ahead is request triggered and uses no proactive timers.

For a 60-second TTL and 10-second refresh window:

- Before 50 seconds, return the cached value.
- From 50 to 60 seconds, return the still-valid value and start one coalesced background refresh.
- If the refresh succeeds, the TTL restarts from successful completion.
- If it fails, retain the previous value only until its original expiry.
- Once expired, the next caller blocks on a provider read and receives an error if that read fails.

An optional `onBackgroundError(error)` callback receives refresh-ahead failures. Secrets Kit never writes to `console` and exposes no general logger. Errors thrown by the callback are swallowed to prevent unhandled rejections or process crashes.

### Request coalescing

- Concurrent reads share an in-flight request even when value caching is disabled.
- Simultaneous reads of different logical definitions sharing the same `(source, sourceId)` share the provider request.
- After the provider response, each logical definition applies its own field extraction and cache policy.
- Aborting one caller does not cancel a provider request required by other callers.

### Invalidation

```js
secrets.invalidate("DATABASE_URL")
secrets.invalidate()
```

- Named invalidation evicts every cached logical value backed by the same `(source, sourceId)`.
- Calling without a name clears the complete cache.
- A request that began before invalidation may finish, but its result must not repopulate the invalidated cache generation.

Cache entries are dropped on expiry, replacement, invalidation, or close. Secrets Kit does not promise secure memory zeroization; JavaScript strings, SDK-owned buffers, runtime copies, and garbage-collected memory cannot be reliably wiped.

The cache is a small internal `Map`, not a generic cache dependency.

## Lifecycle

`close()`:

- Stops accepting new reads immediately.
- Waits for active provider reads and background refreshes to settle.
- Clears cached values.
- Closes only clients created internally by Secrets Kit.
- Never closes injected clients.
- Is safe to call more than once.

Operations after close throw `SecretsKitClosedError`.

## Errors

Secrets Kit intentionally throws concrete domain errors extending `Error`; it does not deliberately throw bare `Error` instances.

Public hierarchy:

```text
SecretsKitError
|- SecretsKitConfigurationError
|- SecretsKitClosedError
|- SecretDefinitionNotFoundError
|- SecretNotFoundError
|- SecretAuthenticationError
|- SecretAccessDeniedError
|- SecretRateLimitError
|- SecretReadAbortedError
|- SecretInvalidValueError
`- SecretProviderError
```

Each error has a stable string `code`. `SecretProviderError` is the fallback for network failures, provider outages, and provider errors that do not map safely to a more specific category.

Error messages and enumerable fields may contain only sanitized context such as:

- Logical secret name
- Source ID
- Provider name
- Stable Secrets Kit error code
- Sanitized provider code, request ID, or retryable flag when available

They must not contain:

- Secret values
- Credentials or access tokens
- Provider secret locators
- Raw response bodies

The original provider error remains available as a non-enumerable `cause`. Documentation must warn that explicitly inspecting or logging `cause` may expose provider metadata.

## Validation and declarations

Configuration is described with JSON Schema Draft-07 and validated using AJV-generated standalone validators.

Validation policy:

- AJV strict mode
- Unknown properties rejected
- No type coercion
- No removal of additional properties
- All issues collected into one `SecretsKitConfigurationError`
- No mutation of caller-owned configuration
- Defaults applied only while constructing an internal normalized copy

`createSecretsKit()` snapshots and freezes its internal normalized configuration. Later mutations to caller-owned arrays or objects have no effect. Caller-owned objects are never frozen or modified. Injected clients remain referenced objects.

Validators are compiled ahead of time. Runtime code imports generated validation functions and performs no schema compilation. Generated validators and declarations are committed, and CI fails when regeneration produces a diff.

Use the author's published `json-schema-to-dts` package, not the user's fork.

Schema-generated declarations are authoritative for JSON-compatible data configuration. Handwritten `.d.ts` files define executable runtime contracts, injected-client types, generic name inference, instance types, and error classes.

Public type-only exports include:

- `SecretsKit`
- `SecretsKitConfig`
- `CachePolicy`
- `SecretDefinition`
- Provider option types
- `BackgroundErrorHandler`
- `SecretsKitErrorCode`

Production code is plain JavaScript using JSDoc `@import` and `@type` references to generated and handwritten declarations.

## Package and runtime

- Package name: `secrets-kit`
- License: MIT
- Module format: ESM only
- No top-level `await`
- No CommonJS build
- No bundling or transpilation
- Ship modular source files as written
- Mark the package as side-effect free
- Test both `import("secrets-kit")` and `require("secrets-kit")`

Supported Node engines:

```json
{
  "node": "^22.13.0 || ^24.0.0 || ^26.0.0"
}
```

Repository toolchain pins:

```json
{
  "packageManager": "pnpm@11.5.2",
  "volta": {
    "node": "24.16.0",
    "pnpm": "11.5.2"
  }
}
```

Supported Node majors must be updated deliberately as the Node release schedule changes.

## Tooling policy

Every tool invocation must go through a dedicated `package.json` script. Each script explicitly names the committed configuration file for the underlying tool.

Developers, Git hooks, documentation, composite scripts, and CI call `pnpm run <script>`. They do not invoke Oxfmt, Oxlint, TypeScript, Vitest, Commitlint, schema generation, or other project tools directly.

Tool ownership:

- Oxfmt formats files.
- Oxlint performs linting, including relevant JSDoc, import, and Vitest rules.
- TypeScript performs authoritative `allowJs`/`checkJs` type checking without emitting files.
- Vitest runs behavior and integration tests.

Oxfmt and Oxlint are always given their explicit configuration paths in their package scripts. TypeScript and Vitest likewise use explicit project/configuration paths.

Tests use injected stub clients rather than `vi.mock()` or module interception. `vi.fn()` is permitted for call observation.

## Testing and CI

Fast tests cover:

- Core configuration and validation
- String and byte conversion
- Immediate-field extraction
- Cache expiry and refresh-ahead
- Request coalescing
- Invalidation races and aliases
- Abort behavior
- Close and ownership behavior
- Provider request construction
- Provider error translation
- Universal Auth login, renewal, and reauthentication
- Import and `require()` smoke behavior
- Published package contents
- Stale generated artifacts

Live smoke suites exercise real AWS, GCP, and Infisical services. They require explicit credentials and flags, never run automatically on contributor pull requests, and all three must pass before a release is published.

GitHub Actions runs on `ubuntu-latest` only. The Node matrix covers:

- Exact minimum Node `22.13.0`
- Latest supported Node 22
- Latest supported Node 24
- Latest supported Node 26

The release job uses the pinned Node 24 toolchain.

## Commits and releases

Commits follow Conventional Commits.

- Husky provides a local `commit-msg` hook.
- Commitlint uses the conventional configuration.
- Hooks and CI invoke Commitlint through package scripts.
- CI validates pull-request titles and commits because local hooks can be bypassed.
- Squash-merge titles must be valid Conventional Commits so Release Please can derive versions.

Release Please is the permanent semantic-versioning mechanism:

- `fix:` produces a patch.
- `feat:` produces a minor.
- `!` or `BREAKING CHANGE:` produces a major.
- A reviewable release PR carries version and changelog updates.
- Merging the release PR creates the version tag and GitHub release.

npm publication always uses Trusted Publishing with GitHub Actions OIDC:

- No long-lived npm publish token
- Automatic npm provenance
- Protected GitHub environment with manual approval
- Release workflow triggered manually from `main`; pushes never create or publish a release
- Publication only after required quality and live-provider checks
- Traditional token publishing restricted after OIDC is verified

This release model applies to every release, not only v0.1.

## Security model and limitations

Secrets Kit minimizes its trust boundary but cannot protect an application whose process, provider credentials, or runtime memory are compromised.

The SDK guarantees that its own code will:

- Keep secret values on the direct application-to-provider path
- Use official provider clients and native authentication mechanisms
- Avoid logging or serializing secret values and credentials
- Avoid global environment mutation
- Avoid filesystem persistence
- Restrict reads to declared logical mappings
- Validate configuration strictly
- Keep provider descriptors opaque
- Preserve provider authorization as the ultimate access-control boundary

The SDK does not claim to:

- Securely erase JavaScript memory
- Protect values after returning them to application code
- Correct overbroad provider IAM policies
- Make static credentials equivalent to workload identity
- Guarantee that a provider error's raw `cause` contains no sensitive metadata
- Eliminate the dependency and supply-chain cost of installing all supported provider SDKs
