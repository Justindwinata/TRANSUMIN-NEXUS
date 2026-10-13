# Product V1 delivery board

Updated: 2026-10-13. Classification: `PROTOTYPE_V1_PARTIAL`. Publication pending parent commit.

## Provenance

Repository is sanitized product-publication lineage, not original research Git history.

- Source snapshot: historical branch `prototype-v1-generalized-journey` at `de3677273292398ffeb8af7bf681480bdc3379a2`, plus reviewed V1-1 working-tree files.
- Frozen D12 source baseline: `de3677273292398ffeb8af7bf681480bdc3379a2`.
- Private recovery archive remains outside repository under `.transum-r0a-persistent`.
- Runtime OTP graph, JAR, JRE, databases, secrets, raw/processed datasets, logs, screenshots, and build outputs are not versioned here.
- No complete product bundle secret-scan evidence was reviewed for this checkpoint.

## Current milestone

Local milestone harnesses passed within recorded boundaries. They do not establish full Product V1 acceptance.

| Milestone | Status | Executed evidence | Boundary |
| --- | --- | --- | --- |
| M0 Publication lineage | NOT_VERIFIED | Historical remote/sanitization claims exist | Current bundle secret scan absent; publication pending parent commit |
| M1 Real API/runtime | PASS | API test evidence and real OTP/API browser harnesses exited 0 | Local prototype runtime only |
| M2 Generalized planning | PASS | `pnpm acceptance:v1:multi-od`, exit 0 | Corridor sample; no POI/general regional proof |
| M3 Interactive map | PASS | M7 candidate map/timeline browser case passed | Full mutation-map directive scope not independently accepted |
| M4 Active Journey/GPS/progress | PASS | M7 active journey and boarding/alighting cases; GPS denial/unsupported fallback, exit 0 | No GPS position persistence or auto-boarding |
| M5 Passenger reporting | PASS | `m5-v2.log`: 22/22, exit 0 | Controlled review only; alerts `SIMULATED` |
| M6 Recovery acceptance | PASS | `m6-v4.log`: 13/13 including replay and close, exit 0 | Executed `COMPLETED` recovery; NO_PATH not exercised |
| M7 Full directive acceptance | NOT_VERIFIED | `m7-second.log`: local integrated harness 20/20, exit 0, `COMPLETED` branch | Harness is not full 20-step search/preference directive workflow; Tier A continuation not wired to standard runner |

## Current acceptance summary

Full V01–V20 and S01–S14 expected/observed/input/source/command/exit/provenance/limits matrices live in `docs/prototype-v1/PROTOTYPE-V1-CAPABILITY-AND-COVERAGE.md`.

Key corrections:

- V20 and S14: `NOT_VERIFIED`. Local integrated 20-case PASS does not silently redefine full directive acceptance.
- S01: `NOT_VERIFIED`. Executed corridor coordinates were approximately `-6.108205, 106.89982` → `-6.205627, 106.822295` (Kelapa Gading/Gambir area), not Manggarai–Kemang.
- S09: `NOT_VERIFIED`. NO_PATH branch exists but reviewed run completed recovery; refusal branch was not exercised.
- V19: `NOT_VERIFIED`. Session/owner/reviewer checks passed, but complete bundle secret-scan evidence is absent and production auth remains open.
- V01: `BLOCKED_BY_DATA`; V15: `BLOCKED_BY_DATA`; V16: `BLOCKED_BY_DATA`.

## Executed local evidence

| Evidence | Status | Command / log | Exit | Observed boundary |
| --- | --- | --- | --- | --- |
| M5 browser acceptance | PASS | `m5-v2.log` | 0 | 22/22; owner isolation, report boundary, controlled review, targeted simulated alert, reload, SSE reconnect |
| M6 browser acceptance | PASS | `m6-v4.log` | 0 | 13/13; real OTP recovery, accept, replay, stale/foreign negatives, continuation, controlled close |
| M7 integrated harness | PASS | `node scripts/passenger-integrated-m7-acceptance.mjs`; `m7-second.log` | 0 | 20/20 local cases; `COMPLETED` branch only |
| GPS browser acceptance | PASS | `node scripts/gps-acceptance.mjs`; `gps-final.log` | 0 | GPS default OFF; denied and simulated unsupported fallback; no auto-boarding, persistence, or location network request |
| API unit suite | PASS | `pnpm --filter @transum-in/api test`; recorded API evidence | 0 | 101/101 per checkpoint record |
| Tier A lightweight | PASS | `tierA-m7.log` | 0 | M6 recovery acceptance 6/6; controlled synthetic fixtures; routing not tested; continuation spec not wired to standard runner |
| Web production build | PASS | `pnpm --filter @transum-in/web build`; `web-build-production.log` | 0 | Passed without `NODE_ENV` override |
| Root-env web build | FAIL | `web-build-final.log` | 1 | Root environment supplied nonstandard `NODE_ENV=development`; prerender failed; not production-build evidence |
| Bundle secret scan | NOT_RUN | No reviewed command/log | — | V19 and publication gate remain open |
| NO_PATH browser branch | NOT_RUN | M7 run selected `COMPLETED` | — | S09 remains unverified |
| Full directive workflow | NOT_RUN | No separate full search/preference directive run | — | M7/V20/S14 remain unverified |

Logs above are local temporary evidence under `/private/var/folders/9w/27j9sy2n31scrtpmj0tmgwl40000gn/T/opencode/`; they are not repository artifacts.

## Migration record

- `202610120003_passenger_reporting`: applied for M5.
- `202610130001_recovery_acceptance_lineage`: accidentally applied early before original Tier A acceptance was recorded. Record as deviation; do not relabel it as originally accepted sequence.
- `202610130002_active_journey_current_itinerary`: authorized and applied. Final function verification completed.
- No newer migration deviation is proven by reviewed evidence.
- No DB operation was performed for this documentation update.

## Capability boundaries

- Place search covers accepted transit stops/stations, not general POIs or addresses.
- Kemang Village/Lippo Mall Kemang remains unsupported without accepted source, version, license, attribution, and ingest authorization.
- OTP evidence is scheduled/frequency-derived research routing, not realtime service truth.
- Fare remains `UNKNOWN`; no cheapest recommendation claim.
- Walking remains `UNVERIFIED_SCHEMATIC` pending Phase 4A-R validation.
- External provider availability, fare, ETA, booking, vehicle tracking, and deep links remain unverified.
- Passenger reports remain `REPORTED_UNVERIFIED`; controlled reviewer output and disruption evidence remain `SIMULATED`.
- Prototype signed sessions and owner isolation are not production authentication acceptance.

## Reproduction commands

```sh
pnpm acceptance:v1:multi-od
node scripts/passenger-integrated-m7-acceptance.mjs
node scripts/gps-acceptance.mjs
pnpm --filter @transum-in/api test
pnpm --filter @transum-in/web build
```

Required missing evidence:

1. Execute full directive search/preference workflow without mapping smaller harness cases onto it.
2. Exercise NO_PATH refusal branch and retain exact input/output evidence.
3. Run and retain complete publication-bundle secret scan.
4. Wire continuation specification into standard Tier A runner and execute it.
5. Resolve data/authorization blockers before claiming POI, walking validity, or provider handoff.
