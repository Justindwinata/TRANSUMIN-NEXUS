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

M2 complete; M3 (interactive map) is next.

## Verified capabilities

- Passenger journey search UI and typed API proxy.
- OTP-backed planner and current stop/station search implementation.
- V1-1 route preferences: balanced, fastest, fewest transfers, least walking.
- Subset-scoped, tie-aware `easiestAmongShown()`; fare remains unknown.
- Existing controlled Active Journey, targeted alert, and state-aware recovery implementation retained.
- Isolated product database bootstrap with full accepted canonical ingestion (Phase 1 TransJakarta GTFS, Phase 2A spatial, Phase 2B base snapshot, Phase 4B routing identities).

## Local evidence (product workspace, 2026-10-12)

- M0 `GITHUB_PRODUCT_BASELINE`: PASS. Remote `main`/`prototype-v1` at `e8092a375af0ab0c55c83b763fc5f3f2150edc97`; sanitized scan (credentials, tokens, private keys, absolute user paths, >5 MiB blobs): clean; old history unreachable from remote.
- Isolated DB bootstrap (all commands re-run from tracked manifests; raw/processed artifacts checksum-verified first):
  - `pnpm data:transjakarta:validate|ingest|verify`: PASS (240 routes, 7,819 stops, idempotent `ALREADY_IMPORTED`).
  - `pnpm data:spatial:validate`: PASS with `NODE_OPTIONS=--max-old-space-size=8192` (default heap OOMs on the 419 MB OPL walking-graph build; recorded as known limitation). Counts match tracked manifest exactly.
  - `pnpm data:spatial:verify`: PASS (947,974 nodes, 2,315,442 edges, 8,188 resolved endpoints).
  - `pnpm data:twin:snapshot`: PASS; snapshot `43fb9a29-0c89-5c72-8826-e3dc2adcfb1f`, content hash matches tracked Phase-2 manifest.
  - `pnpm data:phase4bb:identity`: PASS (125 stations, 65 routes, dataset `19dde3d7-a359-5457-bea5-a6db1704543d`).
  - `pnpm data:phase4ba:validate`: PASS; regenerated manifest SHA-256 `1f493716d20ad5ffa2e3628ece67f2511235f2abfacef4cd7b2b2af9f73dfb77` identical to accepted value.
- M1 real API: `health/ready` PASS (PostGIS 3.6.4); real OD plan POST `/api/v1/journeys/plan` returns 3 real OTP alternatives (MIKROTRANS+WALK+KRL etc.); invalid coordinates → `INVALID_PARAMETER`; ocean OD → truthful `NO_ROUTE`; unknown snapshot → 503 without detail leak.
- `pnpm check:integration`: PASS 31/31 against isolated product DB (self-cleaning fixtures).
- `pnpm acceptance:v1:multi-od`: PASS against real OTP/API/DB. Place-search-resolved Bogor–Cilebut, Kelapa Gading–Manggarai, and Lebak Bulus–Fatmawati corridors return scheduled alternatives; `FASTEST`, `FEWEST_TRANSFERS`, and `LEAST_WALKING` first-option invariants hold. Manggarai–Kemang uses an explicitly approximate coordinate (no fabricated POI) and returns 3 alternatives.
- `pnpm --filter @transum-in/web test` (smoke via web proxy): PASS — real OTP plan, activation, progress immutability.
- `pnpm --filter @transum-in/web test:browser:e2e` (Playwright/Chrome, two independent browser contexts, real OTP + DB): PASS — targeted alert isolation (1 affected / 0 unrelated), recovery `COMPLETED` with blocked-entity avoidance, SSE reconnect; screenshots in ignored `data/processed/product-p1r-browser/`.
- `pnpm typecheck`, `pnpm lint`, `pnpm openapi:validate`, `pnpm api:types:check`: PASS.
- OTP runtime re-provisioned from accepted local artifacts: graph `ad9fdd3e…331574`, JAR `8acd2808…a7990`, JRE `5b02bcc9…37e1b`; OTP 2.10.0 health PASS on `127.0.0.1:8080`.
- Protected volumes (`transum-in-nexus-postgres-data`, `transumin-foundation_transumin_postgres_data`) untouched; product uses new volume `transum-in-nexus-product-postgres-data` on port 5435.
- A locally generated product DB credential was accidentally printed in one agent transcript; it was rotated immediately via `ALTER ROLE` and never committed. `.env` is ignored with mode 0600.

## Acceptance state

- M0: PASS (remote verified).
- M1: PASS (real API + isolated DB + OTP + browser smoke).
- M2 (generalized planning): PASS (`pnpm acceptance:v1:multi-od`; place-search-resolved named corridors plus one approximate-coordinate destination; preference-ranking invariants verified; evidence JSON in ignored `data/processed/acceptance/`).
- M3–M7: NOT_RUN.
- V01–V20 and S01–S14: retain statuses in `PROTOTYPE-V1-CAPABILITY-AND-COVERAGE.md`; no new PASS claimed.

## Known gaps

- Route geometry API/map, GPS consent flow, explicit boarding/alighting confirmation UI, and passenger-report submission boundary are not yet implemented.
- POI search beyond stops/stations remains blocked pending approved source/version/license/attribution and ingest scope.
- Spatial `validate`/`ingest` require ~8 GiB Node heap for the OPL walking-graph build.
- Local DB credential rotation history above is recorded for security traceability.

## Next action

Implement M3 interactive geographic map (origin/destination markers, leg geometry via OTP leg polyline/steps, boarding/alighting and transfer markers, provider attribution) with geometry-level browser validation.
