import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { auditUrl, sourceUrlsForRecord } from "./source-audit";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const reportDirectory = join(root, "reports");
await mkdir(reportDirectory, { recursive: true });

const categoryIndex = process.argv.indexOf("--category");
const requestedCategory =
  categoryIndex >= 0 ? process.argv[categoryIndex + 1] : undefined;
const asOfIndex = process.argv.indexOf("--as-of");
const asOf = asOfIndex >= 0
  ? process.argv[asOfIndex + 1]
  : new Date().toISOString().slice(0, 10);
if (!asOf || !/^\d{4}-\d{2}-\d{2}$/.test(asOf))
  throw new Error("--as-of must use YYYY-MM-DD");

const candidateFiles = (await readdir(join(root, "opportunities")))
  .filter((name) => name.endsWith(".json") && !name.startsWith("_"))
  .sort();

const queue: Array<{
  id: string;
  file: string;
  field: string;
  url: string;
}> = [];

for (const file of candidateFiles) {
  const raw = JSON.parse(
    await readFile(join(root, "opportunities", file), "utf8"),
  ) as Record<string, unknown>;
  const category = raw.schemaVersion === "2.0"
    ? (raw.classification as Record<string, unknown> | undefined)?.primaryCategory
    : raw.category;
  if (requestedCategory && category !== requestedCategory) continue;
  const id = typeof raw.id === "string" ? raw.id : file.replace(/\.json$/, "");
  for (const source of sourceUrlsForRecord(raw))
    queue.push({ id, file, ...source });
}

if (requestedCategory && queue.length === 0)
  throw new Error(`No opportunity URLs found for category ${requestedCategory}.`);

const work = queue.slice();
const records: Array<{
  id: string;
  file: string;
  field: string;
  url: string;
  finalUrl: string;
  status: string;
  httpStatus: number | null;
  redirects: Array<{ status: number; from: string; to: string }>;
  error: string | null;
}> = [];

await Promise.all(
  Array.from({ length: 8 }, async () => {
    while (work.length > 0) {
      const item = work.shift();
      if (!item) continue;
      const result = await auditUrl(item.url);
      records.push({ ...item, ...result });
    }
  }),
);

records.sort((a, b) =>
  a.id.localeCompare(b.id) ||
  a.field.localeCompare(b.field) ||
  a.url.localeCompare(b.url)
);

const counts = records.reduce<Record<string, number>>((acc, record) => {
  acc[record.status] = (acc[record.status] ?? 0) + 1;
  return acc;
}, {});

const report = {
  reportVersion: 2,
  asOf,
  recordsInspected: new Set(records.map((record) => record.id)).size,
  urlsInspected: records.length,
  counts,
  complete: (counts.ambiguous ?? 0) === 0 && (counts.blocked ?? 0) === 0,
  records,
};
await writeFile(
  join(reportDirectory, "source-audit.json"),
  `${JSON.stringify(report, null, 2)}\n`,
);

const markdown = [
  "# Source URL audit",
  "",
  `As of ${asOf}, the audit checked ${records.length} distinct published source/destination URLs across ${report.recordsInspected} records.`,
  "",
  "| Result | URLs |",
  "| --- | ---: |",
  ...["success", "redirect", "redirect-chain", "blocked", "broken", "ambiguous"]
    .map((status) => `| ${status} | ${counts[status] ?? 0} |`),
  "",
  "Blocked and ambiguous results require manual browser review and are not counted as broken links.",
  "",
].join("\n");
await writeFile(join(reportDirectory, "source-audit.md"), markdown);

console.log(
  `Source audit: ${records.length} URLs; ` +
    `success ${counts.success ?? 0}; redirects ${(counts.redirect ?? 0) + (counts["redirect-chain"] ?? 0)}; ` +
    `blocked ${counts.blocked ?? 0}; broken ${counts.broken ?? 0}; ambiguous ${counts.ambiguous ?? 0}.`,
);

if ((counts.broken ?? 0) > 0) {
  const broken = records
    .filter((record) => record.status === "broken")
    .map((record) => `${record.file} ${record.field}: HTTP ${record.httpStatus} ${record.url}`);
  console.error(broken.join("\n"));
  process.exitCode = 1;
}
