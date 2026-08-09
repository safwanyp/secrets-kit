import { describe, expect, it } from "vitest"

import { aws, createSecretsKit } from "../../src/index.js"
import { assertExpectedSecret, requiredEnvironment } from "./helpers.js"

describe.runIf(process.env.SECRETS_KIT_LIVE_AWS === "1")("AWS live smoke", () => {
  it("reads the expected current secret value", async () => {
    const sourceId = requiredEnvironment("SECRETS_KIT_AWS_SECRET_ID")
    const expected = requiredEnvironment("SECRETS_KIT_AWS_EXPECTED_VALUE")
    const region = process.env.SECRETS_KIT_AWS_REGION
    const secrets = createSecretsKit({
      secrets: { LIVE_VALUE: { source: "aws", sourceId } },
      sources: [
        {
          id: "aws",
          provider: aws(region === undefined ? {} : { region }),
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
