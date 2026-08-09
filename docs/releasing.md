# Releasing Secrets Kit

Release Please owns every version, changelog, tag, and GitHub release. npm publication uses Trusted Publishing with GitHub Actions OIDC; no long-lived npm publish token belongs in this repository or its GitHub environment.

The release workflow is manual and must be run from `main`. A push or merge to `main` never starts it.

## One-time repository setup

1. Create a protected GitHub environment named `npm` and require manual approval.
2. Configure `secrets-kit` on npm with this repository, `.github/workflows/release.yml`, and the `npm` environment as its GitHub trusted publisher.
3. Keep token publishing enabled only until the first OIDC publication is verified. Then restrict traditional npm token publication and revoke any old automation token.
4. Protect `main` and require the CI matrix and Conventional Commits job.
5. Configure the live fixture identities and values below in the protected environment.

npm Trusted Publishing requires `id-token: write`, a cloud-hosted GitHub runner, npm CLI `11.5.1` or newer, and Node.js `22.14.0` or newer. The release job uses the repository-pinned Node `24.16.0` toolchain. npm creates provenance automatically for a public package published from a public repository through OIDC.

## Provider fixture authentication

Use dedicated read-only fixtures whose values are identical but non-production. Grant access only to the named fixture secret.

AWS uses GitHub OIDC to assume a narrowly scoped role:

| Kind     | Name                             |
| -------- | -------------------------------- |
| Secret   | `AWS_ROLE_TO_ASSUME`             |
| Variable | `SECRETS_KIT_AWS_REGION`         |
| Variable | `SECRETS_KIT_AWS_SECRET_ID`      |
| Secret   | `SECRETS_KIT_AWS_EXPECTED_VALUE` |

The AWS role trust policy must account for the GitHub `npm` environment in its subject claim.

Google Cloud uses Workload Identity Federation and service-account impersonation:

| Kind     | Name                             |
| -------- | -------------------------------- |
| Variable | `GCP_WORKLOAD_IDENTITY_PROVIDER` |
| Variable | `GCP_SERVICE_ACCOUNT`            |
| Variable | `SECRETS_KIT_GCP_PROJECT_ID`     |
| Variable | `SECRETS_KIT_GCP_LOCATION`       |
| Variable | `SECRETS_KIT_GCP_SECRET_ID`      |
| Secret   | `SECRETS_KIT_GCP_EXPECTED_VALUE` |

Leave `SECRETS_KIT_GCP_LOCATION` empty only for a global fixture.

Infisical uses a dedicated Universal Auth identity:

| Kind     | Name                                   |
| -------- | -------------------------------------- |
| Secret   | `INFISICAL_CLIENT_ID`                  |
| Secret   | `INFISICAL_CLIENT_SECRET`              |
| Variable | `SECRETS_KIT_INFISICAL_PROJECT_ID`     |
| Variable | `SECRETS_KIT_INFISICAL_ENVIRONMENT`    |
| Variable | `SECRETS_KIT_INFISICAL_SECRET_PATH`    |
| Variable | `SECRETS_KIT_INFISICAL_SECRET_NAME`    |
| Variable | `SECRETS_KIT_INFISICAL_SITE_URL`       |
| Secret   | `SECRETS_KIT_INFISICAL_EXPECTED_VALUE` |

For Infisical Cloud, `SECRETS_KIT_INFISICAL_SITE_URL` may be left empty to use the SDK default.

## Release flow

1. Merge conventional commits into `main` only after review and green CI.
2. From the GitHub Actions page, manually run the Release workflow on `main`. Release Please opens or updates a release PR containing the proposed version and changelog. This run does not publish anything.
3. Review and merge the release PR. The merge does not run the release workflow.
4. Manually run the Release workflow on `main` again. Release Please creates the version tag and GitHub release, then starts the protected `npm` job.
5. Approve the protected `npm` job.
6. The job checks out the release tag, installs from the frozen lockfile, runs the complete local gate, authenticates to AWS and GCP through workload identity, verifies all three live fixture values, and publishes through npm OIDC.
7. Confirm the npm version and provenance record before considering the release complete.

Do not manually edit versions or changelogs, create release tags, publish from a workstation, or add an npm publish token.
