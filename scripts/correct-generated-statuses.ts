import { readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { OpportunityV2 } from "../generated/opportunity-v2";
import type { OpportunityV1 } from "./migrate-v1-to-v2";
import { validateOpportunityV2 } from "./schema-v2";

export function correctGeneratedLimitedStatus(
  raw: OpportunityV1 | OpportunityV2,
): OpportunityV1 | OpportunityV2 {
  if (raw.schemaVersion !== "2.0") {
    const record = structuredClone(raw);
    if (record.status === "limited") record.status = "unconfirmed";
    return record;
  }
  const record = structuredClone(raw);
  if (
    record.availability.status !== "limited" ||
    record.migration?.legacyStatus !== "limited"
  ) {
    return record;
  }
  record.availability.status = "unconfirmed";
  if (record.classification.defaultSearchEligible !== false) {
    record.availability.statusReason =
      "The legacy importer assigned 'limited' without checking current availability. A human source review must select open, rolling, upcoming, waitlist, closed, or another supported state.";
  }
  record.classification.reviewState = "needs-human-review";
  const validation = validateOpportunityV2(record);
  if (!validation.valid) {
    throw new Error(`${record.id}: ${validation.errors.join("; ")}`);
  }
  return record;
}

async function run(): Promise<void> {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const files = (await readdir(join(root, "opportunities")))
    .filter((name) => name.endsWith(".json") && !name.startsWith("_"))
    .sort();
  const check = process.argv.includes("--check");
  let stale = 0;
  for (const file of files) {
    const path = join(root, "opportunities", file);
    const rawText = await readFile(path, "utf8");
    const raw = JSON.parse(rawText) as OpportunityV1 | OpportunityV2;
    const isGeneratedLimited = raw.schemaVersion === "2.0"
      ? raw.availability.status === "limited" &&
        raw.migration?.legacyStatus === "limited"
      : raw.status === "limited";
    if (!isGeneratedLimited) continue;
    const corrected = correctGeneratedLimitedStatus(raw);
    const expected = `${JSON.stringify(corrected, null, 2)}\n`;
    if (rawText === expected) continue;
    stale += 1;
    if (!check) await writeFile(path, expected);
  }
  if (check && stale > 0) {
    throw new Error(
      `${stale} records still use the generated limited default; run npm run status:apply`,
    );
  }
  console.log(
    `${check ? "Checked" : "Corrected"} generated availability statuses` +
      `${check ? "" : `; ${stale} records updated`}.`,
  );
}

const isMain =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) await run();
