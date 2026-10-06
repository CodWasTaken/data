import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type { OpportunityV2 } from "../generated/opportunity-v2";
import {
  applyStructuredFieldDecision,
  validateStructuredFieldManifest,
  type StructuredFieldManifest,
} from "../scripts/apply-structured-field-overrides";
import { validateOpportunityV2 } from "../scripts/schema-v2";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(
  await readFile(join(root, "editorial/structured-field-overrides.json"), "utf8"),
) as StructuredFieldManifest;

test("structured-field manifest is explicit, unique, and source-backed", () => {
  assert.doesNotThrow(() => validateStructuredFieldManifest(manifest));
  assert.equal(manifest.decisions.length, 14);
  assert.equal(new Set(manifest.decisions.map((decision) => decision.id)).size, 14);
  assert.match(manifest.methodology, /never constitute human editorial review/i);
  for (const decision of manifest.decisions) {
    assert.ok(decision.evidence.length > 0, decision.id);
    assert.ok(decision.confidence >= 0.9, decision.id);
  }
});

test("structured decisions validate without creating human-review provenance", async () => {
  for (const decision of manifest.decisions) {
    const raw = JSON.parse(
      await readFile(join(root, "opportunities", `${decision.id}.json`), "utf8"),
    ) as OpportunityV2;
    assert.equal(raw.schemaVersion, "2.0", decision.id);
    const applied = applyStructuredFieldDecision(raw, decision, manifest);
    assert.equal(validateOpportunityV2(applied).valid, true, decision.id);
    assert.equal(applied.classification.reviewState, "needs-human-review", decision.id);
    assert.equal(applied.reviewProvenance.reviewMethod, "automated-source-research", decision.id);
    assert.equal(applied.reviewProvenance.reviewedAt, null, decision.id);
    assert.equal(applied.reviewProvenance.reviewerReference, "automation:structured-field-research-v1", decision.id);
  }
});

test("resolved application and deadline fields remove only their matching migration gaps", async () => {
  const byId = new Map(manifest.decisions.map((decision) => [decision.id, decision]));
  const alchemist = JSON.parse(
    await readFile(join(root, "opportunities/alchemist-accelerator.json"), "utf8"),
  ) as OpportunityV2;
  const alchemistApplied = applyStructuredFieldDecision(alchemist, byId.get("alchemist-accelerator")!, manifest);
  assert.equal(alchemistApplied.urls.applicationUrl, "https://www.alchemistaccelerator.com/apply");
  assert.equal(alchemistApplied.availability.deadlineType, "rolling");
  assert.equal(alchemistApplied.migration?.unresolvedFields.includes("urls.applicationUrl"), false);
  assert.equal(alchemistApplied.migration?.unresolvedFields.includes("availability.deadlineType"), false);

  const embl = JSON.parse(
    await readFile(join(root, "opportunities/embl-visitor-programme.json"), "utf8"),
  ) as OpportunityV2;
  const emblApplied = applyStructuredFieldDecision(embl, byId.get("embl-visitor-programme")!, manifest);
  assert.equal(emblApplied.urls.applicationUrl, null);
  assert.equal(emblApplied.availability.deadlineType, "rolling");
  assert.equal(emblApplied.migration?.unresolvedFields.includes("urls.applicationUrl"), true);
  assert.equal(emblApplied.migration?.unresolvedFields.includes("availability.deadlineType"), false);
});

test("Berkeley Job Shadow has a current fixed application window without a fake human review", async () => {
  const record = JSON.parse(
    await readFile(join(root, "opportunities/cal-job-shadow.json"), "utf8"),
  ) as OpportunityV2;
  assert.equal(record.availability.status, "open");
  assert.equal(record.availability.opensAt, "2026-08-17");
  assert.equal(record.availability.closesAt, "2026-10-26");
  assert.equal(record.availability.deadlineType, "fixed");
  assert.equal(record.reviewProvenance.reviewedAt, null);
  assert.equal(record.classification.reviewState, "needs-human-review");
});


test("current provider research adds direct application URLs without inventing human review", async () => {
  const expected = new Map([
    ["anthropic-model-safety-bug-bounty", "https://docs.google.com/forms/d/e/1FAIpQLSf3IuyunFH1Rbz_9Bpt2kGBfwSW5QQ1TBkeAzNZrtCP-hRvNA/viewform"],
    ["freed-fellowship-grant", "https://freedfellowship.com/application"],
    ["macstadium-oss-program", "https://macstadium.com/opensource-application"],
    ["wfp-innovation-accelerator", "https://innovation.wfp.org/apply"],
  ]);
  for (const [id, applicationUrl] of expected) {
    const record = JSON.parse(
      await readFile(join(root, "opportunities", `${id}.json`), "utf8"),
    ) as OpportunityV2;
    assert.equal(record.urls.applicationUrl, applicationUrl, id);
    assert.equal(record.reviewProvenance.reviewedAt, null, id);
    assert.equal(record.classification.reviewState, "needs-human-review", id);
  }
});

test("current provider research structures fixed historical deadlines exactly", async () => {
  const expected = new Map([
    ["amazon-sustainability-accelerator", ["2026-06-03", "2026-07-10"]],
    ["braden-storytelling-grant", [null, "2026-02-22"]],
    ["public-art-futures-lab-residency", [null, "2026-02-10"]],
  ] as const);
  for (const [id, [opensAt, closesAt]] of expected) {
    const record = JSON.parse(
      await readFile(join(root, "opportunities", `${id}.json`), "utf8"),
    ) as OpportunityV2;
    assert.equal(record.availability.opensAt, opensAt, id);
    assert.equal(record.availability.closesAt, closesAt, id);
    assert.equal(record.availability.deadlineType, "fixed", id);
    assert.equal(record.reviewProvenance.reviewedAt, null, id);
  }
});

test("automated structured decisions never overwrite later human-reviewed data", async () => {
  const decision = manifest.decisions.find((item) => item.id === "alchemist-accelerator")!;
  const raw = JSON.parse(
    await readFile(join(root, "opportunities/alchemist-accelerator.json"), "utf8"),
  ) as OpportunityV2;
  raw.reviewProvenance.reviewedAt = "2026-10-06T12:00:00.000Z";
  raw.reviewProvenance.reviewMethod = "human";
  raw.reviewProvenance.reviewerReference = "moderator:example";
  raw.urls.applicationUrl = "https://example.org/human-reviewed-application";
  const applied = applyStructuredFieldDecision(raw, decision, manifest);
  assert.equal(applied.urls.applicationUrl, "https://example.org/human-reviewed-application");
  assert.equal(applied.reviewProvenance.reviewMethod, "human");
  assert.equal(applied.reviewProvenance.reviewedAt, "2026-10-06T12:00:00.000Z");
});
