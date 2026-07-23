import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  correctGeneratedLimitedStatus,
} from "../scripts/correct-generated-statuses";
import type { OpportunityV1 } from "../scripts/migrate-v1-to-v2";

const fixture: OpportunityV1 = {
  id: "fixture",
  provider: "Fixture",
  title: "Fixture program",
  category: "funding",
  subcategories: ["grants"],
  tags: [],
  description: "A neutral factual description of the fixture program.",
  eligibility: "Applicants must meet the provider's criteria.",
  value: "Funding support",
  sourceUrl: "https://example.org/source",
  officialUrl: "https://example.org/program",
  status: "limited",
  submissionType: "maintainer",
  sponsor: false,
  reviewDate: "2026-07-18",
  regions: ["Global"],
};

test("generated limited status becomes unconfirmed without inventing availability", () => {
  const corrected = correctGeneratedLimitedStatus(fixture);
  assert.notEqual(corrected.schemaVersion, "2.0");
  assert.equal((corrected as OpportunityV1).status, "unconfirmed");
});

test("canonical records contain no generated limited defaults", async () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const files = (await readdir(join(root, "opportunities")))
    .filter((name) => name.endsWith(".json") && !name.startsWith("_"));
  let records = 0;
  for (const file of files) {
    const record = JSON.parse(
      await readFile(join(root, "opportunities", file), "utf8"),
    ) as Record<string, unknown>;
    records += 1;
    if (record.schemaVersion === "2.0") {
      const migration = record.migration as { legacyStatus?: unknown } | undefined;
      const availability = record.availability as { status?: unknown };
      if (migration?.legacyStatus === "limited") {
        assert.notEqual(availability.status, "limited", file);
      }
    } else {
      assert.notEqual(record.status, "limited", file);
    }
  }
  assert.equal(records, 1068);
});
