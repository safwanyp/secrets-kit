/** @import { ProviderRuntime, ProviderValue } from "../../types/internal.js" */

import { vi } from "vitest"

import { createProviderDescriptor } from "../../src/provider.js"

function noop() {}

/**
 * @param {(sourceId: string) => Promise<ProviderValue>} read
 * @param {() => Promise<void>} [close]
 */
export function createStubProvider(
  read,
  close = /** @type {() => Promise<void>} */ (vi.fn().mockResolvedValue(undefined)),
) {
  const createRuntime = vi.fn(() =>
    Promise.resolve(/** @type {ProviderRuntime} */ ({ close, read })),
  )
  return {
    close,
    createRuntime,
    descriptor: createProviderDescriptor({ createRuntime, name: "stub" }),
    read,
  }
}

/**
 * @template T
 */
export function createDeferred() {
  /** @type {(value: T | PromiseLike<T>) => void} */
  let resolve = noop
  /** @type {(reason?: unknown) => void} */
  let reject = noop
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

/**
 * @param {string} value
 * @returns {ProviderValue}
 */
export function text(value) {
  return { kind: "text", value }
}

/**
 * @param {number[]} value
 * @returns {ProviderValue}
 */
export function bytes(value) {
  return { kind: "bytes", value: new Uint8Array(value) }
}
