import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadTaxonomy, normalizeCategory } from "./taxonomy";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const taxonomy = await loadTaxonomy(root);
const files = (await readdir(join(root, "opportunities"))).filter(
  (name) => name.endsWith(".json") && !name.startsWith("_"),
);
const categoryCounts = new Map<string, number>();
const defaultCategoryCounts = new Map<string, number>();
const subcategoryCounts = new Map<string, number>();

for (const file of files) {
  const opportunity = JSON.parse(
    await readFile(join(root, "opportunities", file), "utf8"),
  ) as {
    schemaVersion?: unknown;
    category?: unknown;
    subcategories?: unknown;
    classification?: {
      primaryCategory?: unknown;
      subcategories?: unknown;
      defaultSearchEligible?: unknown;
    };
  };
  const rawCategory = opportunity.schemaVersion === "2.0"
    ? opportunity.classification?.primaryCategory
    : opportunity.category;
  const rawSubcategories = opportunity.schemaVersion === "2.0"
    ? opportunity.classification?.subcategories
    : opportunity.subcategories;
  const category = normalizeCategory(rawCategory, taxonomy);
  if (typeof category !== "string") continue;
  categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1);
  const defaultEligible = opportunity.schemaVersion !== "2.0" ||
    opportunity.classification?.defaultSearchEligible !== false;
  if (defaultEligible) {
    defaultCategoryCounts.set(
      category,
      (defaultCategoryCounts.get(category) ?? 0) + 1,
    );
  }
  if (!Array.isArray(rawSubcategories)) continue;
  for (const subcategory of new Set(rawSubcategories)) {
    if (typeof subcategory !== "string") continue;
    const key = `${category}/${subcategory}`;
    subcategoryCounts.set(key, (subcategoryCounts.get(key) ?? 0) + 1);
  }
}

for (const category of taxonomy.categories) {
  const categoryCount = categoryCounts.get(category.id) ?? 0;
  const defaultCount = defaultCategoryCounts.get(category.id) ?? 0;
  console.log(
    `COUNT ${category.id}: ${defaultCount} default opportunities; ${categoryCount} total records`,
  );
  for (const subcategory of category.subcategories) {
    const count = subcategoryCounts.get(`${category.id}/${subcategory.id}`) ?? 0;
    console.log(`  COUNT ${subcategory.id}: ${count} assignments`);
  }
}

const defaultTotal = [...defaultCategoryCounts.values()].reduce(
  (total, count) => total + count,
  0,
);
console.log(
  `\n${files.length} published records inspected; ${defaultTotal} remain in default opportunity discovery.`,
);
if (process.argv.includes("--enforce")) {
  console.warn("--enforce is deprecated: catalogue quantity is not a quality gate. Run npm run reports for quality metrics.");
}
