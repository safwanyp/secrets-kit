import type { ValidateFunction } from "ajv"
import type { SecretsKitDataConfig } from "../types/generated-config.js"

declare const validate: ValidateFunction<SecretsKitDataConfig>

export { validate }
export default validate
