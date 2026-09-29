import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020, { type ErrorObject } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import type { OpportunityV2 } from "../generated/opportunity-v2";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const schema = JSON.parse(
  await readFile(join(root, "schema/opportunity-v2.schema.json"), "utf8"),
);
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validateSchema = ajv.compile(schema);

// ISO 3166-1 alpha-2 codes. JSON Schema handles shape; runtime validation handles membership.
const COUNTRY_CODES = new Set(`AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW`.split(" "));

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateOpportunityV2(value: unknown): ValidationResult {
  const validShape = validateSchema(value);
  const errors = validShape
    ? []
    : (validateSchema.errors ?? []).map(
        (error: ErrorObject) => `${error.instancePath || "/"} ${error.message ?? "is invalid"}`,
      );
  if (value && typeof value === "object") {
    const record = value as Partial<OpportunityV2>;
    const countries = [
      ...(record.geography?.countries ?? []),
      ...(record.geography?.excludedCountries ?? []),
    ];
    for (const code of countries) {
      if (!COUNTRY_CODES.has(code)) errors.push(`/geography unknown country code '${code}'`);
    }
    const { opensAt, closesAt } = record.availability ?? {};
    if (opensAt && closesAt && opensAt > closesAt)
      errors.push("/availability opensAt must not be after closesAt");
    if (
      record.availability?.status === "open" &&
      closesAt &&
      new Date(closesAt).getTime() < Date.now()
    ) errors.push("/availability open listing has a deadline in the past");
  }
  return { valid: errors.length === 0, errors };
}

export const isOpportunityV2 = (value: unknown): value is OpportunityV2 =>
  validateOpportunityV2(value).valid;
