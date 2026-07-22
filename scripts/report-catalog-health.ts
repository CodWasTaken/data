import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

interface LegacyRecord {
  id: string; provider: string; title: string; category: string; subcategories?: string[];
  tags: string[]; description: string; eligibility: string; value: string;
  sourceUrl: string; officialUrl: string; status: string; submissionType: string;
  sponsor: boolean; reviewDate: string; regions?: string[];
}
type ScopeFlag =
  | "ordinary-free-product" | "loyalty-program" | "generic-membership" | "public-resource"
  | "formulaic-record" | "duplicate-bundle" | "component-offer" | "generic-eligibility"
  | "low-informational-value";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const reportDirectory = join(root, "reports");
await mkdir(reportDirectory, { recursive: true });
const files = (await readdir(join(root, "opportunities"))).filter((name) => name.endsWith(".json") && !name.startsWith("_"));
const records = await Promise.all(files.map(async (file) => JSON.parse(await readFile(join(root, "opportunities", file), "utf8")) as LegacyRecord));
const asOfIndex = process.argv.indexOf("--as-of");
const asOf = asOfIndex >= 0 ? process.argv[asOfIndex + 1] : new Date().toISOString().slice(0, 10);
if (!asOf || !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new Error("--as-of must use YYYY-MM-DD");

const normalize = (value: string) => value.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const normalizeUrl = (value: string) => {
  const url = new URL(value);
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) if (/^(utm_|ref$|source$)/i.test(key)) url.searchParams.delete(key);
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
const eligibilityGroups = groupBy(records, (record) => normalize(record.eligibility));
const descriptionGroups = groupBy(records, (record) => normalize(record.description));
const urlGroups = groupBy(records, (record) => normalizeUrl(record.officialUrl));
const providerTitleGroups = groupBy(records, (record) => `${normalize(record.provider)}|${normalize(record.title)}`);
const genericEligibilityIds = new Set([...eligibilityGroups.values()].filter((group) => group.length >= 5).flatMap((group) => group.map((record) => record.id)));
const formulaicDescriptionIds = new Set([...descriptionGroups.values()].filter((group) => group.length >= 4).flatMap((group) => group.map((record) => record.id)));

const scopeCandidates = records.map((record) => {
  const text = normalize(`${record.id} ${record.provider} ${record.title} ${record.description} ${record.value}`);
  const flags = new Set<ScopeFlag>();
  const reasons: string[] = [];
  if (record.category === "discounts-perks" && /free plan|free tier|starter plan|free account|free editor|free software|hobby plan|basic plan/.test(text)) {
    flags.add("ordinary-free-product"); reasons.push("Appears to describe a generally available free product or standard plan.");
  }
  if (/rewards|honors|bonvoy|privileges|insider|one key|world of hyatt|all accor/.test(text)) {
    flags.add("loyalty-program"); reasons.push("Name or description resembles an ordinary loyalty program.");
  }
  if (record.category === "mentorship-community" && /community|membership|user group|focus room|accountability/.test(text)) {
    flags.add("generic-membership"); reasons.push("Community or membership may lack selective or material opportunity criteria.");
  }
  if (/open data|data portal|open courses|free courses|documentation|curriculum|public resource|opencourseware/.test(text)) {
    flags.add("public-resource"); reasons.push("Appears primarily to be a public resource rather than an application-based opportunity.");
  }
  if (genericEligibilityIds.has(record.id)) {
    flags.add("generic-eligibility"); reasons.push(`Eligibility text is reused across ${eligibilityGroups.get(normalize(record.eligibility))?.length ?? 0} records.`);
  }
  if (formulaicDescriptionIds.has(record.id) || /current .* requirements/.test(normalize(record.eligibility))) {
    flags.add("formulaic-record"); reasons.push("Text follows a repeated template and needs provider-specific verification.");
  }
  if (record.id.startsWith("github-student-pack-") || record.id.startsWith("aws-activate-")) {
    flags.add("component-offer"); flags.add("duplicate-bundle"); reasons.push("This component belongs to a larger provider bundle that may be better grouped.");
  }
  if (record.description.length < 100 || record.value.length < 20 || record.sourceUrl === record.officialUrl) {
    flags.add("low-informational-value"); reasons.push("Decision-critical detail or distinct evidence/application URL is limited.");
  }
  return { id: record.id, provider: record.provider, title: record.title, category: record.category, flags: [...flags].sort(), reasons };
}).filter((candidate) => candidate.flags.length > 0);

const flagCounts = Object.fromEntries(
  [...new Set(scopeCandidates.flatMap((candidate) => candidate.flags))].sort().map((flag) => [flag, scopeCandidates.filter((candidate) => candidate.flags.includes(flag)).length]),
);
const scopeReport = {
  reportVersion: 1,
  asOf,
  recordsInspected: records.length,
  candidateCount: scopeCandidates.length,
  policy: {
    defaultOpportunitySignals: ["eligibility-restricted", "selective", "time-limited", "material-financial-value", "privileged-access", "funding", "mentorship", "placement", "recognition", "defined-audience-support", "difficult-to-discover"],
    action: "Human review only. Heuristics never delete, archive, reclassify, or publish a record.",
  },
  flagCounts,
  candidates: scopeCandidates,
};
await writeFile(join(reportDirectory, "catalog-scope-audit.json"), `${JSON.stringify(scopeReport, null, 2)}\n`);
const scopeMarkdown = `# Catalogue scope audit\n\n` +
`As of ${asOf}, the audit inspected ${records.length} published v1 records and identified ${scopeCandidates.length} records for human scope review. A flag is not a removal decision. No record was changed, hidden, merged, or deleted.\n\n` +
`## Inclusion policy\n\nA default opportunity should have at least one meaningful signal: restricted eligibility, selection, a time window, material financial value, privileged access, funding, mentorship, placement, recognition, support for a defined audience, or information that is difficult to discover through normal product navigation. Resources and ordinary free products may remain in the wider catalogue while being classified separately from default opportunity search.\n\n` +
`## Findings\n\n| Review flag | Records |\n| --- | ---: |\n${Object.entries(flagCounts).map(([flag, count]) => `| ${flag} | ${count} |`).join("\n")}\n\n` +
`## Representative candidates\n\n${scopeCandidates.slice(0, 40).map((candidate) => `- \`${candidate.id}\` — ${candidate.provider}: ${candidate.title} (${candidate.flags.join(", ")})`).join("\n")}\n\nThe machine-readable report contains every candidate and its reasons. Moderators must inspect current provider evidence before reclassifying, archiving, grouping, or excluding any record from default search.\n`;
await writeFile(join(reportDirectory, "catalog-scope-audit.md"), scopeMarkdown);

const duplicates = [
  ...[...urlGroups.entries()].filter(([, group]) => group.length > 1).map(([key, group]) => ({ kind: "canonical-url", key, confidence: 1, ids: group.map((record) => record.id), action: "human-review" })),
  ...[...providerTitleGroups.entries()].filter(([, group]) => group.length > 1).map(([key, group]) => ({ kind: "provider-title", key, confidence: 0.98, ids: group.map((record) => record.id), action: "human-review" })),
  ...[...eligibilityGroups.entries()].filter(([, group]) => group.length >= 10).map(([key, group]) => ({ kind: "repeated-eligibility", key, confidence: 0.6, ids: group.map((record) => record.id), action: "editorial-source-review" })),
];
await writeFile(join(reportDirectory, "duplicate-candidates.json"), `${JSON.stringify({ reportVersion: 1, asOf, candidateGroups: duplicates.length, candidates: duplicates }, null, 2)}\n`);

const asOfTime = Date.parse(`${asOf}T23:59:59Z`);
const stale = records.filter((record) => asOfTime - Date.parse(`${record.reviewDate}T00:00:00Z`) > 180 * 86400_000).map((record) => ({ id: record.id, reviewDate: record.reviewDate, daysSinceReview: Math.floor((asOfTime - Date.parse(`${record.reviewDate}T00:00:00Z`)) / 86400_000), status: record.status }));
await writeFile(join(reportDirectory, "stale-records.json"), `${JSON.stringify({ reportVersion: 1, asOf, reviewTargetDays: 180, records: stale }, null, 2)}\n`);

const recent = records.length - stale.length;
const duplicateUrlRecords = new Set([...urlGroups.values()].filter((group) => group.length > 1).flatMap((group) => group.map((record) => record.id))).size;
const duplicateProviderTitleRecords = new Set([...providerTitleGroups.values()].filter((group) => group.length > 1).flatMap((group) => group.map((record) => record.id))).size;
const genericTextRecords = new Set([...genericEligibilityIds, ...formulaicDescriptionIds]).size;
const incompleteGeography = records.filter((record) => !record.regions?.length || (record.regions.length === 1 && record.regions[0] === "Global")).length;
const uncertain = records.filter((record) => ["unconfirmed", "disputed"].includes(record.status)).length;
const automatedImportLikely = records.filter((record) => record.submissionType === "maintainer").length;
const metric = (count: number) => ({ count, percentage: Number(((count / records.length) * 100).toFixed(2)) });
const qualityReport = {
  reportVersion: 1, asOf, recordsInspected: records.length,
  metrics: {
    recentlyReviewed: metric(recent), recordsOverdueForReview: metric(stale.length),
    structuredDeadlines: metric(0), applicationUrls: metric(0), providerSpecificEligibility: metric(records.length - genericEligibilityIds.size),
    multipleEvidenceLinks: metric(0), duplicateUrlRecords: metric(duplicateUrlRecords),
    duplicateProviderTitleRecords: metric(duplicateProviderTitleRecords), genericTextRecords: metric(genericTextRecords),
    brokenLinkRate: { status: "not-measured", reason: "Network source audit was not run as part of deterministic report generation." },
    redirectRate: { status: "not-measured", reason: "Redirect destinations require a separate network audit." },
    uncertainStatus: metric(uncertain), incompleteGeography: metric(incompleteGeography),
    humanReviewProvenance: metric(0), automatedImportLikely: metric(automatedImportLikely),
    requiresManualSourceReview: metric(new Set([...scopeCandidates.map((item) => item.id), ...stale.map((item) => item.id)]).size),
  },
  interpretation: "Coverage counts are descriptive only. Categories do not fail because they contain fewer than an arbitrary quota.",
};
await writeFile(join(reportDirectory, "data-quality.json"), `${JSON.stringify(qualityReport, null, 2)}\n`);
const qualityMarkdown = `# Data quality report\n\nAs of ${asOf}, ${records.length} v1 records were inspected. Coverage totals are descriptive and are not pass/fail quotas.\n\n| Metric | Result |\n| --- | ---: |\n` +
Object.entries(qualityReport.metrics).map(([name, value]) => "count" in value ? `| ${name} | ${value.count} (${value.percentage}%) |` : `| ${name} | ${value.status} |`).join("\n") +
`\n\nBroken-link and redirect rates remain unmeasured until the separate network audit is run. Existing v1 records cannot express structured deadlines, application URLs, multiple evidence claims, or public review provenance; those zero values are migration priorities, not claims that the underlying facts are absent.\n`;
await writeFile(join(reportDirectory, "data-quality.md"), qualityMarkdown);
console.log(`Generated scope, quality, duplicate, and stale-record reports for ${records.length} records.`);
