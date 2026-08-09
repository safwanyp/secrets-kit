import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"

import { Parser } from "json-schema-to-dts"

const schemaUrl = new URL("../../schema/config.schema.json", import.meta.url)
const require = createRequire(import.meta.url)
const Ajv = /** @type {typeof import("ajv").default} */ (require("ajv"))
const standaloneCode = /** @type {typeof import("ajv/dist/standalone/index.js").default} */ (
  require("ajv/dist/standalone/index.js")
)

/**
 * @returns {Promise<import("ajv").SchemaObject>}
 */
async function readSchema() {
  const source = await readFile(schemaUrl, "utf8")
  return /** @type {import("ajv").SchemaObject} */ (JSON.parse(source))
}

/**
 * @returns {Promise<string>}
 */
export async function createValidatorSource() {
  const schema = await readSchema()
  const ajv = new Ajv({
    allErrors: true,
    code: {
      esm: true,
      source: true,
    },
    coerceTypes: false,
    removeAdditional: false,
    strict: true,
    useDefaults: false,
  })
  const validate = ajv.compile(schema)

  return standaloneCode(ajv, validate)
}

/**
 * @returns {Promise<string>}
 */
export async function createConfigTypesSource() {
  const schema = await readSchema()
  const parser = new Parser()
  parser.addSchema(
    /** @type {string} */ (schema.$id),
    /** @type {import("json-schema-to-dts").JSONSchema} */ (schema),
  )

  const result = parser.compile({
    anyType: "unknown",
    lifted: { isExported: true },
    omitIdComments: true,
    topLevel: { isExported: true },
  })

  if (result.diagnostics.length > 0) {
    const details = result.diagnostics
      .map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`)
      .join("\n")
    throw new Error(`Could not generate configuration types:\n${details}`)
  }

  return [
    "// Generated from schema/config.schema.json. Do not edit directly.",
    "",
    result.text,
  ].join("\n")
}

/**
 * @returns {string}
 */
export function createValidatorDeclarationSource() {
  return [
    'import type { ValidateFunction } from "ajv"',
    'import type { SecretsKitDataConfig } from "../types/generated-config.js"',
    "",
    "declare const validate: ValidateFunction<SecretsKitDataConfig>",
    "",
    "export { validate }",
    "export default validate",
    "",
  ].join("\n")
}
