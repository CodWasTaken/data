import assert from "node:assert/strict";
import test from "node:test";
import { migrateV1ToV2, type OpportunityV1 } from "../scripts/migrate-v1-to-v2";
import { validateOpportunityV2 } from "../scripts/schema-v2";

const legacy: OpportunityV1 = {
  id: "example-program",
  provider: "Example Foundation",
  title: "Example Program",
  category: "funding",
  subcategories: ["grants"],
  tags: ["research"],
  description: "A sufficiently detailed legacy description for migration testing.",
  eligibility: "Researchers affiliated with eligible institutions may apply.",
  value: "A grant of up to USD 10,000.",
  sourceUrl: "https://example.org/evidence",
  officialUrl: "https://example.org/program",
  status: "limited",
  submissionType: "maintainer",
  sponsor: false,
  reviewDate: "2026-07-18",
  regions: ["Poland", "Germany"],
};

test("v1 migration preserves identity, URLs, availability, geography, and benefit text", () => {
  const migrated = migrateV1ToV2(legacy);
  assert.equal(migrated.id, legacy.id);
  assert.equal(migrated.canonicalUrl, legacy.officialUrl);
  assert.equal(migrated.urls.evidenceUrls[0]?.url, legacy.sourceUrl);
  assert.equal(migrated.availability.status, "limited");
  assert.equal(migrated.migration?.legacyStatus, "limited");
  assert.deepEqual(migrated.migration?.legacyRegions, legacy.regions);
  assert.equal(migrated.costAndBenefit.benefitSummary, legacy.value);
  assert.equal(migrated.classification.reviewState, "needs-human-review");
  assert.equal(validateOpportunityV2(migrated).valid, true);
});

test("ambiguous active status and Global geography remain explicitly unresolved", () => {
  const migrated = migrateV1ToV2({ ...legacy, status: "active", regions: ["Global"] });
  assert.equal(migrated.availability.status, "unconfirmed");
  assert.equal(migrated.geography.global, null);
  assert.ok(migrated.migration?.unresolvedFields.includes("availability.status"));
  assert.ok(migrated.migration?.unresolvedFields.includes("geography.global"));
});

test("runtime validation rejects impossible date order and unknown country codes", () => {
  const migrated = migrateV1ToV2(legacy);
  migrated.geography.countries = ["ZZ"];
  migrated.availability.opensAt = "2027-02-01T00:00:00.000Z";
  migrated.availability.closesAt = "2027-01-01T00:00:00.000Z";
  const result = validateOpportunityV2(migrated);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("unknown country code")));
  assert.ok(result.errors.some((error) => error.includes("opensAt")));
});
