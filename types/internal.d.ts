import type {
  BackgroundErrorHandler,
  CachePolicy,
  ProviderDescriptor,
  SecretDefinition,
  SecretsKitConfig,
} from "./public.js"

export type ProviderValue =
  | { readonly kind: "text"; readonly value: string }
  | { readonly kind: "bytes"; readonly value: Uint8Array }

export interface ProviderRuntime {
  read(sourceId: string): Promise<ProviderValue>
  close(): Promise<void>
}

export interface ProviderDefinition {
  readonly name: string
  createRuntime(): ProviderRuntime | Promise<ProviderRuntime>
}

export interface NormalizedCachePolicy {
  readonly ttlMs: number
  readonly refreshAheadMs: number
}

export interface NormalizedSource {
  readonly id: string
  readonly provider: ProviderDescriptor
  readonly providerDefinition: ProviderDefinition
}

export interface NormalizedSecretDefinition extends Omit<SecretDefinition, "cache"> {
  readonly cache?: NormalizedCachePolicy
}

export interface NormalizedConfig {
  readonly sources: readonly NormalizedSource[]
  readonly secrets: Readonly<Record<string, NormalizedSecretDefinition>>
  readonly onBackgroundError?: BackgroundErrorHandler
}

export interface CacheEntry {
  readonly value: ProviderValue
  readonly expiresAt: number
  readonly refreshAt: number
  readonly generation: number
}

export interface ReadOptions {
  readonly signal?: AbortSignal
}

export type RuntimePromiseMap = Map<ProviderDescriptor, Promise<ProviderRuntime>>

export type ConfigInput = SecretsKitConfig<Readonly<Record<string, SecretDefinition>>>

export type RawCachePolicy = CachePolicy | false | undefined
