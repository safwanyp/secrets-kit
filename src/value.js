/** @import { ProviderValue } from "../types/internal.js" */

import { SecretInvalidValueError } from "./errors.js"

const decoder = new TextDecoder("utf-8", { fatal: true })
const encoder = new TextEncoder()

/**
 * @param {ProviderValue} value
 * @returns {ProviderValue}
 */
export function copyValue(value) {
  return value.kind === "bytes" ? { kind: "bytes", value: new Uint8Array(value.value) } : value
}

/**
 * @param {ProviderValue} value
 * @param {string} secretName
 * @returns {string}
 */
export function valueToString(value, secretName) {
  if (value.kind === "text") return value.value

  try {
    return decoder.decode(value.value)
  } catch (cause) {
    throw SecretInvalidValueError("Secret value is not valid UTF-8", {
      cause,
      secretName,
    })
  }
}

/**
 * @param {ProviderValue} value
 * @returns {Uint8Array}
 */
export function valueToBytes(value) {
  return value.kind === "bytes" ? new Uint8Array(value.value) : encoder.encode(value.value)
}

/**
 * @param {ProviderValue} value
 * @param {string | undefined} field
 * @param {string} secretName
 * @returns {ProviderValue}
 */
export function extractField(value, field, secretName) {
  if (field === undefined) return copyValue(value)

  const text = valueToString(value, secretName)
  /** @type {unknown} */
  let parsed

  try {
    parsed = JSON.parse(text)
  } catch (cause) {
    throw SecretInvalidValueError("Secret value is not valid JSON", {
      cause,
      secretName,
    })
  }

  const selected =
    typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? /** @type {Record<string, unknown>} */ (parsed)[field]
      : undefined

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed) ||
    !Object.hasOwn(parsed, field) ||
    typeof selected !== "string"
  ) {
    throw SecretInvalidValueError("Configured field must be an immediate JSON string property", {
      secretName,
    })
  }

  return {
    kind: "text",
    value: selected,
  }
}
