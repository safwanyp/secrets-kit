# Releasing Secrets Kit

Release Please owns every version, changelog, tag, and GitHub release. npm publication uses Trusted Publishing with GitHub Actions OIDC; no long-lived npm publish token belongs in this repository.

Pushes to `main` only create or update the reviewable Release Please PR. They never create a tag, GitHub release, or npm publication. After that PR is merged, one manual Release workflow run performs the complete release.

## One-time repository setup

1. Configure `secrets-kit` on npm with this repository and `release.yml` as its GitHub trusted publisher. Leave the optional environment field empty and allow `npm publish`.
2. Add a fine-grained GitHub token named `RELEASE_PLEASE_TOKEN`. Restrict it to this repository with read/write access to contents, issues, and pull requests. Release Please uses it only to open or update the release PR so GitHub runs the normal PR checks; it is not an npm credential.
3. Keep token publishing enabled only until the first OIDC publication is verified. Then restrict traditional npm token publication and revoke any old npm automation token.
4. Protect `main` and require the CI matrix and Conventional Commits job.

npm Trusted Publishing requires `id-token: write`, a cloud-hosted GitHub runner, npm CLI `11.5.1` or newer, and Node.js `22.14.0` or newer. The release job uses the repository-pinned Node `24.16.0` toolchain. npm creates provenance automatically for a public package published from a public repository through OIDC.

## Release flow

1. Merge conventional commits into `main` only after review and green CI.
2. The Prepare release workflow automatically opens or updates a release PR containing the proposed version and changelog. It cannot tag or publish.
3. Review and merge the release PR. The merge still does not tag or publish anything.
4. From the GitHub Actions page, run the Release workflow once on `main`.
5. That one run creates the version tag and GitHub release, checks out the tag, installs from the frozen lockfile, runs the complete quality gate, and publishes through npm OIDC.
6. Confirm the npm version and provenance record before considering the release complete.

Do not manually edit versions or changelogs, create release tags, publish from a workstation, or add an npm publish token.
