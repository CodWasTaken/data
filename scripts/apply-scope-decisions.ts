import { readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { OpportunityV2, ResourceType } from "../generated/opportunity-v2";
import {
  migrateV1ToV2,
  type OpportunityV1,
} from "./migrate-v1-to-v2";
import { validateOpportunityV2 } from "./schema-v2";

export interface ScopeRule {
  id: string;
  reasonCode: string;
  rationale: string;
  resourceType: ResourceType;
  resourceTypeOverrides?: Record<string, ResourceType>;
  groupTargetsByPrefix?: Record<string, string>;
  match: {
    ids?: string[];
    idPrefixes?: string[];
    excludeIds?: string[];
  };
  expectedMatches: number;
}

export interface ScopeManifest {
  decisionVersion: number;
  decidedAt: string;
  policy: {
    action: "exclude-from-default-search";
    preserveHistory: true;
    requiresHumanSourceReviewBeforeReentry: true;
    note: string;
  };
  rules: ScopeRule[];
}

export interface ExpandedScopeDecision {
  id: string;
  ruleId: string;
  reasonCode: string;
  rationale: string;
  resourceType: ResourceType;
  supersededBy: string | null;
}

export function expandScopeDecisions(
  recordIds: string[],
  manifest: ScopeManifest,
): Map<string, ExpandedScopeDecision> {
  const available = new Set(recordIds);
  const decisions = new Map<string, ExpandedScopeDecision>();
  for (const rule of manifest.rules) {
    const excluded = new Set(rule.match.excludeIds ?? []);
    const matched = recordIds.filter((id) =>
      !excluded.has(id) &&
      (
        (rule.match.ids ?? []).includes(id) ||
        (rule.match.idPrefixes ?? []).some((prefix) => id.startsWith(prefix))
      )
    );
    for (const id of rule.match.ids ?? []) {
      if (!available.has(id)) throw new Error(`${rule.id}: unknown record '${id}'`);
    }
    if (matched.length !== rule.expectedMatches) {
      throw new Error(
        `${rule.id}: expected ${rule.expectedMatches} matches, found ${matched.length}`,
      );
    }
    for (const id of matched) {
      if (decisions.has(id)) {
        throw new Error(`${rule.id}: record '${id}' has more than one scope decision`);
      }
      decisions.set(id, {
        id,
        ruleId: rule.id,
        reasonCode: rule.reasonCode,
        rationale: rule.rationale,
        resourceType: rule.resourceTypeOverrides?.[id] ?? rule.resourceType,
        supersededBy: Object.entries(rule.groupTargetsByPrefix ?? {})
          .find(([prefix]) => id.startsWith(prefix))?.[1] ?? null,
      });
    }
  }
  return decisions;
}

export function applyScopeDecision(
  raw: OpportunityV1 | OpportunityV2,
  decision: ExpandedScopeDecision,
  manifest: ScopeManifest,
): OpportunityV2 {
  const record = raw.schemaVersion === "2.0"
    ? structuredClone(raw)
    : migrateV1ToV2(raw);
  record.classification.resourceType = decision.resourceType;
  record.classification.defaultSearchEligible = false;
  record.classification.reviewState = "needs-human-review";
  record.availability.statusReason =
    `Excluded from default search by scope decision '${decision.ruleId}': ${decision.rationale}`;
  record.changeHistory.updatedAt = `${manifest.decidedAt}T00:00:00.000Z`;
  if (decision.supersededBy) {
    record.changeHistory.supersededBy = [decision.supersededBy];
  }
  record.changeHistory.removalReason =
    `Default-search exclusion (${decision.reasonCode}); record retained as ${decision.resourceType}.`;
  if (record.migration) {
    record.migration.unresolvedFields = record.migration.unresolvedFields.filter(
      (field) => field !== "classification.defaultSearchEligible",
    );
  }
  const validation = validateOpportunityV2(record);
  if (!validation.valid) {
    throw new Error(`${record.id}: ${validation.errors.join("; ")}`);
  }
  return record;
}

async function run(): Promise<void> {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const manifest = JSON.parse(
    await readFile(join(root, "editorial/scope-decisions.json"), "utf8"),
  ) as ScopeManifest;
  const files = (await readdir(join(root, "opportunities")))
    .filter((name) => name.endsWith(".json") && !name.startsWith("_"))
    .sort();
  const decisions = expandScopeDecisions(
    files.map((file) => file.replace(/\.json$/, "")),
    manifest,
  );
  const check = process.argv.includes("--check");
  let stale = 0;
  for (const file of files) {
    const id = file.replace(/\.json$/, "");
    const decision = decisions.get(id);
    if (!decision) continue;
    const path = join(root, "opportunities", file);
    const rawText = await readFile(path, "utf8");
    const raw = JSON.parse(rawText) as OpportunityV1 | OpportunityV2;
    const expected = `${JSON.stringify(
      applyScopeDecision(raw, decision, manifest),
      null,
      2,
    )}\n`;
    if (rawText === expected) continue;
    stale += 1;
    if (!check) await writeFile(path, expected);
  }
  if (check && stale > 0) {
    throw new Error(
      `${stale} scope-classified records are stale; run npm run scope:apply`,
    );
  }
  console.log(
    `${check ? "Checked" : "Applied"} ${decisions.size} explicit scope decisions` +
      `${check ? "" : `; ${stale} records updated`}.`,
  );
}

const isMain =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) await run();
