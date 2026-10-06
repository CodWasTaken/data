import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

interface Decision {
  id: string;
  suggestedStatus: string;
  reviewState: string;
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const report = JSON.parse(
  await readFile(join(root, "reports", "availability-research.json"), "utf8"),
) as {
  recordsInspected: number;
  counts: Record<string, number>;
  methodology: {
    automaticPublicationAllowed: boolean;
    contextOverrides: number;
  };
  records: Decision[];
};

test("every canonical record has an availability decision", () => {
  assert.equal(report.recordsInspected, 1068);
  assert.equal(report.records.length, 1068);
  assert.equal(new Set(report.records.map((record) => record.id)).size, 1068);
  assert.equal(report.methodology.automaticPublicationAllowed, false);
  assert.equal(report.methodology.contextOverrides, 18);
});

test("limited is reserved for directly supported restrictions", () => {
  assert.equal(report.counts.limited, 1);
  const limited = report.records
    .filter((record) => record.suggestedStatus === "limited")
    .map((record) => record.id)
    .sort();
  assert.deepEqual(limited, ["founders-network"]);
});

test("context-sensitive corrections override misleading page-wide phrases", () => {
  const statuses = new Map(
    report.records.map((record) => [record.id, record.suggestedStatus]),
  );
  assert.equal(statuses.get("aws-activate-cloud-credits"), "open");
  assert.equal(statuses.get("aws-generative-ai-accelerator"), "closed");
  assert.equal(statuses.get("datadog-preview-features"), "unconfirmed");
  assert.equal(statuses.get("github-accelerator"), "closed");
  assert.equal(statuses.get("sundance-documentary-fund"), "closed");
  assert.equal(statuses.get("remarkable-accelerator"), "upcoming");
});

test("automated provenance never claims human review", async () => {
  for (const decision of report.records) {
    const record = JSON.parse(
      await readFile(
        join(root, "opportunities", `${decision.id}.json`),
        "utf8",
      ),
    ) as Record<string, unknown>;
    if (record.schemaVersion !== "2.0") continue;
    const provenance = record.reviewProvenance as Record<string, unknown>;
    if (provenance.reviewMethod !== "automated-source-research") continue;
    const classification = record.classification as Record<string, unknown>;
    assert.equal(classification.reviewState, "needs-human-review", decision.id);
    assert.match(
      String(provenance.reviewerReference ?? ""),
      /^automation:/,
      decision.id,
    );
    assert.equal(provenance.reviewedAt, null, decision.id);
  }
});