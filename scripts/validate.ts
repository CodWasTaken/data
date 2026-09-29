import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import {
  loadTaxonomy,
  normalizeCategory,
  taxonomySelectionError,
} from "./taxonomy";
import { validateOpportunityV2 } from "./schema-v2";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const schema = JSON.parse(await readFile(join(root, "schema/opportunity.schema.json"), "utf8"));
const taxonomySchema = JSON.parse(
  await readFile(
    join(root, "taxonomy/opportunity-taxonomy.schema.json"),
    "utf8",
  ),
);
const taxonomy = await loadTaxonomy(root);
const ajv = new Ajv2020({ allErrors: true });
addFormats(ajv);
const validate = ajv.compile(schema);
const validateTaxonomy = ajv.compile(taxonomySchema);
if (!validateTaxonomy(taxonomy)) {
  throw new Error(
    `Invalid opportunity taxonomy: ${ajv.errorsText(validateTaxonomy.errors)}`,
  );
}
const categoryIds = new Set(taxonomy.categories.map((item) => item.id));
if (categoryIds.size !== taxonomy.categories.length) {
  throw new Error("Opportunity taxonomy contains duplicate category IDs.");
}
for (const category of taxonomy.categories) {
  const subcategoryIds = category.subcategories.map((item) => item.id);
  if (new Set(subcategoryIds).size !== subcategoryIds.length) {
    throw new Error(`Category '${category.id}' contains duplicate subcategory IDs.`);
  }
}
for (const target of Object.values(taxonomy.legacyCategoryAliases)) {
  if (!categoryIds.has(target)) {
    throw new Error(`Legacy category alias targets unknown category '${target}'.`);
  }
}
const files = (await readdir(join(root, "opportunities"))).filter((name) => name.endsWith(".json") && !name.startsWith("_"));
const ids = new Set<string>();
const v2ProviderTitles = new Map<string, string>();
const v2CanonicalUrls = new Map<
  string,
  { id: string; relationshipIds: Set<string> }
>();
let failed = false;
// Accept today's date in every civil timezone while still rejecting true future dates.
const latestCivilDate = new Date(Date.now() + 14 * 60 * 60 * 1000).toISOString().slice(0, 10);

for (const file of files) {
  const rawOpportunity = JSON.parse(await readFile(join(root, "opportunities", file), "utf8"));
  if (rawOpportunity.schemaVersion !== undefined && rawOpportunity.schemaVersion !== "2.0") {
    failed = true;
    console.error(`${file}: unsupported schemaVersion '${String(rawOpportunity.schemaVersion)}'`);
    continue;
  }
  if (rawOpportunity.schemaVersion === "2.0") {
    const result = validateOpportunityV2(rawOpportunity);
    if (!result.valid) {
      failed = true;
      console.error(`${file}: ${result.errors.join("\n  ")}`);
    }
    if (rawOpportunity.id !== file.replace(/\.json$/, "")) {
      failed = true;
      console.error(`${file}: filename must match id '${rawOpportunity.id}'`);
    }
    if (ids.has(rawOpportunity.id)) {
      failed = true;
      console.error(`${file}: duplicate id '${rawOpportunity.id}'`);
    }
    ids.add(rawOpportunity.id);
    const providerTitle = `${String(rawOpportunity.provider).normalize("NFKC").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()}|${String(rawOpportunity.title).normalize("NFKC").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()}`;
    const previousPair = v2ProviderTitles.get(providerTitle);
    const explicitlyRelated = rawOpportunity.changeHistory?.supersedes?.includes(previousPair) || rawOpportunity.changeHistory?.previousIds?.includes(previousPair);
    if (previousPair && !explicitlyRelated) {
      failed = true;
      console.error(`${file}: duplicate normalized provider/title pair also used by '${previousPair}'`);
    }
    v2ProviderTitles.set(providerTitle, rawOpportunity.id);
    if (rawOpportunity.canonicalUrl) {
      const url = new URL(rawOpportunity.canonicalUrl);
      url.hash = "";
      const normalizedUrl = url.toString();
      const relationshipIds = new Set<string>([
        ...(rawOpportunity.changeHistory?.supersedes ?? []),
        ...(rawOpportunity.changeHistory?.supersededBy ?? []),
        ...(rawOpportunity.changeHistory?.previousIds ?? []),
      ]);
      const previousUrl = v2CanonicalUrls.get(normalizedUrl);
      const urlRelationship =
        previousUrl &&
        (
          relationshipIds.has(previousUrl.id) ||
          previousUrl.relationshipIds.has(rawOpportunity.id) ||
          [...relationshipIds].some((id) =>
            previousUrl.relationshipIds.has(id)
          )
        );
      if (previousUrl && !explicitlyRelated && !urlRelationship) {
        failed = true;
        console.error(
          `${file}: duplicate canonical URL also used by '${previousUrl.id}'`,
        );
      }
      v2CanonicalUrls.set(normalizedUrl, {
        id: rawOpportunity.id,
        relationshipIds,
      });
    }
    continue;
  }
  const opportunity = {
    ...rawOpportunity,
    category: normalizeCategory(rawOpportunity.category, taxonomy),
  };
  if (!validate(opportunity)) {
    failed = true;
    console.error(`${file}: ${ajv.errorsText(validate.errors, { separator: "\n  " })}`);
  }
  const selectionError = taxonomySelectionError(
    opportunity.category,
    opportunity.subcategories,
    taxonomy,
  );
  if (selectionError) {
    failed = true;
    console.error(`${file}: ${selectionError}`);
  }
  if (opportunity.id !== file.replace(/\.json$/, "")) {
    failed = true;
    console.error(`${file}: filename must match id '${opportunity.id}'`);
  }
  if (ids.has(opportunity.id)) {
    failed = true;
    console.error(`${file}: duplicate id '${opportunity.id}'`);
  }
  ids.add(opportunity.id);
  if (opportunity.reviewDate > latestCivilDate) {
    failed = true;
    console.error(`${file}: reviewDate cannot be in the future`);
  }
}

if (files.length === 0) {
  throw new Error("The dataset must contain at least one published opportunity.");
}
if (failed) process.exit(1);
console.log(`Validated ${files.length} opportunities.`);
