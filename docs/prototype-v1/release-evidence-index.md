# Prototype V1 release evidence index

Status: sanitized publication index. No raw/protected data, credentials, or temporary logs archived.

## R6 realization checkpoint (2026-10-14, branch `prototype-v1`)

- Tested code SHA: `c921fb895154c712de0dbd52c526b6741187e1db` (R6 code + tests + harness + docs delta; no application behavior change). Preflight R6 SHA: `b46de42` (docs-only). Push without force; repo verified PRIVATE.
- Source package (local, git-ignored `.release-evidence/source-release/`): `transum-in-nexus-source-c921fb895154.zip`, 949,529 bytes, 376 tracked files, allowlist match, exact-value secret scan PASS, SHA-256 `1f117c315da05b6d47f570172bc6c0d90056e86b04ae2626757db62c352512c2`. Source-only: no `.env`, caches, data, logs, or runtime state.
- Executed R6 evidence (local logs, not archived): fresh 20/20 R1 walkthrough; mobile 390×844 smoke (no overflow/errors/failed requests); Tier A 12/12; standard integration 9/31; multi-OD 11 corridors; G2/GPS/F04/M5/M6-fixed/M7/handoff; CP2 + CP3-rerun `DROP_SUCCESS`; `pnpm check` exit 0; `pnpm security:scan` PASS. One CP3 run failed HTTP 500 at second-context activation; scratch retained, root cause `NOT_VERIFIED`. Earlier failed-run scratch DBs follow the same fail-closed retention rule and are never auto-dropped.
- Remaining `NOT_VERIFIED`: physical GPS, browser R2 corridor, browser expired-session path, S09 live `NO_PATH`/`NO_VALID_ALTERNATIVE`. Blockers unchanged: typed address auth, named POI data, pedestrian validation, provider integration, Tier B environment.

## R5 G0–G5 checkpoint (2026-10-14, branch `prototype-v1`)

- Tested G5 code SHA: `31772e2ddc0ba7815e20a4bc9babab56cd14c922`. Documentation/release checkpoint SHA: `b46de42306960d8b6876243833089f6eb3b67d7a` (four documents only; identical executable code). Preflight R6 local = remote `refs/heads/prototype-v1`. Historical tests are not relabeled as executed at the documentation SHA. Repository stays PRIVATE; no force-push or history rewrite.
- Commits this checkpoint: `06fa181` (G1 lineage/guards), `a40c19b` (G1/G2 hardening + F-03 proof), `31772e2` (G4 LEVEL 1 + G5 integrated rerun). Working tree clean after push; `apps/web/next-env.d.ts` reverted whenever the dev harness drifted it.
- Executed gates, all exit 0 unless noted: isolated CP3 recovery browser (G1-D stale races + generation parity, scratch `DROP_SUCCESS`); Tier A 12/12 (`data:lightweight-acceptance`, `DROP_SUCCESS`); 9-suite standard integration 9/9, 31 tests; web unit 40/40; session/guards 11/11; G2 preference proof; R4 handoff/F-01/F-02/F-04/F-05, GPS lifecycle, r1 20/20, M7 20/20; `pnpm check` (lint/typecheck/unit/contracts/OpenAPI/types/format/builds); `pnpm security:scan` PASS (369 tracked, 13 client; ignored `.next` dev-cache private matches excluded, never uploaded).
- Honest boundaries retained: full G1 edge matrix `NOT_VERIFIED`; typed address `BLOCKED_BY_AUTHORIZATION`; provider integration `BLOCKED_BY_DATA`/auth; Tier B snapshot `BLOCKED_BY_ENVIRONMENT`; named Kemang POI `BLOCKED_BY_DATA`; GPS hardware `NOT_VERIFIED`; S09 `NOT_VERIFIED` (exit 1, genuine OTP fallback).
- Durable Bahasa Indonesia report: `docs/prototype-v1/LAPORAN-RILIS-PROTOTYPE-V1.md`. Local raw logs remain git-ignored under `.release-evidence/` (`G1/`, `G2/`, `R4/`, `CP3/`); they are references, not archived artifacts.

## Review record

- Review timestamp: `2026-10-13T14:22:15+07:00` (local `WIB`; wall-clock command output)
- Current product repository: `https://github.com/Justindwinata/TRANSUMIN-NEXUS.git`
- Publication-review base commit: `04376a0978a4decc7f0e14c48bf95d6ab1e9e284`; R3 release commits listed in final handoff
- Historical source repository: `/Users/justindwinata/Developer/TRANSUMIN-NEXUS`
- Historical source branch: `prototype-v1-generalized-journey`
- Historical source commit: `de3677273292398ffeb8af7bf681480bdc3379a2`
- Authorization basis: R2 Product Owner explicitly authorized restoring canonical product schema/data contract files. Restoration excludes raw/protected data.
- Exact-match result: `9/9` files matched historical blobs byte-for-byte.

## Exact nine sanitized blobs

Six schema files:

| Path                                                                   | SHA-256                                                            |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `data/manifests/dataset-manifest.schema.json`                          | `2b9eb1bcee4cd146a8149b1add0ee0e501ed6ec5feabe4cbbe31fd3838792c4f` |
| `data/manifests/operational-data-source-capability-matrix.schema.json` | `f091b71cc2bbd8e0106d175f5e0f1546703aeabd9a0a79365b8378a0f03c5f96` |
| `data/manifests/phase1-canonical-transit-snapshot.schema.json`         | `52b062f6aceb2624fff5c12149e88f3a7b5e45fc4a2a2550c8c0b98ad92243b5` |
| `data/manifests/phase1-operator-coverage.schema.json`                  | `53b251b62e2b6d7cf28ff7f4af04a6625ca982de900b2282db560bd9596c4f6b` |
| `data/manifests/phase2-base-network-snapshot.schema.json`              | `3a5cd6d5d92b480336687e7110eee05bee29c3c19d46dcd8b1d02c0d528b015e` |
| `data/manifests/phase2a-spatial-snapshot.schema.json`                  | `7d412c2ccbaeb42a0d0d012bf2850c9ca6b1ab7694ee9e5e44fd352280f5f3f5` |

Three data-manifest records:

| Path                                                                                | SHA-256                                                            |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `data/manifests/OPERATIONAL-DATA-SOURCE-CAPABILITY-MATRIX.json`                     | `55196ce88aafa6966d2635ea95040964648a002f3477c6b6e13064396dedb34e` |
| `data/manifests/PHASE-1-OPERATOR-COVERAGE.json`                                     | `9a164c15fcedc4944c49a28f3fd8e12c3d6937a8e8743f83e615d99090ad5737` |
| `data/manifests/transjakarta-gtfs-63b4fb14d9af-mobilitydata-validator-summary.json` | `752f03bf736a681e111a05277d84bba9f7a1413caeade9ba00aa06f38490e651` |

Other tracked manifests remain outside this nine-blob publication review. Raw GTFS/OSM, OTP graph, JAR, JRE, and generated feeds remain Git-ignored and are not archived here.

## Evidence manifest

| Check                                                          | Exact command                                                                                                                                     |                           Exit |                                                                                 Count/result |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | -----------------------------: | -------------------------------------------------------------------------------------------: |
| Current revision                                               | `git rev-parse HEAD`                                                                                                                              |                              0 |                                                   `04376a0978a4decc7f0e14c48bf95d6ab1e9e284` |
| Historical revision lookup                                     | `git -C /Users/justindwinata/Developer/TRANSUMIN-NEXUS show -s --format=fuller de3677273292398ffeb8af7bf681480bdc3379a2`                          |                              0 |                                          1 commit; branch `prototype-v1-generalized-journey` |
| Historical blob comparison + JSON parse + secret-pattern audit | read-only Python audit comparing nine paths with `git show`, parsing JSON, and checking private-key/token/credential-url/assigned-secret patterns |                              0 |                         9 files; 9 JSON parsed; 9 exact matches; all four pattern counts `0` |
| Product contract validation                                    | `pnpm data:contracts:check`                                                                                                                       |                              0 |                                                           11 validated records (R2 evidence) |
| DB migration inventory                                         | `find apps/api/src/infrastructure/database/migrations -name '*.ts'`                                                                               |                              0 |                                                                   17 migration files present |
| DB migration execution documented                              | `pnpm db:up` → `pnpm db:migrate` → `pnpm db:status` sourced from ignored `.env`                                                                   |   0 (verified in this session) | 17 ordered migrations; `db:status` confirmed all `applied`; bootstrap runbook text stated 12 |
| API readiness URL                                              | `curl http://127.0.0.1:3001/health/ready`                                                                                                         | 200 (verified in this session) |               Verified live response keys: `dependencies,service,status` at review timestamp |
| Web proxy URL                                                  | `GET http://127.0.0.1:3000/api/passenger/config`                                                                                                  | 200 (verified in this session) |                                       Verified live response key: `data` at review timestamp |
| OTP URL                                                        | `POST http://127.0.0.1:8080/otp/gtfs/v1` with GraphQL `{__typename}`                                                                              | 200 (verified in this session) |                               Verified GraphQL response contained `data` at review timestamp |

Temporary acceptance and audit logs are evidence references only. They are **NOT ARCHIVED** by this index. No log hash is presented as durable artifact hash.

### Local persistent verification records (git-ignored, `.release-evidence/R3/`)

Sanitized durable record for R3 acceptance lives in `docs/prototype-v1/R3-RELEASE-EVIDENCE.md` (committed). Local ignored copies keep sanitized artifacts at `.release-evidence/R3/`:

- `final.json` (workflow artifact): `a202e43f948d2006fedff4f1cf912f655e0fdb1d69bc126e37180cd7ef34ca44`
- `r3-check.log`: `9384dca5c7810618ef481128122cb70413c3d521b42864afe4d859451702f168`
- `r3-security.log`: `91e4f7c03fdc68683a78c2f9e8061634146092d02edfba2638ad26bf0cb05d59`
- `r3-m5.log`: `fe6464ba7258c31bd4b565e3b9a9a0fff2298c1069fe0bee724dbaef687fc778`
- `r3-m6.log`: `39e607481565adfc285f562189d2b7179ee7f8dc1205e2da46be0481af98a1f8`
- `r3-m7.log`: `d9fdf03b8fb67fb340ed57f1a5e34a6d07ed989632080d928ea96acb7cb0c9be`
- `r3-gps.log`: `31ba0149783c87a433d3950af532536fb976688b3385beba631a8347cb8d3efe`
- `r3-s01.log`: `081cb1dd32dbfb9d68a3fc9ca8144770f5059d595bd311c12a7427398e91eeee`

Remote logs `r3-workflow.log` and `r3-s09-rerun.log` remain temporary and are not archived; their SHA-256 values are carried in `R3-RELEASE-EVIDENCE.md` only.

## Runtime identity

- Database migrations at current commit: 17 ordered migration files live under `apps/api/src/infrastructure/database/migrations/`; `pnpm db:status` confirms every migration `applied` against the isolated product database on 2026-10-13 (`14:22 WIB`). Runbook text previously stated 12 migrations and is now updated within this same review. Isolated product volume/port guidance (`transum-in-nexus-product-postgres-data`, `127.0.0.1:5435`) remains unchanged.
- Network snapshot: `43fb9a29-0c89-5c72-8826-e3dc2adcfb1f`
- OTP graph SHA-256: `ad9fdd3ea0308dcf033f51b43e027dd3ffa10166ef130f9512e3a9e643331574`
- Router-input manifest SHA-256: `1f493716d20ad5ffa2e3628ece67f2511235f2abfacef4cd7b2b2af9f73dfb77`
- OTP runtime manifest records OTP `2.10.0`, but runtime binaries and graph are local Git-ignored inputs, not durable publication artifacts.
- Database uses isolated product volume/port guidance: `transum-in-nexus-product-postgres-data`, `127.0.0.1:5435`; protected legacy volume is out of scope. Sourced `.env` was loaded but never printed or committed.

## Safety boundary

This index records hashes and provenance for sanitized tracked contract files only. It does not authorize ingest, expose credentials, restore protected volumes, or represent raw/protected data as published. R3 capability and delivery ledgers were updated separately from this publication review using executed acceptance evidence.
