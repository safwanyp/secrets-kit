import { readFile } from "node:fs/promises"

import {
  createConfigTypesSource,
  createValidatorDeclarationSource,
  createValidatorSource,
} from "./lib/generate-artifacts.js"

const artifacts = [
  {
    create: createValidatorSource,
    file: new URL("../generated/validate-config.js", import.meta.url),
  },
  {
    create: async () => createValidatorDeclarationSource(),
    file: new URL("../generated/validate-config.d.ts", import.meta.url),
  },
  {
    create: createConfigTypesSource,
    file: new URL("../types/generated-config.d.ts", import.meta.url),
  },
]

async function main() {
  const staleFiles = (
    await Promise.all(
      artifacts.map(async ({ create, file }) => {
        const [actual, expected] = await Promise.all([readFile(file, "utf8"), create()])
        return actual === expected ? undefined : file.pathname
      }),
    )
  ).filter((file) => file !== undefined)

  if (staleFiles.length > 0) {
    throw new Error(`Generated files are stale. Run pnpm run generate:\n${staleFiles.join("\n")}`)
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
