# Product V1 delivery board

Updated: 2026-10-13. Classification: `PROTOTYPE_V1_PARTIAL`. Verified local checkpoint; publication pending commit.

## Provenance

Repository is sanitized product-publication lineage, not original research Git history.

- Source snapshot: historical branch `prototype-v1-generalized-journey` at `de3677273292398ffeb8af7bf681480bdc3379a2`, plus reviewed V1-1 working-tree files.
- Frozen D12 source baseline: `de3677273292398ffeb8af7bf681480bdc3379a2`.
- Private recovery archive remains outside repository under `.transum-r0a-persistent`.
- Runtime OTP graph, JAR, JRE, databases, secrets, raw/processed datasets, logs, screenshots, and build outputs are not versioned here.
- Local evidence paths below refer to `/private/var/folders/9w/27j9sy2n31scrtpmj0tmgwl40000gn/T/opencode/`; logs are not repository artifacts.

## Current milestone

R2 checkpoint records executed evidence only. Classification remains `PROTOTYPE_V1_PARTIAL`. R2 A–H final evidence below; V20/S14 status reflects only remaining evidence assertions within the user-defined 20 browser steps, not other capability rows.

| Milestone                          | Status          | Executed evidence                                                                             | Boundary                                                                         |
| ---------------------------------- | --------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| M0 Publication lineage             | NOT_VERIFIED    | Sanitized lineage documented                                                                  | Publication pending review/commit                                                |
| M1 Real API/runtime                | PASS            | R2 API suite 101/101; production `pnpm check` exit 0; browser runtime harnesses               | Local prototype runtime only                                                     |
| M2 Generalized planning            | PASS            | `r2-multi-od-final.log`, exit 0; 11 corridors including coordinate variant                    | Corridor sample; no POI/general regional proof                                   |
| M3 Interactive map                 | PASS            | R2 workflow map geometry/markers/attribution/timeline case                                    | Full mutation-map directive scope not independently accepted                     |
| M4 Active Journey/GPS/progress     | PASS            | `r2-r1-workflow-final.log`; `r2-gps-final.log`, exit 0                                        | GPS denied/unsupported fallback only; no live persistence/auto-boarding          |
| M5 Passenger reporting             | PASS            | `r2-m5-final.log`: 22/22, exit 0                                                              | Controlled review only; alerts `SIMULATED`                                       |
| M6 Recovery acceptance             | PASS            | `r2-m6-final.log`: 13/13, exit 0; Tier A core/recovery evidence                               | Completed recovery executed; live-OTP NO_PATH not reproducible                   |
| M7 Full directive acceptance       | NOT_VERIFIED    | `r2-m7-final.log`: 20/20; R2 workflow: 14/14                                                  | Exact missing V20/S14 criteria remain; no upgrade                                |
| R2-A Contracts                      | PASS            | `r2-contracts-final.log`: exit 0; 11 validated records                                           | 9 restored source files; exact record count retained                                      |
| R2-B Scoped format                  | PASS            | `r2-format-final.log`: exit 0                                                                    | 37 scoped files and 13 stale unpublished paths fixed                                     |
| R2-C Regression gates               | PASS            | `r2-check-final.log`: exit 0; builds, lint, typecheck, tests, contracts, OpenAPI, generated types | API 101/101; web 12/12; no unit/env totals mixed                                            |
| R2-D Browser workflow               | PASS            | `r2-r1-workflow-final.log`: 14/14, exit 0; `planFromUi` runs all 3 preferences and asserts UI labels | Snapshot/date/preferences recorded; browser evidence is one completed branch               |
| R2-E S09 refusal                    | NOT_VERIFIED    | `r2-s09.log`: known `NOT_VERIFIED` / `REAL_ALTERNATIVE`; historical exit 1 retained              | No-alternative assertion remains unproven; no pending status                                      |
| R2-F S01 named POI                 | BLOCKED_BY_DATA | `r2-s01-final.log`: named POI query 0 rows; full named scenario not established                  | Exact named POI source/licence/identity decision remains required                           |
| R2-G Security                       | PASS            | `r2-security-final.log`: 343 tracked, 13 client, exit 0; private cache matches excluded          | Source-only private branch; no public-readiness claim                                      |
| R2-H Data contracts                 | PASS            | `r2-contracts-final.log`: exit 0; 11 validated records                                             | 9 restored source files; historical blobs retained                                           |
| R2-Tier A regression wiring         | PASS            | `r2-tierA-final.log`: 21 total: 14 core incl. 4 fail-closed runner cases + 7 recovery, exit 0     | Routing `NOT_TESTED_BY_THIS_TIER`; no unit/env totals mixed                          |

## Acceptance summary

Full V01–V20 and S01–S14 matrices live in `docs/prototype-v1/PROTOTYPE-V1-CAPABILITY-AND-COVERAGE.md`.

- V20 and S14: `NOT_VERIFIED` — scope is the user-defined 20 browser steps (R2-D), not every V01–V20 capability. Required R2-D evidence assertions still missing are listed in `## V20/S14 — R2-D 20-step browser evidence` in coverage. R2 does not upgrade these; no V01/V06/V07/V15/V16/V17/S09 prerequisite is asserted for V20/S14.
- S01: `BLOCKED_BY_DATA` for the full named Manggarai–Kemang scenario; the R2 coordinate variant is a separate `PASS` row in coverage. Named Kemang Village/Lippo Mall Kemang source/licence/identity decision remains required.
- S09: `NOT_VERIFIED` — `r2-s09.log` is `NOT_VERIFIED` / `REAL_ALTERNATIVE`; the retained known historical exit-1 log (`r1-s09-final2.log`) stands until a final worker result is delivered. No `PENDING` status is used.
- V19: `PASS` within prototype boundary; `r2-security-final.log` full scan after production builds passed. Private local cache matches were detected but excluded from the source-only bundle; they must never be published. Production auth remains open.
- V18: `PASS` only for executed invalid/stale/owner/replay and completed-recovery boundaries; engine-level `NO_PATH` remains unexercised.
- V14: `PASS` for executed `COMPLETED` recovery; walking remains `UNVERIFIED_SCHEMATIC`.
- V01/V15/V16: `BLOCKED_BY_DATA` — exact decision records live in coverage; no unauthorized ingest.

No pass inflation on `NOT_VERIFIED` rows.

## Executed local evidence

| Evidence                                                                            | Status          | Command / log                                                                                               | Exit               | Observed boundary                                                                                                           |
| ----------------------------------------------------------------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `pnpm check` (lint, typecheck, unit, contracts, OpenAPI, api types, format, builds) | PASS            | `r2-check-final.log`                                                                                        | 0                  | `tests 101/0` + `tests 12/0` pure; builds and gates passed                                                                  |
| API unit suite                                                                      | PASS            | `r2-api-tests-final.log`                                                                                    | 0                  | 101/101                                                                                                                     |
| Web unit suite                                                                      | PASS            | `r2-web-tests-final.log`                                                                                    | 0                  | 12/12, Indonesian `NO_PATH` copy; `easiest` computed-scope + tie-aware                                                      |
| R2-D full search-to-completion                                                      | PASS            | `node apps/web/scripts/passenger-r1-full-workflow.mjs`; `r2-r1-workflow-final.log`                          | 0                  | 14/14; snapshot 43fb9a29, date `2026-10-02T08:11`; `planFromUi` used UI `Find journeys` for all 3 preferences; easiest UI label count asserted |
| R2-F S01 coordinate variant                                                         | PASS            | `PASSENGER_NETWORK_SNAPSHOT_ID=… node apps/web/scripts/passenger-s01-r1-acceptance.mjs`; `r2-s01-final.log` | 0                  | 9/9 coordinate-variant cases; full named S01 remains separate `BLOCKED_BY_DATA`                                            |
| R2-E S09 attempt                                                                    | NOT_VERIFIED    | `node apps/web/scripts/passenger-s09-no-path-r1-acceptance.mjs`; `r2-s09.log`; retained `r1-s09-final2.log` | 1 retained         | Genuine alternative returned; Indonesian no-alternative UI not exercised                                                   |
| M5 browser acceptance                                                               | PASS            | `r2-m5-final.log`                                                                                           | 0                  | 22/22                                                                                                                       |
| M6 browser acceptance                                                               | PASS            | `r2-m6-final.log`                                                                                           | 0                  | 13/13                                                                                                                       |
| M7 integrated harness                                                               | PASS            | `r2-m7-final.log`                                                                                           | 0                  | 20/20; completed branch; not V20/S14 proof                                                                                  |
| GPS acceptance                                                                      | PASS            | `node apps/web/scripts/passenger-gps-browser-acceptance.mjs`; `r2-gps-final.log`                            | 0                  | Denied + simulated unsupported contexts; manual progression                                                                 |
| Multi-OD acceptance                                                                 | PASS            | `pnpm acceptance:v1:multi-od`; `r2-multi-od-final.log`                                                      | 0                  | 11 corridors including coordinate variant; `PASSENGER_NETWORK_SNAPSHOT_ID` required                                         |
| Tier A core + recovery                                                              | PASS            | `r2-tierA-final.log`                                                                                        | 0                  | 21 total: 14 core including 4 fail-closed runner cases + 7 recovery; routing not tested                                     |
| Full secret scan                                                                    | PASS            | `pnpm security:scan`; `r2-security-final.log`                                                               | 0                  | 343 tracked inputs, 13 client files; private local cache matches excluded (ignored `.next*`)                                |
| Data contracts                                                                      | PASS            | `pnpm data:contracts:check`; `r2-contracts-final.log`                                                       | 0                  | 11 records validated; 9 source files restored to exact historical blobs; 37 scoped files + 13 stale unpublished paths fixed |

## Security scan contract

Default `pnpm security:scan` is full mode. It requires all three `PASSENGER_SERVICE_TOKEN`, `CONTROLLED_REVIEW_TOKEN`, and `PASSENGER_SESSION_SECRET` in ignored `.env`, each length >=32, plus web `BUILD_ID`, browser JavaScript, API build, and server build inputs. It scans cached private outputs for exact values without printing values. `r2-security-final.log` passed in full/exact+category mode across 343 tracked and 13 client inputs; existing ignored `.next`/`dist` private local caches did contain isolated exact-value matches and are explicitly excluded from the publishable bundle. Neither `dist`/cache nor `.env` is published.

Source-only private branch: R2 security evidence is local source-only; it does not imply public-bundle readiness. Isolated-build release scan remains out of scope for the source-only branch.

CI uses explicit `pnpm security:scan --category-only` after `pnpm check`; category-only mode may skip absent build outputs and does not claim full exact-value release scan.

## Migration record

- `202610120003_passenger_reporting`: applied for M5.
- `202610130001_recovery_acceptance_lineage`: applied early before original Tier A acceptance recording; deviation retained.
- `202610130002_active_journey_current_itinerary`: authorized and applied; final function verification completed.
- No R2 documentation-only DB operation performed. Existing runtime bootstrap instructions and URLs cross-checked against `.env.example`, root scripts, `apps/api/src/main.ts`, `apps/api/src/application.ts`, OTP adapter, and existing migration directory; no speculative URL or migration was added.

## Capability boundaries

- Place search covers accepted transit stops/stations, not general POIs or addresses.
- Kemang Village/Lippo Mall Kemang lacks accepted source, version, license, attribution, and ingest authorization.
- OTP evidence is scheduled/frequency-derived research routing, not realtime service truth.
- Fare remains `UNKNOWN`; no cheapest recommendation claim.
- Walking remains `UNVERIFIED_SCHEMATIC` pending Phase 4A-R validation.
- External provider availability, fare, ETA, booking, vehicle tracking, and deep links remain unverified.
- Passenger reports remain `REPORTED_UNVERIFIED`; controlled reviewer output and disruption evidence remain `SIMULATED`.
- Prototype signed sessions and owner isolation are not production authentication acceptance.
- Release is source-only: `.env`, `.next*`, `dist`, caches, data, and runtime artifacts must never be uploaded.

## Reproduction commands

```sh
pnpm acceptance:v1:multi-od
node apps/web/scripts/passenger-r1-full-workflow.mjs
node apps/web/scripts/passenger-s09-no-path-r1-acceptance.mjs   # expected NOT_VERIFIED on live OTP
pnpm --filter @transum-in/api test
pnpm --filter @transum-in/web test
pnpm check
pnpm build
pnpm security:scan --require-secrets
```

## Remaining blockers

1. Full named S01 — Kemang Village/Lippo Mall Kemang source extract, stable identifier/coordinate, version, ODbL-compatible license/attribution, and authorized ingest.
2. Engine-level OTP `NO_PATH` scenario and no-alternative assertion proof remains `NOT_VERIFIED` on this corridor.
3. V20/S14 remaining R2-D evidence assertions (OTP response reference / all itinerary IDs / active leg / report / recovery / revision capture) — see `## V20/S14 — R2-D 20-step browser evidence` in coverage.
4. Walking validation and external-provider rights/integration remain capability blockers but are not prerequisites for V20/S14 browser completeness.
5. Full Tier B snapshot; Docker headroom guardrail unchanged.

R2 data-contract and scoped format gates passed. Historical R1 failures remain documented in coverage and are not current R2 failed gates. Source-only private branch; no public-readiness claim.
