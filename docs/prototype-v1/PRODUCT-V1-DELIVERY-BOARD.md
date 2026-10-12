# Product V1 delivery board

Updated: 2026-10-12

## Provenance

This repository is a sanitized product-publication lineage. It is **not** the original research Git history.

- Source snapshot: local historical branch `prototype-v1-generalized-journey` at `de3677273292398ffeb8af7bf681480bdc3379a2`, plus the five reviewed V1-1 working-tree files.
- Frozen D12 source baseline: `de3677273292398ffeb8af7bf681480bdc3379a2`.
- Private recovery archive: retained outside this repository under `.transum-r0a-persistent`; it contains a verified complete Git bundle and source manifest.
- Sensitive historical credential-bearing revisions are intentionally not included in this lineage.
- Runtime OTP graph, JAR, JRE, databases, secrets, raw/processed datasets, and build outputs are not versioned here.

## Current milestone

M0 — sanitized GitHub product baseline.

## Verified capabilities

- Passenger journey search UI and typed API proxy.
- OTP-backed planner and current stop/station search implementation.
- V1-1 route preferences: balanced, fastest, fewest transfers, least walking.
- Subset-scoped, tie-aware `easiestAmongShown()`; fare remains unknown.
- Existing controlled Active Journey, targeted alert, and state-aware recovery implementation retained.

## Local evidence

- `pnpm install --frozen-lockfile --prefer-offline`: PASS in source workspace.
- `pnpm typecheck`: PASS.
- `pnpm lint`: PASS.
- `pnpm test`: PASS; API 83/83 and web 9/9.
- `pnpm build`: PASS.
- `pnpm openapi:validate`: PASS.
- `pnpm api:types:check`: PASS.
- OTP 2.10.0 preflight and startup: PASS; accepted graph SHA-256 `ad9fdd3ea0308dcf033f51b43e027dd3ffa10166ef130f9512e3a9e643331574`.

## Acceptance state

- M0: in progress until remote commit verification.
- M1: not run in publication workspace.
- V01–V20 and S01–S14: retain statuses in `PROTOTYPE-V1-CAPABILITY-AND-COVERAGE.md`; no new PASS claimed.

## Known gaps

- Isolated product database bootstrap and real API/browser routing are not yet verified.
- No route geometry API/map, GPS, explicit boarding/alighting, or passenger-report boundary.
- POI search remains blocked pending approved source/version/license/attribution and ingest scope.

## Next action

Publish clean baseline, verify remote SHA and unreachable historical commits, then provision isolated product database and run real API-to-OTP browser planning.
