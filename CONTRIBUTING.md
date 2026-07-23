# Contributing

Contributions are welcome from individuals, providers, and communities under the
same review rules. Do not include personal data, referral links, secrets, or
claims that the cited source does not support.

## Review checklist

- A default opportunity must have at least one material inclusion signal:
  restricted eligibility, selection, a time window, material financial value,
  privileged access, funding, mentorship, placement, recognition, support for
  a defined audience, or information that is difficult to discover through
  normal product navigation.
- Classify ordinary free products, public datasets, general memberships,
  learning resources, and communities as resources. Do not put them into
  default opportunity discovery merely to increase category coverage.
- Prefer the official provider source and link directly to it.
- State eligibility and important limitations in plain language.
- Keep descriptions neutral; avoid marketing superlatives.
- Set `sponsor` only to disclose a current commercial relationship.
- Use `company` for a provider-submitted record and disclose that in the PR.
- Classify what the opportunity is with one primary category. Describe who can
  access it in `eligibility`, not by adding audience categories.
- Use only subcategories listed under the selected primary category in
  `taxonomy/opportunity-taxonomy.json`. Use tags for cross-cutting discovery
  terms such as technologies, audiences, or delivery format.
- Do not edit an existing stable ID when a program is renamed; update its title.
- Archive ended programs with `expired` rather than deleting their history.
- Never turn heuristic audit output directly into removal or publication.
  Scope changes require an explicit, reviewable decision with a reason; run
  `npm run scope:apply` and commit the resulting record changes together.

By contributing factual data, you agree that accepted changes are published
under CC0 1.0.
