/** @import { ProviderDefinition } from "../types/internal.js" */
/** @import { ProviderDescriptor } from "../types/public.js" */

/** @type {WeakMap<ProviderDescriptor, ProviderDefinition>} */
const providerDefinitions = new WeakMap()

/**
 * Creates the opaque public value returned by a provider factory.
 *
 * @param {ProviderDefinition} definition
 * @returns {ProviderDescriptor}
 */
export function createProviderDescriptor(definition) {
  const descriptor = /** @type {ProviderDescriptor} */ (Object.create(null))
  providerDefinitions.set(descriptor, Object.freeze({ ...definition }))
  return Object.freeze(descriptor)
}

/**
 * @param {unknown} value
 * @returns {value is ProviderDescriptor}
 */
export function isProviderDescriptor(value) {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    providerDefinitions.has(/** @type {ProviderDescriptor} */ (value))
  )
}

/**
 * @param {ProviderDescriptor} descriptor
 * @returns {ProviderDefinition}
 */
export function getProviderDefinition(descriptor) {
  const definition = providerDefinitions.get(descriptor)
  if (definition === undefined) {
    throw new TypeError("Unknown provider descriptor")
  }
  return definition
}
