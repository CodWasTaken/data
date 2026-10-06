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
  assert.equal(manifest.decisions.length, 8);
  assert.equal(new Set(manifest.decisions.map((decision) => decision.id)).size, 8);
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
