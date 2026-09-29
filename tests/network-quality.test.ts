import assert from "node:assert/strict";
import test from "node:test";
import { sourceAuditMetrics } from "../scripts/network-quality";

test("source audit metrics expose measured broken and redirect rates", () => {
  const metrics = sourceAuditMetrics({
    asOf: "2026-09-29",
    urlsInspected: 100,
    counts: {
      success: 70,
      redirect: 15,
      "redirect-chain": 10,
      blocked: 3,
      broken: 1,
      ambiguous: 1,
    },
  });
  assert.deepEqual(metrics.brokenLinkRate, {
    status: "measured",
    count: 1,
    inspected: 100,
    percentage: 1,
    asOf: "2026-09-29",
  });
  assert.deepEqual(metrics.redirectRate, {
    status: "measured",
    count: 25,
    inspected: 100,
    percentage: 25,
    asOf: "2026-09-29",
  });
});

test("source audit metrics avoid division by zero", () => {
  const metrics = sourceAuditMetrics({
    asOf: "2026-09-29",
    urlsInspected: 0,
    counts: {},
  });
  assert.equal(metrics.brokenLinkRate.percentage, 0);
  assert.equal(metrics.redirectRate.percentage, 0);
});
