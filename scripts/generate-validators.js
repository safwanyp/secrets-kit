import { mkdir, writeFile } from "node:fs/promises"

import {
  createValidatorDeclarationSource,
  createValidatorSource,
} from "./lib/generate-artifacts.js"

const outputDirectory = new URL("../generated/", import.meta.url)

async function main() {
  await mkdir(outputDirectory, { recursive: true })
  await Promise.all([
    writeFile(new URL("validate-config.js", outputDirectory), await createValidatorSource()),
    writeFile(new URL("validate-config.d.ts", outputDirectory), createValidatorDeclarationSource()),
  ])
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
