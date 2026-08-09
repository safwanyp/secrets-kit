import { describe, expect, it } from "vitest"

import { createSecretsKit, infisical } from "../../src/index.js"
import { assertExpectedSecret, requiredEnvironment } from "./helpers.js"

describe.runIf(process.env.SECRETS_KIT_LIVE_INFISICAL === "1")("Infisical live smoke", () => {
  it("reads the expected current secret value", async () => {
    const sourceId = requiredEnvironment("SECRETS_KIT_INFISICAL_SECRET_NAME")
    const expected = requiredEnvironment("SECRETS_KIT_INFISICAL_EXPECTED_VALUE")
    const projectId = requiredEnvironment("SECRETS_KIT_INFISICAL_PROJECT_ID")
    const environment = requiredEnvironment("SECRETS_KIT_INFISICAL_ENVIRONMENT")
    const clientId = requiredEnvironment("INFISICAL_CLIENT_ID")
    const clientSecret = requiredEnvironment("INFISICAL_CLIENT_SECRET")
    const secretPath = process.env.SECRETS_KIT_INFISICAL_SECRET_PATH
    const siteUrl = process.env.SECRETS_KIT_INFISICAL_SITE_URL
    const secrets = createSecretsKit({
      secrets: { LIVE_VALUE: { source: "infisical", sourceId } },
      sources: [
        {
          id: "infisical",
          provider: infisical({
            auth: { clientId, clientSecret },
            environment,
            projectId,
            ...(secretPath === undefined ? {} : { secretPath }),
            ...(siteUrl === undefined ? {} : { siteUrl }),
          }),
        },
      ],
    })

    try {
      expect(assertExpectedSecret(await secrets.get("LIVE_VALUE"), expected)).toBeUndefined()
    } finally {
      await secrets.close()
    }
  })
})
