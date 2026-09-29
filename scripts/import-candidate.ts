import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface CandidateFields {
  id: string;
  sourceUrl: string;
  category?: string;
  subcategories?: string[];
  tags?: string[];
  [key: string]: unknown;
}

export async function writeImportCandidate(options: {
  root: string;
  importer: string;
  suggestedFields: CandidateFields;
  rawSourceFields?: unknown;
  confidence?: number;
  extractorVersion?: string;
  fetchedAt?: string;
}): Promise<void> {
  const {
    root,
    importer,
    suggestedFields,
    rawSourceFields = suggestedFields,
    confidence = 0.5,
    extractorVersion = "next-candidate-v1",
    fetchedAt = new Date().toISOString(),
  } = options;
  if (!/^[a-z0-9-]+$/.test(importer)) throw new Error("Importer name must be a slug.");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(suggestedFields.id)) throw new Error("Candidate ID is invalid.");
  if (!(confidence >= 0 && confidence <= 1)) throw new Error("Candidate confidence must be between zero and one.");
  const raw = JSON.stringify(rawSourceFields);
  const candidate = {
    candidateVersion: "1.0",
    id: `${importer}-${suggestedFields.id}`,
    importer,
    sourceUrl: suggestedFields.sourceUrl,
    fetchedAt,
    sourceHash: createHash("sha256").update(raw).digest("hex"),
    extractorVersion,
    rawSourceFields,
    suggestedClassification: {
      primaryCategory: suggestedFields.category ?? null,
      subcategories: suggestedFields.subcategories ?? [],
      topics: suggestedFields.tags ?? [],
    },
    suggestedFields,
    confidence,
    reviewState: "unreviewed",
    humanReview: null,
  };
  const outputDirectory = join(root, "candidates", importer);
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(join(outputDirectory, `${suggestedFields.id}.json`), `${JSON.stringify(candidate, null, 2)}\n`);
}
