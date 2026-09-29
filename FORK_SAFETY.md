# PerkCommons Next fork safety record

This repository is the experimental `CodWasTaken/data` fork of the read-only official `PerkCommons/data` repository. Its active implementation branch is `next/schema-v2`.

The complete cross-repository safety record is maintained in the companion `CodWasTaken/site` fork. Locally, `origin` points to <https://github.com/CodWasTaken/data>, while `upstream` fetches from <https://github.com/PerkCommons/data> and has the invalid push URL `DISABLED`.

The official repositories and all production systems are untouched. No official pull request or production deployment will be created or triggered. Only mocks, placeholders, dry runs, and isolated development configuration may be used; production credentials must never be copied into project artifacts.
