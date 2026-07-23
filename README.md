# PerkCommons Data

The canonical, version-controlled public dataset behind PerkCommons. The site is
one consumer; anyone may reuse the published facts under CC0 1.0.

## Contribute

1. Copy `opportunities/_template.json` to `opportunities/<stable-id>.json`.
2. Use an immutable lowercase ID such as `provider-program`.
3. Cite the provider's official page wherever possible.
4. Choose one primary `category`, zero or more matching `subcategories`, and
   independent discovery `tags`.
5. Run `npm ci && npm test`.
6. Open a pull request and explain the evidence checked.

Publication means that a reviewer found credible evidence on the stated review
date. It does not guarantee eligibility, acceptance, value, or continuing
availability.

Default opportunity discovery is intentionally narrower than the complete open
dataset. Ordinary free products, consumer loyalty memberships, normal public
beta channels, generic communities, public datasets, and ungrouped bundle
components remain preserved as typed resources but are excluded from default
results. The versioned decisions and reasons live in
[`editorial/scope-decisions.json`](editorial/scope-decisions.json).

See [CONTRIBUTING.md](CONTRIBUTING.md) and
[schema/opportunity.schema.json](schema/opportunity.schema.json). Category
labels, descriptions, subcategories, and legacy aliases are maintained in
[taxonomy/opportunity-taxonomy.json](taxonomy/opportunity-taxonomy.json).

## Catalog checks

Run the schema and taxonomy tests before submitting data changes:

```sh
npm ci
npm test
npm run scope:check
npm run coverage
npm run reports -- --as-of YYYY-MM-DD
```

Coverage is descriptive and has no minimum quota. A smaller category of strong,
current, evidence-backed records does not fail. Quality reporting tracks review
age, structured fields, duplicate/generic text, geography, provenance and
manual-review needs. One opportunity may count toward multiple subcategories
only when each assignment accurately describes the program.

Use `npm run audit:sources` to verify published source and official URLs. A
failed URL makes the command fail. Some official sites reject automated requests;
the audit reports those separately for manual browser review.
