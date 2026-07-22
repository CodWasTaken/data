import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { writeImportCandidate } from "../scripts/import-candidate";

test("import output is isolated from canonical published records", async () => {
  const root = await mkdtemp(join(tmpdir(), "perkcommons-candidate-"));
  try {
    await writeImportCandidate({
      root,
      importer: "fixture-importer",
      fetchedAt: "2026-07-22T12:00:00.000Z",
      extractorVersion: "fixture-v1",
      confidence: 0.7,
      rawSourceFields: { heading: "Fixture program", malformedOptionalField: null },
      suggestedFields: {
        id: "fixture-program",
        sourceUrl: "https://example.org/program",
        category: "funding",
        subcategories: ["grants"],
        tags: ["research"],
      },
    });
    const candidatePath = join(root, "candidates/fixture-importer/fixture-program.json");
    const candidate = JSON.parse(await readFile(candidatePath, "utf8"));
    assert.equal(candidate.reviewState, "unreviewed");
    assert.equal(candidate.humanReview, null);
    assert.equal(candidate.sourceHash.length, 64);
    await assert.rejects(readdir(join(root, "opportunities")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("every importer uses the candidate writer and contains no hard-coded review date or published output path", async () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const scripts = (await readdir(join(root, "scripts"))).filter((name) => name.startsWith("import-") && name.endsWith(".ts") && name !== "import-candidate.ts");
  assert.ok(scripts.length > 0);
  for (const script of scripts) {
    const source = await readFile(join(root, "scripts", script), "utf8");
    assert.match(source, /writeImportCandidate/);
    assert.doesNotMatch(source, /["']opportunities["']/);
    assert.doesNotMatch(source, /reviewDate\s*:/);
  }
});
