import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

interface Report {
  generatedAt: string;
  recordsInspected: number;
  uniqueSourceRequests: number;
  counts: Record<string, number>;
  methodology: {
    reviewer: string;
    automaticPublicationAllowed: boolean;
    contextOverrides: number;
    note: string;
  };
  records: Array<{
    id: string;
    provider: string;
    title: string;
    suggestedStatus: string;
    confidence: number;
    reason: string;
    reviewState: string;
  }>;
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const report = JSON.parse(
  await readFile(join(root, "reports", "availability-research.json"), "utf8"),
) as Report;
const statusRows = Object.entries(report.counts)
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([status, count]) => `| ${status} | ${count} |`)
  .join("\n");
const contextRows = report.records
  .filter((record) => record.reviewState === "context-reviewed")
  .map(
    (record) =>
      `| \`${record.id}\` | ${record.suggestedStatus} | ${record.reason} |`,
  )
  .join("\n");
const markdown = `# Availability research

Generated: ${report.generatedAt}

This fork-only audit evaluated ${report.recordsInspected} canonical records against ${report.uniqueSourceRequests} distinct HTTPS source URLs. It records AI-assisted research, not manual approval. Automatic publication is ${report.methodology.automaticPublicationAllowed ? "allowed" : "not allowed"}.

## Decisions

| Status | Records |
| --- | ---: |
${statusRows}

Unconfirmed is the correct outcome when a provider blocks access, the page is ambiguous, a time-bound program lacks a current application statement, or evidence conflicts. The complete per-record evidence ledger is in \`availability-research.json\`.

## Context corrections

These ${report.methodology.contextOverrides} decisions correct page-wide phrase matches that lose date or listing context.

| Record | Status | Reason |
| --- | --- | --- |
${contextRows}

## Safety and provenance

- Reviewer method: \`${report.methodology.reviewer}\`
- AI-assisted status assignments remain \`needs-human-review\`.
- No record is marked manually reviewed by this audit.
- Only short evidence excerpts and source hashes are retained; provider page bodies are not copied.
- ${report.methodology.note}
`;
await writeFile(
  join(root, "reports", "availability-research.md"),
  markdown,
);
console.log("Rendered reports/availability-research.md.");
