import { readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { OpportunityV2 } from "../generated/opportunity-v2";
import {
  migrateV1ToV2,
  type OpportunityV1,
} from "./migrate-v1-to-v2";

type V2Status = OpportunityV2["availability"]["status"];

interface SourceResult {
  requestedUrl: string;
  finalUrl: string | null;
  fetchedAt: string;
  sourceHash: string | null;
  confidence: number;
  suggestedStatus: string;
}

interface AvailabilityDecision {
  id: string;
  urls: string[];
  suggestedStatus: V2Status;
  confidence: number;
  reason: string;
  reviewState: string;
  sources: SourceResult[];
}

interface AvailabilityReport {
  generatedAt: string;
  records: AvailabilityDecision[];
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const checkOnly = process.argv.includes("--check");
const report = JSON.parse(
  await readFile(join(root, "reports", "availability-research.json"), "utf8"),
) as AvailabilityReport;
const decisions = new Map(report.records.map((record) => [record.id, record]));
const files = (await readdir(join(root, "opportunities")))
  .filter((file) => file.endsWith(".json") && !file.startsWith("_"))
  .sort();

const exactV2Statuses = new Set<V2Status>([
  "rolling",
  "upcoming",
  "limited",
  "waitlist",
  "temporarily-unavailable",
  "closed",
]);

const primarySource = (decision: AvailabilityDecision) =>
  [...decision.sources].sort((left, right) => {
    const leftMatch = left.suggestedStatus === decision.suggestedStatus ? 1 : 0;
    const rightMatch = right.suggestedStatus === decision.suggestedStatus ? 1 : 0;
    return rightMatch - leftMatch || right.confidence - left.confidence;
  })[0] ?? null;

const addResearchProvenance = (
  record: OpportunityV2,
  decision: AvailabilityDecision,
) => {
  const source = primarySource(decision);
  record.availability.status = decision.suggestedStatus;
  record.availability.statusReason =
    `${decision.reason} Status assigned by AI-assisted source research; human editorial review is still required.`;
  record.classification.reviewState = "needs-human-review";
  record.reviewProvenance.reviewedAt = null;
  record.reviewProvenance.reviewMethod = "automated-source-research";
  record.reviewProvenance.reviewerReference = "automation:availability-research-v1";
  record.reviewProvenance.sourceFetchedAt = source?.fetchedAt ?? report.generatedAt;
  record.reviewProvenance.sourceHash =
    decision.reviewState === "context-reviewed"
      ? null
      : source?.sourceHash ?? null;
  record.reviewProvenance.confidence = decision.confidence;
  record.reviewProvenance.extractorVersion = "availability-research/1";
  record.reviewProvenance.claimsChecked =
    decision.suggestedStatus === "unconfirmed"
      ? ["automated-source-access"]
      : decision.reviewState === "ongoing-page-supported"
      ? ["automated-source-access", "automated-program-page-match"]
      : ["automated-source-access", "automated-availability-signal"];
  for (const url of decision.urls) {
    const existing = record.urls.evidenceUrls.find((item) => item.url === url);
    if (existing) {
      existing.checkedAt = source?.fetchedAt ?? report.generatedAt;
      continue;
    }
    record.urls.evidenceUrls.push({
      type: "overview",
      url,
      checkedAt: report.generatedAt,
      claim: "Additional source used for AI-assisted availability context.",
    });
  }
  if (record.migration) {
    record.migration.unresolvedFields =
      record.migration.unresolvedFields.filter(
        (field) =>
          ![
            "availability.status",
            "reviewProvenance.reviewerReference",
          ].includes(field),
      );
  }
};

const migrateForExactStatus = (
  record: OpportunityV1,
  decision: AvailabilityDecision,
) => {
  const migrated = migrateV1ToV2(record);
  migrated.canonicalUrl = record.sourceUrl;
  migrated.urls.providerUrl =
    record.officialUrl !== record.sourceUrl ? record.officialUrl : null;
  migrated.urls.programUrl = record.sourceUrl;
  migrated.migration!.unresolvedFields =
    migrated.migration!.unresolvedFields.filter(
      (field) =>
        ![
          "urls.providerUrl",
          "urls.programUrl",
          "availability.status",
          "reviewProvenance.reviewerReference",
        ].includes(field),
    );
  addResearchProvenance(migrated, decision);
  return migrated;
};

let changed = 0;
let migrated = 0;
const seen = new Set<string>();
for (const file of files) {
  const path = join(root, "opportunities", file);
  const original = await readFile(path, "utf8");
  const raw = JSON.parse(original) as OpportunityV1 | OpportunityV2;
  const decision = decisions.get(raw.id);
  if (!decision) throw new Error(`Missing availability decision for '${raw.id}'.`);
  seen.add(raw.id);

  let updated: OpportunityV1 | OpportunityV2 = structuredClone(raw);
  if ((updated as OpportunityV2).schemaVersion === "2.0") {
    addResearchProvenance(updated as OpportunityV2, decision);
  } else if (exactV2Statuses.has(decision.suggestedStatus)) {
    updated = migrateForExactStatus(updated as OpportunityV1, decision);
    migrated += 1;
  } else {
    const legacy = updated as OpportunityV1;
    const mappedStatus =
      decision.suggestedStatus === "open" ? "active" : decision.suggestedStatus;
    if (
      ![
        "active",
        "limited",
        "waitlist",
        "unconfirmed",
        "expired",
        "disputed",
      ].includes(mappedStatus)
    ) {
      throw new Error(
        `Cannot represent '${decision.suggestedStatus}' in v1 record '${legacy.id}'.`,
      );
    }
    legacy.status = mappedStatus;
  }

  const rendered = `${JSON.stringify(updated, null, 2)}\n`;
  if (rendered === original) continue;
  changed += 1;
  if (!checkOnly) await writeFile(path, rendered);
}

const missingRecords = [...decisions.keys()].filter((id) => !seen.has(id));
if (missingRecords.length > 0) {
  throw new Error(
    `Availability report references missing records: ${missingRecords.join(", ")}`,
  );
}
if (checkOnly && changed > 0) {
  console.error(
    `${changed} records do not match the availability decision report (${migrated} require v2 migration).`,
  );
  process.exit(1);
}
console.log(
  checkOnly
    ? `All ${files.length} records match the availability decision report.`
    : `Applied availability decisions to ${changed} records; ${migrated} migrated to v2 for exact status semantics.`,
);

const isMain = process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (!isMain) {
  throw new Error("Availability decisions must be run as a script.");
}
