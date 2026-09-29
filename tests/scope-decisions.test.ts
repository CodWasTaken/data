import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  applyScopeDecision,
  expandScopeDecisions,
  type ScopeManifest,
} from "../scripts/apply-scope-decisions";
import type { OpportunityV1 } from "../scripts/migrate-v1-to-v2";
import { validateOpportunityV2 } from "../scripts/schema-v2";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(
  await readFile(join(root, "editorial/scope-decisions.json"), "utf8"),
) as ScopeManifest;
const ids = (await readdir(join(root, "opportunities")))
  .filter((file) => file.endsWith(".json") && !file.startsWith("_"))
  .map((file) => file.replace(/\.json$/, ""));
const decisions = expandScopeDecisions(ids, manifest);

test("scope decisions cover only explicit high-confidence exclusions", () => {
  assert.equal(decisions.size, 289);
  for (const id of [
    "zoom-basic-plan",
    "blender-free",
    "hilton-honors",
    "android-beta-program",
    "world-bank-data",
    "focusmate",
    "aws-activate-asana",
    "github-student-pack-1password",
  ]) {
    assert.ok(decisions.has(id), id);
  }
  for (const id of [
    "openai-bug-bounty",
    "anthropic-claude-team-research-labs",
    "adobe-nonprofit-program",
    "code2040-community",
    "betatesting-tester-community",
    "aws-activate-cloud-credits",
  ]) {
    assert.equal(decisions.has(id), false, id);
  }
});

test("scope decisions preserve records while excluding them from default search", async () => {
  const id = "zoom-basic-plan";
  const legacy = JSON.parse(
    await readFile(join(root, "opportunities", `${id}.json`), "utf8"),
  ) as OpportunityV1;
  const converted = applyScopeDecision(legacy, decisions.get(id)!, manifest);
  assert.equal(converted.id, id);
  assert.equal(converted.schemaVersion, "2.0");
  assert.equal(converted.classification.resourceType, "general-free-product");
  assert.equal(converted.classification.defaultSearchEligible, false);
  assert.equal(converted.classification.reviewState, "needs-human-review");
  assert.equal(converted.changeHistory.tombstone, false);
  assert.match(converted.changeHistory.removalReason ?? "", /Default-search exclusion/);
  assert.equal(validateOpportunityV2(converted).valid, true);
});

test("bundle components declare their canonical grouped record", async () => {
  for (const [id, parent] of [
    ["github-student-pack-1password", "github-student-developer-pack"],
    ["aws-activate-asana", "aws-activate-cloud-credits"],
  ]) {
    const raw = JSON.parse(
      await readFile(join(root, "opportunities", `${id}.json`), "utf8"),
    );
    const converted = applyScopeDecision(raw, decisions.get(id)!, manifest);
    assert.deepEqual(converted.changeHistory.supersededBy, [parent]);
  }
});
