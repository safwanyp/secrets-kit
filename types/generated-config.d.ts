// Generated from schema/config.schema.json. Do not edit directly.

/**
 * SecretsKitDataConfig
 *
 * The JSON-compatible structure of a Secrets Kit configuration.
 */
export type SecretsKitDataConfig = {
    sources: ({
        id: string;
        provider: unknown;
    })[];
    secrets: {
        [additionalProperties: string]: SecretDefinition;
    };
    cache?: CachePolicy;
    onBackgroundError?: unknown;
};
/**
 * SecretDefinition
 *
 * A declared mapping from a logical name to one provider secret.
 */
export type SecretDefinition = {
    source: string;
    sourceId: string;
    field?: string;
    cache?: (CachePolicy | false);
};
/**
 * CachePolicy
 *
 * An in-memory TTL cache policy.
 */
export type CachePolicy = {
    /** How long a successful value remains valid, in milliseconds. */
    ttlMs: number;
    /** How long before expiry a read may trigger a background refresh. */
    refreshAheadMs?: number;
};
