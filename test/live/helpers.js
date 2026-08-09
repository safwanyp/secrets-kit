/**
 * @param {string} name
 * @returns {string}
 */
export function requiredEnvironment(name) {
  const value = process.env[name]
  if (value === undefined || value.length === 0) {
    throw new Error(`Required live-test environment variable is missing: ${name}`)
  }
  return value
}

/**
 * @param {string} actual
 * @param {string} expected
 * @returns {void}
 */
export function assertExpectedSecret(actual, expected) {
  if (actual !== expected) {
    throw new Error("Live provider returned an unexpected secret value")
  }
}
