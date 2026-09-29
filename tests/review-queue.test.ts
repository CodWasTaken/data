import assert from "node:assert/strict";
import test from "node:test";
import { reviewPriority } from "../scripts/review-priority";

const base = {
  defaultSearchEligible: true,
  resourceType: "opportunity",
  status: "unconfirmed",
  evidenceUrlCount: 1,
  structuredDeadline: false,
  applicationUrl: null,
};

test("review priority favors default-search current material opportunities with actionable evidence", () => {
  const high = reviewPriority({
    ...base,
    resourceType: "funding",
    status: "open",
    evidenceUrlCount: 2,
    structuredDeadline: true,
    applicationUrl: "https://example.org/apply",
  });
  const medium = reviewPriority(base);
  const excluded = reviewPriority({
    ...base,
    defaultSearchEligible: false,
    status: "open",
  });

  assert.ok(high.score > medium.score);
  assert.ok(medium.score > excluded.score);
  assert.ok(high.reasons.includes("default-search-eligible"));
  assert.ok(high.reasons.includes("current-or-actionable-status"));
  assert.ok(high.reasons.includes("material-or-selective-resource-type"));
  assert.ok(high.reasons.includes("structured-deadline"));
  assert.ok(high.reasons.includes("application-url"));
});

test("review priority is deterministic and does not claim human review", () => {
  const first = reviewPriority(base);
  const second = reviewPriority({ ...base });
  assert.deepEqual(first, second);
  assert.equal("verified" in first, false);
  assert.equal("humanReviewed" in first, false);
});
