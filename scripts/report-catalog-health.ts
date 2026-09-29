import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  expandScopeDecisions,
  type ScopeManifest,
} from "./apply-scope-decisions";
import { reviewPriority } from "./review-priority";
import { sourceAuditMetrics, type SourceAuditSummary } from "./network-quality";

interface ReportRecord {
  id: string;
  provider: string;
  title: string;
  category: string;
  subcategories: string[];
  tags: string[];
  description: string;
  eligibility: string;
  value: string;
  sourceUrl: string;
  officialUrl: string;
  status: string;
  submissionType: string;
  sponsor: boolean;
  reviewDate: string;
  regions: string[];
  schemaVersion: "1" | "2.0";
  resourceType: string | null;
  defaultSearchEligible: boolean | null;
  reviewState: string | null;
  reviewMethod: string | null;
  applicationUrl: string | null;
  evidenceUrlCount: number;
  structuredDeadline: boolean;
}

type ScopeFlag =
  | "ordinary-free-product"
  | "loyalty-program"
  | "generic-membership"
  | "public-resource"
  | "formulaic-record"
  | "duplicate-bundle"
  | "component-offer"
  | "generic-eligibility"
  | "low-informational-value";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const reportDirectory = join(root, "reports");
await mkdir(reportDirectory, { recursive: true });
const files = (await readdir(join(root, "opportunities")))
  .filter((name) => name.endsWith(".json") && !name.startsWith("_"))
  .sort();

const toReportRecord = (raw: Record<string, unknown>): ReportRecord => {
  if (raw.schemaVersion !== "2.0") {
    return {
      ...(raw as unknown as Omit<
        ReportRecord,
        | "schemaVersion"
        | "resourceType"
        | "defaultSearchEligible"
        | "reviewState"
        | "reviewMethod"
        | "applicationUrl"
        | "evidenceUrlCount"
        | "structuredDeadline"
      >),
      subcategories: Array.isArray(raw.subcategories)
        ? raw.subcategories as string[]
        : [],
      regions: Array.isArray(raw.regions) ? raw.regions as string[] : [],
      schemaVersion: "1",
      resourceType: null,
      defaultSearchEligible: null,
      reviewState: null,
      reviewMethod: null,
      applicationUrl: null,
      evidenceUrlCount: 1,
      structuredDeadline: false,
    };
  }
  const classification = raw.classification as Record<string, unknown>;
  const urls = raw.urls as Record<string, unknown>;
  const availability = raw.availability as Record<string, unknown>;
  const geography = raw.geography as Record<string, unknown>;
  const costAndBenefit = raw.costAndBenefit as Record<string, unknown>;
  const eligibility = raw.eligibility as Record<string, unknown>;
  const provenance = raw.reviewProvenance as Record<string, unknown>;
  const sponsorship = raw.sponsorship as Record<string, unknown>;
  const evidenceUrls = Array.isArray(urls.evidenceUrls)
    ? urls.evidenceUrls as Array<{ url?: unknown }>
    : [];
  const reviewedAt = typeof provenance.reviewedAt === "string"
    ? provenance.reviewedAt
    : "1970-01-01";
  const countries = Array.isArray(geography.countries)
    ? geography.countries as string[]
    : [];
  const physicalLocations = Array.isArray(geography.physicalLocations)
    ? geography.physicalLocations as string[]
    : [];
  const regions = [
    ...(geography.global === true ? ["Global"] : countries),
    ...(geography.remote === true ? ["Remote"] : []),
    ...physicalLocations,
  ];
  const sourceUrl =
    (typeof evidenceUrls[0]?.url === "string" ? evidenceUrls[0].url : null) ??
    String(raw.canonicalUrl);
  const applicationUrl = typeof urls.applicationUrl === "string"
    ? urls.applicationUrl
    : null;
  const officialUrl =
    applicationUrl ??
    (typeof urls.programUrl === "string" ? urls.programUrl : null) ??
    (typeof urls.providerUrl === "string" ? urls.providerUrl : null) ??
    String(raw.canonicalUrl);
  return {
    id: String(raw.id),
    provider: String(raw.provider),
    title: String(raw.title),
    category: String(classification.primaryCategory),
    subcategories: Array.isArray(classification.subcategories)
      ? classification.subcategories as string[]
      : [],
    tags: Array.isArray(classification.topics)
      ? classification.topics as string[]
      : [],
    description: String(raw.description),
    eligibility: String(eligibility.summary),
    value: String(costAndBenefit.benefitSummary),
    sourceUrl,
    officialUrl,
    status: String(availability.status),
    submissionType: provenance.importSource ? "maintainer" : "community",
    sponsor: sponsorship.sponsored === true,
    reviewDate: reviewedAt.slice(0, 10),
    regions: [...new Set(regions)],
    schemaVersion: "2.0",
    resourceType: String(classification.resourceType),
    defaultSearchEligible:
      typeof classification.defaultSearchEligible === "boolean"
        ? classification.defaultSearchEligible
        : null,
    reviewState: typeof classification.reviewState === "string"
      ? classification.reviewState
      : null,
    reviewMethod: typeof provenance.reviewMethod === "string"
      ? provenance.reviewMethod
      : null,
    applicationUrl,
    evidenceUrlCount: evidenceUrls.length,
    structuredDeadline:
      typeof availability.closesAt === "string" ||
      (
        typeof availability.deadlineType === "string" &&
        availability.deadlineType !== "unknown"
      ),
  };
};

const records = await Promise.all(
  files.map(async (file) =>
    toReportRecord(
      JSON.parse(
        await readFile(join(root, "opportunities", file), "utf8"),
      ) as Record<string, unknown>,
    )
  ),
);
const manifest = JSON.parse(
  await readFile(join(root, "editorial/scope-decisions.json"), "utf8"),
) as ScopeManifest;
const scopeDecisions = expandScopeDecisions(
  records.map((record) => record.id),
  manifest,
);

const asOfIndex = process.argv.indexOf("--as-of");
const asOf = asOfIndex >= 0
  ? process.argv[asOfIndex + 1]
  : new Date().toISOString().slice(0, 10);
if (!asOf || !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
  throw new Error("--as-of must use YYYY-MM-DD");
}

const normalize = (value: string) =>
  value.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const normalizeUrl = (value: string) => {
  const url = new URL(value);
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (/^(utm_|ref$|source$)/i.test(key)) url.searchParams.delete(key);
  }
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  return url.toString();
};
const groupBy = <T>(items: T[], key: (item: T) => string) => {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const id = key(item);
    if (!id) continue;
    const group = groups.get(id) ?? [];
    group.push(item);
    groups.set(id, group);
  }
  return groups;
};

const eligibilityGroups = groupBy(records, (record) =>
  normalize(record.eligibility)
);
const descriptionGroups = groupBy(records, (record) =>
  normalize(record.description)
);
const urlGroups = groupBy(records, (record) => normalizeUrl(record.officialUrl));
const providerTitleGroups = groupBy(
  records,
  (record) => `${normalize(record.provider)}|${normalize(record.title)}`,
);
const genericEligibilityIds = new Set(
  [...eligibilityGroups.values()]
    .filter((group) => group.length >= 5)
    .flatMap((group) => group.map((record) => record.id)),
);
const formulaicDescriptionIds = new Set(
  [...descriptionGroups.values()]
    .filter((group) => group.length >= 4)
    .flatMap((group) => group.map((record) => record.id)),
);

const scopeCandidates = records.map((record) => {
  const text = normalize(
    `${record.id} ${record.provider} ${record.title} ${record.description} ${record.value}`,
  );
  const flags = new Set<ScopeFlag>();
  const reasons: string[] = [];
  if (
    record.resourceType === "general-free-product" ||
    (
      record.category === "discounts-perks" &&
      /free plan|free tier|starter plan|free account|free editor|free software|hobby plan|basic plan/
        .test(text)
    )
  ) {
    flags.add("ordinary-free-product");
    reasons.push("Appears to describe a generally available free product or standard plan.");
  }
  if (
    record.category === "discounts-perks" &&
    (
      record.tags.includes("loyalty") ||
      /rewards|honors|bonvoy|privileges|one key|world of hyatt|all accor/
        .test(text)
    )
  ) {
    flags.add("loyalty-program");
    reasons.push("Appears to be an ordinary consumer loyalty program.");
  }
  if (
    record.category === "mentorship-community" &&
    /community|membership|user group|focus room|accountability/.test(text)
  ) {
    flags.add("generic-membership");
    reasons.push("Community or membership may lack selective or material opportunity criteria.");
  }
  if (
    ["public-dataset", "learning-resource"].includes(record.resourceType ?? "") ||
    /open data|data portal|open courses|free courses|documentation|curriculum|public resource|opencourseware/
      .test(text)
  ) {
    flags.add("public-resource");
    reasons.push("Appears primarily to be a public resource rather than an application-based opportunity.");
  }
  if (genericEligibilityIds.has(record.id)) {
    flags.add("generic-eligibility");
    reasons.push(
      `Eligibility text is reused across ${
        eligibilityGroups.get(normalize(record.eligibility))?.length ?? 0
      } records.`,
    );
  }
  if (
    formulaicDescriptionIds.has(record.id) ||
    /current .* requirements/.test(normalize(record.eligibility))
  ) {
    flags.add("formulaic-record");
    reasons.push("Text follows a repeated template and needs provider-specific verification.");
  }
  if (
    record.id.startsWith("github-student-pack-") ||
    record.id.startsWith("aws-activate-")
  ) {
    flags.add("component-offer");
    flags.add("duplicate-bundle");
    reasons.push("This component belongs to a larger provider bundle.");
  }
  if (
    record.description.length < 100 ||
    record.value.length < 20 ||
    record.sourceUrl === record.officialUrl
  ) {
    flags.add("low-informational-value");
    reasons.push("Decision-critical detail or distinct evidence/application URL is limited.");
  }
  const decision = scopeDecisions.get(record.id);
  return {
    id: record.id,
    provider: record.provider,
    title: record.title,
    category: record.category,
    schemaVersion: record.schemaVersion,
    resourceType: record.resourceType,
    defaultSearchEligible: record.defaultSearchEligible,
    disposition: decision
      ? "excluded-from-default-search"
      : "human-review-candidate",
    decisionRule: decision?.ruleId ?? null,
    flags: [...flags].sort(),
    reasons,
  };
}).filter((candidate) => candidate.flags.length > 0);

const flagCounts = Object.fromEntries(
  [...new Set(scopeCandidates.flatMap((candidate) => candidate.flags))]
    .sort()
    .map((flag) => [
      flag,
      scopeCandidates.filter((candidate) => candidate.flags.includes(flag))
        .length,
    ]),
);
const explicitExclusions = records.filter((record) =>
  record.defaultSearchEligible === false
);
const pendingCandidates = scopeCandidates.filter((candidate) =>
  candidate.disposition === "human-review-candidate"
);
const scopeReport = {
  reportVersion: 2,
  asOf,
  recordsInspected: records.length,
  candidateCount: scopeCandidates.length,
  pendingCandidateCount: pendingCandidates.length,
  explicitlyExcludedCount: explicitExclusions.length,
  defaultEligibleCount: records.length - explicitExclusions.length,
  policy: {
    defaultOpportunitySignals: [
      "eligibility-restricted",
      "selective",
      "time-limited",
      "material-financial-value",
      "privileged-access",
      "funding",
      "mentorship",
      "placement",
      "recognition",
      "defined-audience-support",
      "difficult-to-discover",
    ],
    action:
      "Only explicit, versioned scope decisions change default search eligibility. Heuristic candidates remain human-review-only.",
  },
  flagCounts,
  decisionRules: manifest.rules.map((rule) => ({
    id: rule.id,
    reasonCode: rule.reasonCode,
    records: rule.expectedMatches,
  })),
  candidates: scopeCandidates,
};
await writeFile(
  join(reportDirectory, "catalog-scope-audit.json"),
  `${JSON.stringify(scopeReport, null, 2)}\n`,
);
const scopeMarkdown = `# Catalogue scope audit\n\n` +
  `As of ${asOf}, the audit inspected ${records.length} records. ${explicitExclusions.length} explicit decisions remove resources from default opportunity search while preserving their records and Git history. ${pendingCandidates.length} flagged records still require human source review; a heuristic flag is not an editorial decision.\n\n` +
  `## Inclusion policy\n\nA default opportunity should have at least one meaningful signal: restricted eligibility, selection, a time window, material financial value, privileged access, funding, mentorship, placement, recognition, support for a defined audience, or information that is difficult to discover through normal product navigation. Resources and ordinary free products remain typed records outside default opportunity search.\n\n` +
  `## Explicit decisions\n\n| Decision rule | Records |\n| --- | ---: |\n${
    manifest.rules.map((rule) => `| ${rule.id} | ${rule.expectedMatches} |`)
      .join("\n")
  }\n\n` +
  `## Heuristic findings\n\n| Review flag | Records |\n| --- | ---: |\n${
    Object.entries(flagCounts).map(([flag, count]) => `| ${flag} | ${count} |`)
      .join("\n")
  }\n\n` +
  `The machine-readable report contains every candidate, explicit disposition, decision rule, and reason. Re-entry into default search requires current human source review.\n`;
await writeFile(
  join(reportDirectory, "catalog-scope-audit.md"),
  scopeMarkdown,
);

const duplicates = [
  ...[...urlGroups.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([key, group]) => ({
      kind: "canonical-url",
      key,
      confidence: 1,
      ids: group.map((record) => record.id),
      action: group.every((record) =>
          record.defaultSearchEligible === false
        )
        ? "known-excluded-group"
        : "human-review",
    })),
  ...[...providerTitleGroups.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([key, group]) => ({
      kind: "provider-title",
      key,
      confidence: 0.98,
      ids: group.map((record) => record.id),
      action: "human-review",
    })),
  ...[...eligibilityGroups.entries()]
    .filter(([, group]) => group.length >= 10)
    .map(([key, group]) => ({
      kind: "repeated-eligibility",
      key,
      confidence: 0.6,
      ids: group.map((record) => record.id),
      action: "editorial-source-review",
    })),
];
await writeFile(
  join(reportDirectory, "duplicate-candidates.json"),
  `${JSON.stringify({
    reportVersion: 2,
    asOf,
    candidateGroups: duplicates.length,
    candidates: duplicates,
  }, null, 2)}\n`,
);

const asOfTime = Date.parse(`${asOf}T23:59:59Z`);
const stale = records.filter((record) =>
  asOfTime - Date.parse(`${record.reviewDate}T00:00:00Z`) > 180 * 86400_000
).map((record) => ({
  id: record.id,
  reviewDate: record.reviewDate,
  daysSinceReview: Math.floor(
    (asOfTime - Date.parse(`${record.reviewDate}T00:00:00Z`)) / 86400_000,
  ),
  status: record.status,
}));
await writeFile(
  join(reportDirectory, "stale-records.json"),
  `${JSON.stringify({
    reportVersion: 2,
    asOf,
    reviewTargetDays: 180,
    records: stale,
  }, null, 2)}\n`,
);

const recent = records.length - stale.length;
const duplicateUrlRecords = new Set(
  [...urlGroups.values()]
    .filter((group) => group.length > 1)
    .flatMap((group) => group.map((record) => record.id)),
).size;
const duplicateProviderTitleRecords = new Set(
  [...providerTitleGroups.values()]
    .filter((group) => group.length > 1)
    .flatMap((group) => group.map((record) => record.id)),
).size;
const genericTextRecords = new Set([
  ...genericEligibilityIds,
  ...formulaicDescriptionIds,
]).size;
const incompleteGeography = records.filter((record) =>
  !record.regions.length ||
  (record.regions.length === 1 && record.regions[0] === "Global")
).length;
const uncertain = records.filter((record) =>
  ["unconfirmed", "disputed"].includes(record.status)
).length;
const automatedImportLikely = records.filter((record) =>
  record.submissionType === "maintainer"
).length;
const metric = (count: number) => ({
  count,
  percentage: Number(((count / records.length) * 100).toFixed(2)),
});
const sourceAudit = await readFile(
  join(reportDirectory, "source-audit.json"),
  "utf8",
).then((value) => JSON.parse(value) as SourceAuditSummary).catch(() => null);

const networkMetrics = sourceAudit
  ? sourceAuditMetrics(sourceAudit)
  : {
      brokenLinkRate: {
        status: "not-measured" as const,
        reason:
          "Network source audit was not available when this deterministic report was generated.",
      },
      redirectRate: {
        status: "not-measured" as const,
        reason:
          "Network source audit was not available when this deterministic report was generated.",
      },
    };

const qualityReport = {
  reportVersion: 2,
  asOf,
  recordsInspected: records.length,
  metrics: {
    defaultSearchEligible: metric(
      records.filter((record) => record.defaultSearchEligible !== false).length,
    ),
    explicitlyExcludedFromDefault: metric(explicitExclusions.length),
    recentlyReviewed: metric(recent),
    recordsOverdueForReview: metric(stale.length),
    structuredDeadlines: metric(
      records.filter((record) => record.structuredDeadline).length,
    ),
    applicationUrls: metric(
      records.filter((record) => record.applicationUrl).length,
    ),
    providerSpecificEligibility: metric(
      records.length - genericEligibilityIds.size,
    ),
    multipleEvidenceLinks: metric(
      records.filter((record) => record.evidenceUrlCount > 1).length,
    ),
    duplicateUrlRecords: metric(duplicateUrlRecords),
    duplicateProviderTitleRecords: metric(duplicateProviderTitleRecords),
    genericTextRecords: metric(genericTextRecords),
    brokenLinkRate: networkMetrics.brokenLinkRate,
    redirectRate: networkMetrics.redirectRate,
    uncertainStatus: metric(uncertain),
    incompleteGeography: metric(incompleteGeography),
    humanReviewProvenance: metric(
      records.filter((record) =>
        record.reviewState === "human-reviewed" &&
        record.reviewMethod === "manual-source-review"
      ).length,
    ),
    automatedImportLikely: metric(automatedImportLikely),
    requiresManualSourceReview: metric(
      new Set([
        ...pendingCandidates.map((item) => item.id),
        ...stale.map((item) => item.id),
      ]).size,
    ),
  },
  interpretation:
    "Coverage counts are descriptive only. Explicit scope decisions affect default discovery; heuristics never mutate records.",
};
await writeFile(
  join(reportDirectory, "data-quality.json"),
  `${JSON.stringify(qualityReport, null, 2)}\n`,
);
const qualityMarkdown =
  `# Data quality report\n\nAs of ${asOf}, ${records.length} mixed v1/v2 records were inspected. Coverage totals are descriptive and are not pass/fail quotas.\n\n| Metric | Result |\n| --- | ---: |\n` +
  Object.entries(qualityReport.metrics).map(([name, value]) =>
    "count" in value
      ? `| ${name} | ${value.count} (${value.percentage}%) |`
      : `| ${name} | ${value.status} |`
  ).join("\n") +
  `\n\nNetwork rates use the most recent checked-in source audit when available. Blocked and ambiguous automated requests are tracked separately from confirmed broken links. Explicit exclusions preserve history and require human review before re-entry.\n`;
await writeFile(
  join(reportDirectory, "data-quality.md"),
  qualityMarkdown,
);

const requiresReviewIds = new Set([
  ...pendingCandidates.map((item) => item.id),
  ...stale.map((item) => item.id),
]);
const humanReviewQueue = records
  .filter((record) => requiresReviewIds.has(record.id))
  .map((record) => {
    const priority = reviewPriority(record);
    return {
      id: record.id,
      provider: record.provider,
      title: record.title,
      status: record.status,
      resourceType: record.resourceType,
      defaultSearchEligible: record.defaultSearchEligible,
      score: priority.score,
      priorityReasons: priority.reasons,
    };
  })
  .sort((a, b) =>
    b.score - a.score ||
    a.provider.localeCompare(b.provider) ||
    a.title.localeCompare(b.title) ||
    a.id.localeCompare(b.id)
  );

await writeFile(
  join(reportDirectory, "human-review-queue.json"),
  `${JSON.stringify({
    reportVersion: 1,
    asOf,
    recordsQueued: humanReviewQueue.length,
    policy: [
      "default-search-eligible",
      "material-or-selective-resource-type",
      "current-or-actionable-status",
      "provider-source-coverage",
      "structured-deadline",
      "application-url",
    ],
    note:
      "This queue prioritizes editorial work only. Queue position is not a review event and does not confer human-reviewed or verified status.",
    records: humanReviewQueue,
  }, null, 2)}\n`,
);
await writeFile(
  join(reportDirectory, "human-review-queue.md"),
  [
    "# Human review queue",
    "",
    `As of ${asOf}, ${humanReviewQueue.length} records are queued for human source review.`,
    "",
    "The order prioritizes default-search eligibility, materially valuable/selective resource types, current or actionable status, stronger source coverage, structured deadlines, and direct application URLs.",
    "",
    "Queue position is work planning only. It is not a review event and does not make a record human-reviewed or verified.",
    "",
    "| Priority | Record | Provider | Status | Reasons |",
    "| ---: | --- | --- | --- | --- |",
    ...humanReviewQueue.slice(0, 250).map((record, index) =>
      `| ${index + 1} | ${record.id} | ${record.provider.replaceAll("|", "\\|")} | ${record.status} | ${record.priorityReasons.join(", ")} |`
    ),
    "",
  ].join("\n"),
);

console.log(
  `Generated mixed-schema scope and quality reports for ${records.length} records; ${explicitExclusions.length} excluded from default search.`,
);