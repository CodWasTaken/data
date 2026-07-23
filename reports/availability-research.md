# Availability research

Generated: 2026-07-23T21:05:26.354Z

This fork-only audit evaluated 1068 canonical records against 1050 distinct HTTPS source URLs. It records AI-assisted research, not manual approval. Automatic publication is not allowed.

## Decisions

| Status | Records |
| --- | ---: |
| closed | 27 |
| limited | 2 |
| open | 304 |
| rolling | 10 |
| temporarily-unavailable | 1 |
| unconfirmed | 720 |
| upcoming | 3 |
| waitlist | 1 |

Unconfirmed is the correct outcome when a provider blocks access, the page is ambiguous, a time-bound program lacks a current application statement, or evidence conflicts. The complete per-record evidence ledger is in `availability-research.json`.

## Context corrections

These 17 decisions correct page-wide phrase matches that lose date or listing context.

| Record | Status | Reason |
| --- | --- | --- |
| `amazon-sustainability-accelerator` | closed | The cited 2026 application window closed on 10 July 2026. |
| `aws-activate-cloud-credits` | open | The official page provides current application paths for the Founders and Portfolio packages; an invite-only higher tier does not make the whole program limited. |
| `berkeley-skydeck` | open | The official Batch 23 page says applications are open from 20 July through 21 August 2026. |
| `datadog-preview-features` | unconfirmed | The matched invite-only text describes a dashboard permission, not availability of Datadog preview features. |
| `embl-visitor-programme` | rolling | Current visitor fellowship routes accept applications throughout the year; capacity language does not mean the whole visitor programme is limited. |
| `euro-python-financial-aid` | closed | The official page says in-person applications ended and remote ticket grant applications are closed. |
| `fast-forward-accelerator` | closed | The 2026 cohort has completed and the current accelerator page offers an interest form rather than an open application. |
| `freshworks-for-startups` | open | Current program terms describe signup and review; the invite-only phrase on the original FAQ refers to a partner conference. |
| `github-accelerator` | closed | The official application page is for the 2024 cohort and states that applications closed on 5 March 2024. |
| `issuehunt` | open | The live directory contains public programs; only one of several participation modes is invite-only. |
| `lambda-literary-writers-retreat` | closed | The stored source is a stale 2015 application page, while the provider has already announced the selected 2026 fellows. |
| `neh-media-projects` | closed | The official 2026 deadline was 25 June 2026. |
| `public-art-futures-lab-residency` | closed | The page says applications were open through 10 February 2026, a date that has passed. |
| `remarkable-accelerator` | upcoming | The provider currently accepts expressions of interest and says applicants will be notified when the next application window opens. |
| `resilient-coders-bootcamp` | closed | The provider page gave 10 July 2026 as the extended Fall 2026 application deadline, which has passed. |
| `slack-beta-program` | open | Slack's current instructions allow users to opt into the desktop beta; unrelated invite-only workspace text caused the automatic match. |
| `sundance-documentary-fund` | closed | The official fund page says it is not accepting applications and lists 15 June 2026 as the last deadline. |

## Safety and provenance

- Reviewer method: `ai-assisted-source-research`
- AI-assisted status assignments remain `needs-human-review`.
- No record is marked manually reviewed by this audit.
- Only short evidence excerpts and source hashes are retained; provider page bodies are not copied.
- Suggested statuses require direct evidence or an explicitly documented context decision and are not represented as manual human review. Ambiguous, blocked, conflicting, or unsupported sources remain unconfirmed.
