export interface ReviewPriorityInput {
  defaultSearchEligible: boolean | null;
  resourceType: string | null;
  status: string;
  evidenceUrlCount: number;
  structuredDeadline: boolean;
  applicationUrl: string | null;
}

export interface ReviewPriority {
  score: number;
  reasons: string[];
}

const materialTypes = new Set([
  "funding",
  "fellowship",
  "competition",
  "opportunity",
  "event",
]);

const actionableStatuses = new Set([
  "open",
  "rolling",
  "limited",
  "waitlist",
  "upcoming",
]);

export function reviewPriority(record: ReviewPriorityInput): ReviewPriority {
  let score = 0;
  const reasons: string[] = [];

  if (record.defaultSearchEligible !== false) {
    score += 1000;
    reasons.push("default-search-eligible");
  }
  if (materialTypes.has(record.resourceType ?? "")) {
    score += 300;
    reasons.push("material-or-selective-resource-type");
  }
  if (actionableStatuses.has(record.status)) {
    score += 200;
    reasons.push("current-or-actionable-status");
  }
  if (record.evidenceUrlCount > 0) {
    score += 50;
    reasons.push("provider-source-coverage");
  }
  if (record.evidenceUrlCount > 1) {
    score += 50;
    reasons.push("multiple-evidence-links");
  }
  if (record.structuredDeadline) {
    score += 40;
    reasons.push("structured-deadline");
  }
  if (record.applicationUrl) {
    score += 40;
    reasons.push("application-url");
  }

  return { score, reasons };
}
