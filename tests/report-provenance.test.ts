import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("quality reporting never invents a 1970 review date for missing provenance", async () => {
  const source = await readFile(
    new URL("../scripts/report-catalog-health.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /"1970-01-01"/);
  assert.match(source, /reviewDate: string \| null/);
  assert.match(source, /missingReviewDate/);
});
