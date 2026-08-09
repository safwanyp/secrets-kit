import {
  aws,
  createSecretsKit,
  gcp,
  infisical,
  type AwsOptions,
  type GcpOptions,
  type InfisicalOptions,
  type ProviderDescriptor,
  type SecretsKit,
} from "secrets-kit"

declare const provider: ProviderDescriptor
declare const awsClient: import("@aws-sdk/client-secrets-manager").SecretsManager
declare const gcpClient: import("@google-cloud/secret-manager").SecretManagerServiceClient
declare const infisicalClient: import("@infisical/sdk").InfisicalSDK

const awsOptions: AwsOptions = { client: awsClient }
void aws(awsOptions)
const gcpOptions: GcpOptions = { client: gcpClient }
void gcp(gcpOptions)
const infisicalOptions: InfisicalOptions = {
  client: infisicalClient,
  environment: "prod",
  projectId: "project",
}
void infisical(infisicalOptions)

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
