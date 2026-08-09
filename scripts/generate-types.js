import { mkdir, writeFile } from "node:fs/promises"

import { createConfigTypesSource } from "./lib/generate-artifacts.js"

const outputDirectory = new URL("../types/", import.meta.url)

async function main() {
  await mkdir(outputDirectory, { recursive: true })
  await writeFile(
    new URL("generated-config.d.ts", outputDirectory),
    await createConfigTypesSource(),
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
