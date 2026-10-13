# Prototype V1 — capability and coverage checkpoint

Date: 2026-10-13. Classification: `PROTOTYPE_V1_PARTIAL`. This checkpoint records executed evidence only. Status values are exact: `PASS`, `FAIL`, `BLOCKED_BY_DATA`, `BLOCKED_BY_AUTHORIZATION`, `BLOCKED_BY_ENVIRONMENT`, `NOT_RUN`, `NOT_VERIFIED`.

## Evidence rules

A local integrated harness case is not equivalent to full directive acceptance. Synthetic or controlled evidence remains labeled `SIMULATED`; scheduled OTP output is not live service data. Historical notes stay below current matrices and do not change current status.

## V01–V20 matrix

| ID | Expected | Status | Observed | Input | Source | Command | Exit | Provenance | Limits |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| V01 | Resolve approved named origin/destination places | BLOCKED_BY_DATA | Stop/station search exists; no accepted POI/address source for Kemang Village/Lippo Mall Kemang | Place-search text | `transit-place-search.service.ts`; accepted manifests | `pnpm acceptance:v1:multi-od` | 0 for other corridors | Scheduled transit snapshot | No POI source, license, alias, or ingest approval |
| V02 | Plan dynamic multimodal OD | PASS | Real OTP/API returned alternatives for executed corridors | Named transit places and labeled coordinates | `scripts/acceptance/v1-multi-od.mjs`; OTP graph manifest | `pnpm acceptance:v1:multi-od` | 0 | Scheduled/frequency-derived OTP | Not every OD, date, or region |
| V03 | Rank candidates by declared preference | PASS | FASTEST, FEWEST_TRANSFERS, LEAST_WALKING invariants passed | Multi-OD candidate sets | Planner service and acceptance output | `pnpm acceptance:v1:multi-od` | 0 | Computed from OTP candidates | Fare UNKNOWN; no global EASIEST/CHEAPEST |
| V04 | Render route and leg geometry | PASS | Browser route/map/timeline cases passed in recorded harness | Real OTP itinerary | `journey-map.tsx`; M7 evidence | `node scripts/passenger-integrated-m7-acceptance.mjs` | 0 | OTP geometry; browser-controlled | Does not prove full V1 map mutation scope |
| V05 | Preserve itinerary graph/timeline correspondence | PASS | Candidate map/timeline case passed | Selected OTP itinerary | M7 runner | `node scripts/passenger-integrated-m7-acceptance.mjs` | 0 | Real OTP/API | No independent map-parity study |
| V06 | Request GPS consent and handle denial | PASS | GPS default OFF; denied and unsupported contexts used manual progression | Chromium denied permission; isolated unsupported context | `/private/var/folders/.../gps-final.log` | `node scripts/gps-acceptance.mjs` | 0 | Browser permission; unsupported case SIMULATED | No persisted location |
| V07 | Handle device position without false boarding | PASS | Denied/unsupported fallback passed; auto-boarding false | Same GPS contexts | `gps-final.log` | `node scripts/gps-acceptance.mjs` | 0 | Browser evidence | No live position or boarding proof |
| V08 | Support boarding/alighting progression | PASS | Prefix and continued boarding/alighting cases passed | Active journey and accepted continuation | M6/M7 runners | `node scripts/passenger-integrated-m7-acceptance.mjs` | 0 | Real API/OTP; controlled incident SIMULATED | Manual/recorded boundary, not GPS-derived |
| V09 | Preserve owner-scoped active journey state | PASS | Refresh, continuation, and second-context isolation passed | Two browser contexts | M6/M7 logs | `node scripts/passenger-integrated-m7-acceptance.mjs` | 0 | Signed session and product DB | Prototype auth boundary |
| V10 | Capture passenger report as unverified | PASS | UI report, validation, idempotency, owner isolation passed | Passenger report payload | `m5-v2.log`, `m7-second.log` | `node scripts/passenger-integrated-m7-acceptance.mjs` | 0 | Passenger-originated report remains `REPORTED_UNVERIFIED` | No claim of operational truth |
| V11 | Keep operational verification controlled | PASS | Passenger review denied; authorized controlled review passed | Reviewer/service token cases | `m5-v2.log`, `m7-second.log` | `node scripts/passenger-integrated-m7-acceptance.mjs` | 0 | Controlled review, SIMULATED alert | Production authorization not proven |
| V12 | Fan out relevant disruption only | PASS | Relevant alert seen; unrelated browser context isolated | Controlled report/review | M5/M7 logs | `node scripts/passenger-integrated-m7-acceptance.mjs` | 0 | `SIMULATED` disruption | No live operator feed |
| V13 | Anchor recovery at completed boundary | PASS | Recorded/manual boundary anchor passed | Active journey segment boundary | `m6-v4.log`, `m7-second.log` | `node scripts/passenger-integrated-m7-acceptance.mjs` | 0 | Product DB lineage | Mid-leg GPS anchor absent |
| V14 | Offer, accept, and continue valid recovery | PASS | COMPLETED recovery and accept continuation passed | Real OTP alternative with controlled blocked entity | `m6-v4.log`, `m7-second.log` | `node scripts/passenger-integrated-m7-acceptance.mjs` | 0 | OTP plan; controlled disruption SIMULATED | NO_PATH branch not exercised in this run |
| V15 | Verify walking accuracy | BLOCKED_BY_DATA | Walking remains `UNVERIFIED_SCHEMATIC` | OTP/OSM geometry | Phase 4A-R evidence gap | Not run | — | OSM/OTP rights documented | Cross-check and passenger path validation pending |
| V16 | Handoff to external mobility provider | BLOCKED_BY_DATA | No verified provider integration | Provider option | Provider integration scope | Not run | — | No rights/availability/fare/booking evidence | Must not claim handoff |
| V17 | Generalize across representative scenarios | NOT_VERIFIED | Corridor samples exist; acceptance does not establish full regional generalization | Multi-OD sample | `acceptance:v1:multi-od` | `pnpm acceptance:v1:multi-od` | 0 | Scheduled OTP sample | Sample size and coverage boundary not a V1 proof |
| V18 | Handle faults and refusal safely | PASS | Invalid input, stale/owner/replay cases and recovery COMPLETED branch passed | Negative API/UI cases | API 101 log; M6/M7 logs | `pnpm --filter @transum-in/api test`; `node scripts/passenger-integrated-m7-acceptance.mjs` | 0 | Product tests and browser harness | NO_PATH branch remains unexercised |
| V19 | Prove security/privacy boundary | NOT_VERIFIED | Session/owner/reviewer cases passed, but no bundle secret-scan evidence in reviewed logs | Auth boundary and repository bundle | M5/M7 logs; bundle scan absent | Secret scan not run in reviewed evidence | — | Browser/API evidence only | Production auth and complete bundle scan remain open |
| V20 | Accept full 20-step directive workflow | NOT_VERIFIED | Local integrated runner passed 20/20 on `COMPLETED` branch | M7 runner cases 1–20 | `/private/var/folders/.../m7-second.log` | `node scripts/passenger-integrated-m7-acceptance.mjs` | 0 | Real OTP/API/browser; controlled report SIMULATED | Case harness is not full directive search/preference acceptance; Tier A continuation not wired to standard runner |

## S01–S14 matrix

| ID | Expected | Status | Observed | Input | Source | Command | Exit | Provenance | Limits |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| S01 | Manggarai–Kemang controlled disruption/recovery | NOT_VERIFIED | Executed coordinate corridor was approximately `-6.108205, 106.89982` → `-6.205627, 106.822295` (Kelapa Gading/Gambir area), not Manggarai–Kemang | Coordinates, not approved Kemang POI | M7 runner/log; multi-OD evidence | `node scripts/passenger-integrated-m7-acceptance.mjs` | 0 | OTP; controlled disruption `SIMULATED` | Wrong corridor; no POI proof |
| S02 | Bogor–Cilebut routing | PASS | Real OTP alternatives observed | Place-resolved corridor | `acceptance:v1:multi-od` | `pnpm acceptance:v1:multi-od` | 0 | Scheduled OTP | Routing only |
| S03 | Kelapa Gading–Manggarai routing | PASS | Real OTP alternatives observed | Place-resolved corridor | `acceptance:v1:multi-od` | `pnpm acceptance:v1:multi-od` | 0 | Scheduled OTP | Routing only |
| S04 | Lebak Bulus–Fatmawati routing | PASS | Real OTP alternatives observed | Place-resolved corridor | `acceptance:v1:multi-od` | `pnpm acceptance:v1:multi-od` | 0 | Scheduled OTP | Routing only |
| S05 | Representative Jabodetabek coverage | NOT_VERIFIED | Corridor samples ran; regional coverage not established | Multi-OD sample | `acceptance:v1:multi-od` | `pnpm acceptance:v1:multi-od` | 0 | Scheduled OTP | No region-wide sampling protocol/evidence |
| S06 | GPS denied/manual fallback | PASS | Denied and unsupported fallback passed | Chromium GPS contexts | `gps-final.log` | `node scripts/gps-acceptance.mjs` | 0 | Browser; unsupported case SIMULATED | No persisted location |
| S07 | Unverified report boundary | PASS | `REPORTED_UNVERIFIED`; passenger review denied | Passenger report and review attempt | `m5-v2.log`, `m7-second.log` | `node scripts/passenger-integrated-m7-acceptance.mjs` | 0 | Browser/API; controlled reviewer | No live incident truth |
| S08 | Relevant verified controlled disruption | PASS | Authorized controlled review produced targeted simulated alert | Controlled report/reviewer | `m5-v2.log`, `m7-second.log` | `node scripts/passenger-integrated-m7-acceptance.mjs` | 0 | `SIMULATED` | Not operator verification |
| S09 | No valid recovery alternative | NOT_VERIFIED | Runner accepted `COMPLETED`; NO_PATH branch exists but was not exercised | M7 completed-branch input | `m7-second.log` | `node scripts/passenger-integrated-m7-acceptance.mjs` | 0 | Real OTP/API | No executed NO_PATH refusal |
| S10 | Preserve completed legs | PASS | Completed prefix and accepted suffix continuity passed | Active journey/recovery | `m6-v4.log`, `m7-second.log` | `node scripts/passenger-integrated-m7-acceptance.mjs` | 0 | Product DB lineage | Controlled corridor |
| S11 | Walking validity | BLOCKED_BY_DATA | `UNVERIFIED_SCHEMATIC` remains | Walking leg geometry | Capability evidence | Not run | — | OSM-derived data | Phase 4A-R pending |
| S12 | Unknown fare/external mobility boundary | BLOCKED_BY_DATA | Fare remains UNKNOWN; provider handoff absent | Fare/provider request | Capability evidence | Not run | — | No provider rights/integration | No cheapest/booking claim |
| S13 | Failure, error, expiry handling | PASS | Invalid input, stale/foreign/replay/conflict and reconnect cases passed | Negative API/browser cases | API/M5/M6 logs | `pnpm --filter @transum-in/api test`; M5/M6 runners | 0 | Product tests/browser | NO_PATH not included |
| S14 | Full browser passenger workflow | NOT_VERIFIED | Integrated local 20-case run passed, but full directive acceptance not executed | M7 case harness | `m7-second.log` | `node scripts/passenger-integrated-m7-acceptance.mjs` | 0 | Real OTP/browser; controlled data SIMULATED | Search/preference workflow and directive scope remain unproven |

## Historical evidence, retained separately

- M5 log: 22/22, exit 0 (`m5-v2.log`).
- M6 log: 12 core cases plus accept replay/close, 13/13, exit 0 (`m6-v4.log`).
- M7 log: 20/20, exit 0, `COMPLETED` branch (`m7-second.log`). This is historical integrated evidence, not V20/S14 full-directive acceptance.
- GPS log: exit 0; denial/unsupported fallback only (`gps-final.log`).
- API test log: 101/101, exit 0 (`api-test-final.log`).
- Tier A M7 log: M6 6/6, exit 0 (`tierA-m7.log`); continuation specification is not wired into standard runner.
- Latest production web build: exit 0 without `NODE_ENV` override (`web-build-production.log`). Sourcing root `env` with `NODE_ENV=development` failed; this is not production-build evidence.
- Migration `130001` was applied early before original Tier A acceptance recording; this remains a documented deviation. Authorized `130002` was applied; final function verification completed. No newer deviation is proven.

## Reproduction commands

```sh
pnpm acceptance:v1:multi-od
node scripts/passenger-integrated-m7-acceptance.mjs
node scripts/gps-acceptance.mjs
pnpm --filter @transum-in/api test
pnpm --filter @transum-in/web build
```

## Current blockers

POI source/license/ingest authorization; walking validation; external-provider rights/integration; complete bundle secret scan; full directive search/preference workflow; executed NO_PATH scenario; standard-runner continuation wiring. Publication remains pending parent commit.
