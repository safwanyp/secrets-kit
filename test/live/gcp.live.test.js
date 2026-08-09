import { describe, expect, it } from "vitest"

import { createSecretsKit, gcp } from "../../src/index.js"
import { assertExpectedSecret, requiredEnvironment } from "./helpers.js"

describe.runIf(process.env.SECRETS_KIT_LIVE_GCP === "1")("GCP live smoke", () => {
  it("reads the expected latest secret value", async () => {
    const sourceId = requiredEnvironment("SECRETS_KIT_GCP_SECRET_ID")
    const expected = requiredEnvironment("SECRETS_KIT_GCP_EXPECTED_VALUE")
    const projectId = process.env.SECRETS_KIT_GCP_PROJECT_ID
    const location = process.env.SECRETS_KIT_GCP_LOCATION
    const secrets = createSecretsKit({
      secrets: { LIVE_VALUE: { source: "gcp", sourceId } },
      sources: [
        {
          id: "gcp",
          provider: gcp({
            ...(location === undefined ? {} : { location }),
            ...(projectId === undefined ? {} : { projectId }),
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
