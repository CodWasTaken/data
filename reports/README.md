# Generated editorial reports

Run `npm run reports -- --as-of YYYY-MM-DD` to regenerate deterministic catalogue scope, data quality, duplicate-candidate, and stale-record reports. Run `npm run migrate:v2` to regenerate the migration dry-run report.

Reports are decision support, not editorial actions. Heuristics must never automatically publish, remove, merge, archive, or reclassify a record. Versioned decisions in `editorial/scope-decisions.json` are the only automated input allowed to set `defaultSearchEligible: false`; each rule has a fixed expected match count and fails when its scope changes.
