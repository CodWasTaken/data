import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { OpportunityV2 } from "../generated/opportunity-v2";
import { validateOpportunityV2 } from "./schema-v2";

type EvidenceType = OpportunityV2["urls"]["evidenceUrls"][number]["type"];
type DeadlineType = OpportunityV2["availability"]["deadlineType"];
type Status = OpportunityV2["availability"]["status"];

export interface StructuredFieldDecision {
  id: string;
  researchedAt?: string;
  confidence: number;
  fields: {
    applicationUrl?: string;
    status?: Status;
    statusReason?: string;
    opensAt?: string;
    closesAt?: string;
    deadlineType?: DeadlineType;
    applicationCycle?: string;
    nextExpectedOpening?: string;
  };
  evidence: Array<{
    type: EvidenceType;
    url: string;
    claim: string;
  }>;
}

export interface StructuredFieldManifest {
  decisionVersion: number;
  researchedAt: string;
  methodology: string;
  decisions: StructuredFieldDecision[];
}

const httpsUrl = (value: string, context: string): void => {
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new Error(`${context}: invalid URL`); }
  if (parsed.protocol !== "https:") throw new Error(`${context}: URL must use HTTPS`);
};

const temporal = (value: string, context: string): void => {
  if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z)?$/.test(value))
    throw new Error(`${context}: invalid temporal value '${value}'`);
};

export function validateStructuredFieldManifest(manifest: StructuredFieldManifest): void {
  if (manifest.decisionVersion !== 1) throw new Error("Unsupported structured-field decision version.");
  if (Number.isNaN(new Date(manifest.researchedAt).valueOf()))
    throw new Error("structured-field researchedAt is invalid.");
  const ids = new Set<string>();
  for (const decision of manifest.decisions) {
    if (ids.has(decision.id)) throw new Error(`Duplicate structured-field decision '${decision.id}'.`);
    ids.add(decision.id);
    if (decision.researchedAt && Number.isNaN(new Date(decision.researchedAt).valueOf()))
      throw new Error(`${decision.id}: researchedAt is invalid.`);
    if (decision.confidence < 0 || decision.confidence > 1)
      throw new Error(`${decision.id}: confidence must be between 0 and 1.`);
    if (!Object.keys(decision.fields).length)
      throw new Error(`${decision.id}: no structured fields were supplied.`);
    if (decision.fields.applicationUrl) httpsUrl(decision.fields.applicationUrl, `${decision.id} applicationUrl`);
    for (const key of ["opensAt", "closesAt", "nextExpectedOpening"] as const) {
      const value = decision.fields[key];
      if (value) temporal(value, `${decision.id} ${key}`);
    }
    if (decision.fields.deadlineType === "fixed" && !decision.fields.closesAt)
      throw new Error(`${decision.id}: fixed deadline requires closesAt.`);
    if (decision.fields.deadlineType && !["fixed", "rolling", "periodic", "unknown", "none"].includes(decision.fields.deadlineType))
      throw new Error(`${decision.id}: invalid deadline type.`);
    for (const evidence of decision.evidence) {
      httpsUrl(evidence.url, `${decision.id} evidence`);
      if (!evidence.claim.trim()) throw new Error(`${decision.id}: evidence claim is required.`);
    }
  }
}

const upsertEvidence = (
  record: OpportunityV2,
  decision: StructuredFieldDecision,
  researchedAt: string,
) => {
  for (const evidence of decision.evidence) {
    const existing = record.urls.evidenceUrls.find(
      (item) => item.url === evidence.url && item.type === evidence.type,
    );
    if (existing) {
      existing.checkedAt = researchedAt;
      existing.claim = evidence.claim;
      continue;
    }
    record.urls.evidenceUrls.push({
      type: evidence.type,
      url: evidence.url,
      checkedAt: researchedAt,
      claim: evidence.claim,
    });
  }
};

export function applyStructuredFieldDecision(
  raw: OpportunityV2,
  decision: StructuredFieldDecision,
  manifest: StructuredFieldManifest,
): OpportunityV2 {
  if (raw.schemaVersion !== "2.0")
    throw new Error(`${decision.id}: structured-field decisions require an existing v2 record.`);
  if (raw.id !== decision.id) throw new Error(`${decision.id}: record ID mismatch.`);
  const record = structuredClone(raw);
  const fields = decision.fields;
  const researchedAt = decision.researchedAt ?? manifest.researchedAt;
  const humanReviewed =
    record.reviewProvenance.reviewedAt !== null &&
    ["human", "human-assisted", "provider-confirmed"].includes(
      record.reviewProvenance.reviewMethod,
    );
  // Human review is authoritative. Once a real moderator has reviewed a record,
  // this automated research manifest must never rewrite its structured fields or provenance.
  if (humanReviewed) return record;
  if (fields.applicationUrl !== undefined) record.urls.applicationUrl = fields.applicationUrl;
  if (fields.status !== undefined) record.availability.status = fields.status;
  if (fields.statusReason !== undefined) record.availability.statusReason = fields.statusReason;
  if (fields.opensAt !== undefined) record.availability.opensAt = fields.opensAt;
  if (fields.closesAt !== undefined) record.availability.closesAt = fields.closesAt;
  if (fields.deadlineType !== undefined) record.availability.deadlineType = fields.deadlineType;
  if (fields.applicationCycle !== undefined) record.availability.applicationCycle = fields.applicationCycle;
  if (fields.nextExpectedOpening !== undefined)
    record.availability.nextExpectedOpening = fields.nextExpectedOpening;

  upsertEvidence(record, decision, researchedAt);
  record.classification.reviewState = "needs-human-review";
  record.reviewProvenance.reviewedAt = null;
  record.reviewProvenance.reviewMethod = "automated-source-research";
  record.reviewProvenance.reviewerReference = "automation:structured-field-research-v1";
  record.reviewProvenance.sourceFetchedAt = researchedAt;
  record.reviewProvenance.sourceHash = null;
  record.reviewProvenance.confidence = decision.confidence;
  record.reviewProvenance.extractorVersion = "structured-field-research/1";
  const claims = new Set(record.reviewProvenance.claimsChecked);
  claims.add("automated-source-access");
  if (fields.applicationUrl !== undefined) claims.add("automated-application-link");
  if (fields.deadlineType !== undefined || fields.closesAt !== undefined)
    claims.add("automated-deadline-structure");
  record.reviewProvenance.claimsChecked = [...claims].sort();
  record.changeHistory.updatedAt = researchedAt;

  if (record.migration) {
    const resolved = new Set<string>();
    if (fields.applicationUrl !== undefined) resolved.add("urls.applicationUrl");
    if (fields.deadlineType !== undefined) resolved.add("availability.deadlineType");
    record.migration.unresolvedFields = record.migration.unresolvedFields.filter(
      (field) => !resolved.has(field),
    );
  }

  const validation = validateOpportunityV2(record);
  if (!validation.valid) throw new Error(`${record.id}: ${validation.errors.join("; ")}`);
  return record;
}

async function run(): Promise<void> {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const manifest = JSON.parse(
    await readFile(join(root, "editorial/structured-field-overrides.json"), "utf8"),
  ) as StructuredFieldManifest;
  validateStructuredFieldManifest(manifest);
  const check = process.argv.includes("--check");
  let changed = 0;
  for (const decision of manifest.decisions) {
    const path = join(root, "opportunities", `${decision.id}.json`);
    const original = await readFile(path, "utf8");
    const raw = JSON.parse(original) as OpportunityV2;
    const expected = `${JSON.stringify(
      applyStructuredFieldDecision(raw, decision, manifest),
      null,
      2,
    )}\n`;
    if (original === expected) continue;
    changed += 1;
    if (!check) await writeFile(path, expected);
  }
  if (check && changed) {
    console.error(`${changed} records do not match structured-field decisions; run npm run structured:apply.`);
    process.exit(1);
  }
  console.log(`${check ? "Checked" : "Applied"} ${manifest.decisions.length} structured-field decisions${check ? "" : `; ${changed} records updated`}.`);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) await run();
