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

R1 checkpoint records executed evidence only. Classification remains `PROTOTYPE_V1_PARTIAL`; named-POI coverage, walking validation, external handoff, engine-level OTP `NO_PATH`, and full directive acceptance remain blocked or unverified.

| Milestone                          | Status       | Executed evidence                                                                                  | Boundary                                                       |
| ---------------------------------- | ------------ | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| M0 Publication lineage             | NOT_VERIFIED | Sanitized lineage documented                                                                       | Publication pending review/commit                              |
| M1 Real API/runtime                | PASS         | API suite 101/101; Tier A 7/7; browser runtime harnesses                                           | Local prototype runtime only                                   |
| M2 Generalized planning            | PASS         | `pnpm acceptance:v1:multi-od`, exit 0                                                              | Corridor sample; no POI/general regional proof                 |
| M3 Interactive map                 | PASS         | R1 workflow map geometry/markers/attribution case                                                  | Full mutation-map directive scope not independently accepted   |
| M4 Active Journey/GPS/progress     | PASS         | R1 workflow boarding/alighting; GPS denial/unsupported fallback                                    | No GPS position persistence or auto-boarding                   |
| M5 Passenger reporting             | PASS         | `r1-m5-publication2.log`: 22/22, exit 0                                                            | Controlled review only; alerts `SIMULATED`                     |
| M6 Recovery acceptance             | PASS         | `r1-m6-publication.log`: 13/13, exit 0; Tier A `r1-tierA-publication.log`: 7/7                     | Completed recovery executed; live-OTP NO_PATH not reproducible |
| M7 Full directive acceptance       | NOT_VERIFIED | Existing `r1-m7-publication.log`: 20/20; R1 workflow: 13/13                                        | These are separate harnesses, not full V20/S14 proof           |
| R1-A Search-to-completion workflow | PASS         | `r1-workflow-final.log`: 13/13, exit 0                                                             | One corridor; completed branch only                            |
| R1-B Bundle secret scan + CI gate  | PASS         | `final-scan2.log`: full scan exit 0 after isolated builds                                          | CI category-only mode explicit; remote CI not yet executed     |
| R1-C S09 refusal                   | NOT_VERIFIED | `r1-s09-final2.log`: exit 1; live OTP returned genuine alternative; UI no-alternative case skipped | Tier A refusal assertion passed, not full NO_PATH acceptance   |
| R1-D S01 Manggarai–Kemang          | NOT_VERIFIED | Coordinate runner exists; no retained PASS log; named POI unsupported                              | Coordinate corridor is not named-POI evidence                  |
| R1-E Tier A regression wiring      | PASS         | `r1-tierA-publication.log`: 7/7, exit 0                                                            | Routing `NOT_TESTED_BY_THIS_TIER`; full Tier B blocked         |

## Acceptance summary

Full V01–V20 and S01–S14 matrices live in `docs/prototype-v1/PROTOTYPE-V1-CAPABILITY-AND-COVERAGE.md`.

- V20 and S14: `NOT_VERIFIED`; R1 workflow proves 13 executed cases, not full directive scope.
- S01: `NOT_VERIFIED`; coordinate runner exists, but named Manggarai–Kemang POI remains `BLOCKED_BY_DATA`.
- S09: `NOT_VERIFIED`; `r1-s09-final2.log` returned `REAL_ALTERNATIVE`; no-path UI case was skipped and is not a PASS.
- V19: `PASS` within prototype boundary; full scan after isolated API/web builds passed. Production auth remains open.
- V18: `PASS` only for executed invalid/stale/owner/replay and completed-recovery boundaries; engine-level NO_PATH remains unexercised.
- V14: `PASS` for executed completed recovery; walking remains `UNVERIFIED_SCHEMATIC`.
- V01/V15/V16: `BLOCKED_BY_DATA`.

## Executed local evidence

| Evidence                  | Status       | Command / log                                                                                                        | Exit | Observed boundary                                                                                  |
| ------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------- | ---- | -------------------------------------------------------------------------------------------------- |
| R1 full workflow          | PASS         | `node apps/web/scripts/passenger-r1-full-workflow.mjs`; `r1-workflow-final.log`                                      | 0    | 13/13: place search, 3 preferences, map, identity, report/review, recovery persistence, completion |
| R1 S01 coordinate variant | NOT_VERIFIED | `PASSENGER_NETWORK_SNAPSHOT_ID=… node apps/web/scripts/passenger-s01-r1-acceptance.mjs`; No retained R1-S01 PASS log | —    | Coordinate runner exists; named POI remains blocked                                                |
| R1 S09 attempt            | NOT_VERIFIED | `node apps/web/scripts/passenger-s09-no-path-r1-acceptance.mjs`; `r1-s09-final2.log`                                 | 1    | Genuine alternative returned; `SKIPPED` UI is recorded as `NOT_VERIFIED`                           |
| M5 browser acceptance     | PASS         | `r1-m5-publication2.log`                                                                                             | 0    | 22/22                                                                                              |
| M6 browser acceptance     | PASS         | `r1-m6-publication.log`                                                                                              | 0    | 13/13                                                                                              |
| M7 integrated harness     | PASS         | `r1-m7-publication.log`                                                                                              | 0    | 20/20; completed branch; not V20/S14 proof                                                         |
| API unit suite            | PASS         | `final-api2.log`                                                                                                     | 0    | 101/101                                                                                            |
| Web unit suite            | PASS         | `final-web4.log`                                                                                                     | 0    | 12/12, Indonesian NO_PATH copy                                                                     |
| Tier A lightweight        | PASS         | `r1-tierA-publication.log`                                                                                           | 0    | 7/7; routing not tested; full snapshot blocked by environment                                      |
| Web production build      | PASS         | `r1-build-isolated.log`                                                                                              | 0    | Isolated `.next-r1`, production `NODE_ENV`; build passed                                           |
| Root-env web build        | FAIL         | `web-build-final.log`                                                                                                | 1    | Root `NODE_ENV=development` caused prerender failure; not production evidence                      |
| Full secret scan          | PASS         | `PRODUCT_ACCEPTANCE_DIST_DIR=.next-r1 pnpm security:scan`; `final-scan2.log`                                         | 0    | 334 proposed tracked inputs, 13 client files; no failures or isolated private-cache matches        |
| Data contracts            | FAIL         | `pnpm data:contracts:check`; `r1-contracts.log`                                                                      | 1    | Missing `data/manifests/dataset-manifest.schema.json`; no ingest/research changes                  |

## Security scan contract

Default `pnpm security:scan` is full mode. It requires all three `PASSENGER_SERVICE_TOKEN`, `CONTROLLED_REVIEW_TOKEN`, and `PASSENGER_SESSION_SECRET` in ignored `.env`, each length >=32, plus web `BUILD_ID`, browser JavaScript, API build, and server build inputs. It scans cached private outputs for exact values without printing values. Existing `.next` private dev caches contain exact configuration values; isolated `.next-r1` scan had no matches. Neither dist/cache is published.

CI uses explicit `pnpm security:scan --category-only` after `pnpm check`; category-only mode may skip absent build outputs and does not claim full exact-value release scan.

## Migration record

- `202610120003_passenger_reporting`: applied for M5.
- `202610130001_recovery_acceptance_lineage`: applied early before original Tier A acceptance recording; deviation retained.
- `202610130002_active_journey_current_itinerary`: authorized and applied; final function verification completed.
- R1 added no database migration. No DB operation performed for documentation update.

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

1. Accepted named-POI source/license/ingest for Kemang Village/Lippo Mall Kemang.
2. Engine-level OTP `NO_PATH` scenario with no genuine alternative.
3. Walking validation and external-provider rights/integration.
4. Data-contract gate missing schema; CI cannot be claimed PASS. Global `format:check` also FAIL exit 2 (37 pre-existing style files and missing historical paths); changed-file formatting passes.
5. Full Tier B snapshot; Docker headroom guardrail unchanged.
