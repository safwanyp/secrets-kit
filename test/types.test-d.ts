import {
  aws,
  createSecretsKit,
  type AwsOptions,
  type ProviderDescriptor,
  type SecretsKit,
} from "secrets-kit"

declare const provider: ProviderDescriptor
declare const awsClient: import("@aws-sdk/client-secrets-manager").SecretsManager

const awsOptions: AwsOptions = { client: awsClient }
void aws(awsOptions)

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
