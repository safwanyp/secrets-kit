import { execFile as execFileCallback } from "node:child_process"
import { mkdtemp, mkdir, readdir, rm, symlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"

const execFile = promisify(execFileCallback)
const requiredFiles = [
  "LICENSE",
  "README.md",
  "generated/validate-config.d.ts",
  "generated/validate-config.js",
  "package.json",
  "src/client.js",
  "src/config.js",
  "src/errors.js",
  "src/index.js",
  "src/provider.js",
  "src/providers/aws.js",
  "src/providers/gcp.js",
  "src/providers/infisical.js",
  "src/value.js",
  "types/generated-config.d.ts",
  "types/internal.d.ts",
  "types/public.d.ts",
]
const forbiddenPrefixes = ["docs/", "schema/", "scripts/", "test/"]

async function main() {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "secrets-kit-package-"))

  try {
    await execFile("pnpm", ["pack", "--pack-destination", temporaryDirectory])
    const archive = (await readdir(temporaryDirectory)).find((file) => file.endsWith(".tgz"))
    if (archive === undefined) throw new Error("pnpm pack did not create an archive")

    await execFile("tar", ["-xzf", join(temporaryDirectory, archive), "-C", temporaryDirectory])
    const packageDirectory = join(temporaryDirectory, "package")
    const files = await listFiles(packageDirectory)

    for (const file of requiredFiles) {
      if (!files.includes(file)) throw new Error(`Packed package is missing ${file}`)
    }
    const forbidden = files.find((file) =>
      forbiddenPrefixes.some((prefix) => file.startsWith(prefix)),
    )
    if (forbidden !== undefined) {
      throw new Error(`Packed package contains repository-only file ${forbidden}`)
    }

    const consumerDirectory = join(temporaryDirectory, "consumer")
    const packageLink = join(consumerDirectory, "node_modules", "secrets-kit")
    await mkdir(join(consumerDirectory, "node_modules"), { recursive: true })
    await symlink(packageDirectory, packageLink, "dir")
    await execFile(process.execPath, ["--input-type=module", "--eval", smokeSource], {
      cwd: consumerDirectory,
    })
  } finally {
    await rm(temporaryDirectory, { force: true, recursive: true })
  }
}

/**
 * @param {string} directory
 * @param {string} [prefix]
 * @returns {Promise<string[]>}
 */
async function listFiles(directory, prefix = "") {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(
    entries.map((entry) => {
      const relativePath = join(prefix, entry.name)
      return entry.isDirectory()
        ? listFiles(join(directory, entry.name), relativePath)
        : Promise.resolve([relativePath])
    }),
  )
  return files.flat().toSorted()
}

const smokeSource = `
  const expected = [
    "SecretAccessDeniedError",
    "SecretAuthenticationError",
    "SecretDefinitionNotFoundError",
    "SecretInvalidValueError",
    "SecretNotFoundError",
    "SecretProviderError",
    "SecretRateLimitError",
    "SecretReadAbortedError",
    "SecretsKitClosedError",
    "SecretsKitConfigurationError",
    "SecretsKitError",
    "aws",
    "createSecretsKit",
    "gcp",
    "infisical",
  ]
  const imported = await import("secrets-kit")
  const { createRequire } = await import("node:module")
  const require = createRequire(new URL("./entry.cjs", import.meta.url))
  const required = require("secrets-kit")
  for (const name of expected) {
    if (typeof imported[name] !== "function" || required[name] !== imported[name]) {
      throw new Error("Package export smoke test failed for " + name)
    }
  }
`

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
