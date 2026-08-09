import { createSecretsKit, type ProviderDescriptor, type SecretsKit } from "secrets-kit"

declare const provider: ProviderDescriptor

const secrets = createSecretsKit({
  secrets: {
    DATABASE_URL: {
      source: "primary",
      sourceId: "database",
    },
  },
  sources: [{ id: "primary", provider }],
})

const typedSecrets: SecretsKit<"DATABASE_URL"> = secrets
void typedSecrets
void secrets.get("DATABASE_URL")

// @ts-expect-error Unknown logical names are rejected by the inferred API.
void secrets.get("UNKNOWN")
