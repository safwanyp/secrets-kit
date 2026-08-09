# Contributing to Secrets Kit

Thanks for helping keep Secrets Kit small, readable, and dependable.

The accepted behavior contract is [docs/design.md](./docs/design.md). Discuss changes to that contract before implementing them.

## Setup

The repository pins Node.js `24.16.0` and pnpm `11.5.2` through Volta metadata.

```sh
pnpm install
pnpm run check
```

Use the committed package scripts for every project tool. Do not invoke formatters, linters, TypeScript, Vitest, Commitlint, or generators directly.

## Useful scripts

| Script                    | Purpose                                                                      |
| ------------------------- | ---------------------------------------------------------------------------- |
| `pnpm run format`         | Format supported repository files with the committed Oxfmt config.           |
| `pnpm run format:check`   | Check formatting without writing.                                            |
| `pnpm run lint`           | Run Oxlint with the committed config.                                        |
| `pnpm run typecheck`      | Strictly check JavaScript, JSDoc, declarations, tests, and configs.          |
| `pnpm run test`           | Run fast behavior and adapter contract tests.                                |
| `pnpm run test:coverage`  | Run fast tests with the coverage gate.                                       |
| `pnpm run generate`       | Regenerate the standalone validator and schema-derived declarations.         |
| `pnpm run generate:check` | Fail when committed generated artifacts are stale.                           |
| `pnpm run test:package`   | Pack the package and test its contents, ESM import, and synchronous require. |
| `pnpm run publint`        | Validate package metadata and declarations.                                  |
| `pnpm run check`          | Run the complete local release-quality check.                                |

## Structure

```text
generated/       committed standalone runtime validators
schema/          JSON Schema Draft-07 configuration source
scripts/         generation and package verification scripts
src/             plain JavaScript implementation
src/providers/   one small module per provider adapter
test/            fast tests using explicit injected stubs
test/live/       explicitly enabled real-provider smoke tests
types/           handwritten and generated declarations
```

Production code is plain JavaScript. Public types live in `types/public.d.ts`; internal functions and helpers must have JSDoc or declaration-backed types. Do not define classes. Prefer small factory functions and direct data flow.

## Tests

Use injected stub clients rather than module interception or `vi.mock()`. `vi.fn()` is fine for observing calls.

Tests should cover behavior through the public `createSecretsKit()` API unless a narrow internal seam is necessary to verify lazy SDK loading or client ownership.

### Live provider tests

Live suites require both an explicit enable flag and dedicated fixture credentials. They compare the returned value without printing it.

AWS:

```text
SECRETS_KIT_LIVE_AWS=1
SECRETS_KIT_AWS_SECRET_ID
SECRETS_KIT_AWS_EXPECTED_VALUE
SECRETS_KIT_AWS_REGION (optional)
```

GCP:

```text
SECRETS_KIT_LIVE_GCP=1
SECRETS_KIT_GCP_SECRET_ID
SECRETS_KIT_GCP_EXPECTED_VALUE
SECRETS_KIT_GCP_PROJECT_ID (optional)
SECRETS_KIT_GCP_LOCATION (optional)
```

Infisical:

```text
SECRETS_KIT_LIVE_INFISICAL=1
SECRETS_KIT_INFISICAL_SECRET_NAME
SECRETS_KIT_INFISICAL_EXPECTED_VALUE
SECRETS_KIT_INFISICAL_PROJECT_ID
SECRETS_KIT_INFISICAL_ENVIRONMENT
INFISICAL_CLIENT_ID
INFISICAL_CLIENT_SECRET
SECRETS_KIT_INFISICAL_SECRET_PATH (optional)
SECRETS_KIT_INFISICAL_SITE_URL (optional)
```

Run only the provider you configured:

```sh
pnpm run test:live:aws
pnpm run test:live:gcp
pnpm run test:live:infisical
```

## Generated files

Edit `schema/config.schema.json`, then run `pnpm run generate`. Commit the schema and generated artifacts together. CI runs `pnpm run generate:check` to reject drift.

The schema-derived declarations are authoritative for JSON-compatible configuration. Keep executable contracts, injected client types, generics, and domain errors in the handwritten declaration file.

## Adding or changing a provider

A provider contribution should:

1. Return a frozen opaque descriptor through the internal descriptor factory.
2. Dynamically load its official SDK only when the first remote read needs it.
3. Avoid loading that SDK through Secrets Kit when an authenticated client is injected.
4. Prefer provider-native default or workload authentication and avoid universal credential abstractions.
5. Never close, authenticate, renew, inspect, or serialize an injected client beyond the documented read interface.
6. Read only the provider's current value and keep provider locators out of public errors.
7. Map known failures to sanitized Secrets Kit domain errors while preserving the original non-enumerable cause.
8. Add public declarations, explicit-stub contract tests, a gated live smoke test, and README usage.

Do not add writes, rotation, listing, discovery, environment mutation, arbitrary source-ID reads, or a public custom-adapter API without first changing the accepted design.

## Commits and pull requests

Keep commits atomic: one change and just that change. Use Conventional Commits, for example:

```text
feat: add provider adapter
fix: preserve invalidation generation
docs: clarify injected client ownership
```

Pull-request titles and commits must satisfy Commitlint. Avoid unrelated formatting or generated-file churn.
