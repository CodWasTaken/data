import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { BenefitType, OpportunityV2, ResourceType } from "../generated/opportunity-v2";
import { validateOpportunityV2 } from "./schema-v2";

export interface OpportunityV1 {
  id: string; provider: string; title: string; category: string; subcategories?: string[];
  tags: string[]; description: string; eligibility: string; value: string;
  sourceUrl: string; officialUrl: string; status: string; submissionType: string;
  sponsor: boolean; reviewDate: string; regions?: string[]; notes?: string;
}

const resourceTypeFor = (record: OpportunityV1): ResourceType => {
  const map: Record<string, ResourceType> = {
    funding: "funding", fellowships: "fellowship", "competitions-hackathons": "competition",
    "events-conferences": "event", "mentorship-community": "community",
    "education-training": "learning-resource", "research-opportunities": "resource",
    "discounts-perks": "benefit", "startup-benefits": "benefit",
    "student-benefits": "benefit", "nonprofit-benefits": "benefit",
  };
  return map[record.category] ?? "opportunity";
};
const benefitTypesFor = (record: OpportunityV1): BenefitType[] => {
  const text = `${record.title} ${record.value} ${record.tags.join(" ")}`.toLowerCase();
  const rules: Array<[RegExp, BenefitType]> = [
    [/grant|funding/, "grant"], [/prize|award/, "prize"], [/stipend/, "stipend"],
    [/credit/, "credit"], [/discount|perk/, "discount"], [/software|license|tool/, "software"],
    [/hardware|device/, "hardware"], [/course|training|workshop|learn/, "training"],
    [/mentor/, "mentorship"], [/workspace|cowork/, "workspace"], [/compute|cloud/, "compute"],
    [/network|community/, "network-access"], [/recognition|award/, "recognition"],
  ];
  return [...new Set(rules.filter(([pattern]) => pattern.test(text)).map(([, type]) => type))];
};
const statusFor = (status: string): OpportunityV2["availability"]["status"] => {
  if (["limited", "waitlist", "expired", "disputed", "unconfirmed"].includes(status))
    return status as OpportunityV2["availability"]["status"];
  return "unconfirmed";
};

export function migrateV1ToV2(record: OpportunityV1): OpportunityV2 {
  const legacyRegions = record.regions ?? [];
  const reviewedAt = /^\d{4}-\d{2}-\d{2}$/.test(record.reviewDate)
    ? `${record.reviewDate}T00:00:00.000Z`
    : null;
  const unresolvedFields = [
    "urls.providerUrl", "urls.programUrl", "urls.applicationUrl", "classification.defaultSearchEligible",
    "geography.global", "geography.remote", "geography.countries", "geography.residencyRequired",
    "availability.deadlineType", "reviewProvenance.reviewerReference",
  ];
  if (record.status === "active") unresolvedFields.push("availability.status");
  return {
    id: record.id,
    schemaVersion: "2.0",
    provider: record.provider,
    title: record.title,
    aliases: [],
    description: record.description,
    canonicalUrl: record.officialUrl,
    urls: {
      providerUrl: null,
      programUrl: null,
      applicationUrl: null,
      evidenceUrls: [{ type: "overview", url: record.sourceUrl, checkedAt: reviewedAt, claim: "Legacy source used for the published v1 record." }],
    },
    classification: {
      resourceType: resourceTypeFor(record),
      primaryCategory: record.category,
      subcategories: record.subcategories ?? [],
      topics: record.tags,
      audiences: [],
      organizationStages: [],
      benefitTypes: benefitTypesFor(record),
      reviewState: "needs-human-review",
      defaultSearchEligible: null,
    },
    geography: {
      global: null, remote: null, countries: [], excludedCountries: [],
      physicalLocations: legacyRegions.filter((region) => region !== "Global"),
      residencyRequired: null, languages: [],
    },
    availability: {
      status: statusFor(record.status),
      statusReason: `Migrated from v1 status '${record.status}'; confirm against current evidence.`,
      opensAt: null, closesAt: null, deadlineType: "unknown", applicationCycle: null, nextExpectedOpening: null,
    },
    costAndBenefit: {
      cost: null,
      benefits: benefitTypesFor(record).map((type) => ({ type, summary: record.value })),
      currency: null, amount: null, maximumAmount: null, benefitSummary: record.value,
    },
    eligibility: {
      summary: record.eligibility, studentLevels: [], organizationTypes: [], companyStages: [],
      ageRestrictions: null, incorporationRequired: null, nonprofitStatusRequired: null,
      openSourceRequired: null, researchAffiliationRequired: null,
    },
    reviewProvenance: {
      reviewedAt, reviewMethod: "legacy-record-migration", reviewerReference: null,
      claimsChecked: [], nextReviewAt: null, sourceFetchedAt: null, sourceHash: null,
      confidence: null, importSource: record.submissionType === "maintainer" ? "legacy-maintainer-record" : null,
      extractorVersion: null,
    },
    changeHistory: {
      createdAt: null, updatedAt: reviewedAt, previousIds: [], supersedes: [], supersededBy: [],
      tombstone: false, removalReason: null,
    },
    sponsorship: {
      sponsored: record.sponsor, sponsorshipType: null,
      sponsorshipDisclosure: record.sponsor ? "Legacy sponsor flag; disclosure requires editorial review." : null,
      featuredReason: null, featureExpiresAt: null,
    },
    migration: { fromSchemaVersion: "1", legacyStatus: record.status, legacyRegions, unresolvedFields },
  };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const files = (await readdir(join(root, "opportunities"))).filter((name) => name.endsWith(".json") && !name.startsWith("_"));
  const outputIndex = process.argv.indexOf("--output");
  const output = outputIndex >= 0 ? process.argv[outputIndex + 1] : undefined;
  if (output) await mkdir(output, { recursive: true });
  const failures: Array<{ id: string; errors: string[] }> = [];
  let unresolvedFields = 0;
  let v1RecordsMigrated = 0;
  let alreadyV2Records = 0;
  for (const file of files) {
    const raw = JSON.parse(
      await readFile(join(root, "opportunities", file), "utf8"),
    ) as OpportunityV1 | OpportunityV2;
    const migrated = raw.schemaVersion === "2.0"
      ? raw
      : migrateV1ToV2(raw as OpportunityV1);
    if (raw.schemaVersion === "2.0") alreadyV2Records += 1;
    else v1RecordsMigrated += 1;
    const result = validateOpportunityV2(migrated);
    if (!result.valid) failures.push({ id: raw.id, errors: result.errors });
    unresolvedFields += migrated.migration?.unresolvedFields.length ?? 0;
    if (output) {
      await writeFile(
        join(output, file),
        `${JSON.stringify(migrated, null, 2)}\n`,
      );
    }
  }
  const report = {
    schemaVersion: "2.0",
    sourceSchemaVersions: ["1", "2.0"],
    recordsInspected: files.length,
    v1RecordsMigrated,
    alreadyV2Records,
    recordsValid: files.length - failures.length,
    recordsFailed: failures.length,
    unresolvedFieldCount: unresolvedFields,
    outputWritten: Boolean(output),
    failures,
    note: "Dry-run migration does not replace records. Existing v2 records are validated without being migrated again; newly migrated v1 records remain needs-human-review.",
  };
  await mkdir(join(root, "reports"), { recursive: true });
  await writeFile(join(root, "reports/migration-results.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(
    `Migration dry run: ${report.recordsValid}/${files.length} valid; ${v1RecordsMigrated} v1 migrated; ${alreadyV2Records} v2 validated; ${unresolvedFields} unresolved fields preserved.`,
  );
  if (failures.length) process.exit(1);
}
