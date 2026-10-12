# Isolated database and runtime bootstrap (Prototype V1)

Purpose: reproduce the isolated product database and OTP runtime used by Prototype V1 without touching protected/historical volumes. Raw GTFS/OSM artifacts are Git-ignored; only tracked manifests and registries are versioned. Do not commit or print credentials.

## 0. Prerequisites

- Docker (PostGIS image build in `infra/docker/postgis/Dockerfile`).
- Node 22 + pnpm; `pnpm install --frozen-lockfile`.
- Accepted local artifacts (Git-ignored, checksum-verified before use):
  - `data/raw/transjakarta/2026-09-29/63b4fb14d9afa7fd21737fee57991366b3f61746af12479725cc17d0cf64fb22/transjakarta-gtfs.zip` (sha256 `63b4fb14d9af…f4fb22`).
  - `data/raw/osm/2026-09-30/source/java-260929.osm.pbf` (sha256 `0d9cc074…3040bc1`), `data/raw/osm/2026-09-30/phase2a/jabodetabek-spatial-strict.osm.pbf` (sha256 `ffb2269b…e6f14f`), `data/processed/osm/2026-09-30/{rail-topology,jabodetabek-spatial-strict}.opl` (opl sha256 `946ec648…bfc481`).
  - `data/processed/routing/phase4ar/controlled-routing-snapshot.json` (sha256 `e6d2e4a7…636e3c`).
  - OTP runtime: `data/processed/routing/phase4b-a/input/graph.obj` (sha256 `ad9fdd3e…331574`), `runtime/otp-shaded-2.10.0.jar` (`8acd2808…a7990`), `runtime/temurin25-jre-macos-aarch64.tar.gz` (`5b02bcc9…37e1b`).
- The Geofabrik source PBF may be re-fetched automatically when absent and the URL is live; treat network refetch as a new provenance event, not a silent replacement (the tracked manifest pins its checksum).

## 1. Database

1. `cp .env.example .env`; set `POSTGRES_DB`, `POSTGRES_USER`, unique `POSTGRES_PASSWORD` (ignored file, never commit; rotate immediately if ever printed).
2. Set `POSTGRES_VOLUME_NAME=transum-in-nexus-product-postgres-data` and `POSTGRES_PORT=5435` (or any free local port) so the protected legacy volume `transum-in-nexus-postgres-data` is never mounted.
3. `pnpm db:up` → `pnpm db:migrate` → `pnpm db:status` (12 migrations).
4. Ingest (each CLI is idempotent):
   `pnpm data:transjakarta:validate` → `pnpm data:transjakarta:ingest` → `pnpm data:transjakarta:verify`
   `NODE_OPTIONS=--max-old-space-size=8192 pnpm --filter @transum-in/api exec tsx src/spatial/spatial.cli.ts validate` → same command with `ingest` → `pnpm data:spatial:verify`
   `pnpm data:twin:snapshot` (must report snapshot `43fb9a29-0c89-5c72-8826-e3dc2adcfb1f`)
   `pnpm data:phase4bb:identity`
   `pnpm data:phase4ba:prepare|validate` (regenerates Git-ignored OTP input feeds and must reproduce manifest sha256 `1f493716d20ad5ffa2e3628ece67f2511235f2abfacef4cd7b2b2af9f73dfb77`).
5. Copy OTP runtime artifacts into `data/processed/routing/phase4b-a/{input,runtime}` and extract the JRE (`tar -xzf …runtime/temurin25-jre-macos-aarch64.tar.gz -C …runtime/temurin25 --strip-components=1`).
6. Start OTP: `pnpm otp:preflight` → `pnpm otp:start` (`OTP_URL` default `http://127.0.0.1:8080/otp/gtfs/v1`).

## 2. Run the app

- API: `set -a; source .env; set +a; pnpm dev:api` (or `pnpm --filter @transum-in/api exec tsx src/main.ts`; env vars are read at runtime, not from dotenv).
- Web: `PASSENGER_API_BASE_URL=http://127.0.0.1:3001/api/v1 PASSENGER_NETWORK_SNAPSHOT_ID=43fb9a29-0c89-5c72-8826-e3dc2adcfb1f pnpm dev:web`.
- Verify: `curl http://127.0.0.1:3001/health/ready`; browser `GET /api/passenger/config`.

## 3. Acceptance

- `pnpm check:integration` (31 tests, self-cleaning).
- `pnpm --filter @transum-in/web test` (web proxy smoke; requires running web+API+OTP+DB).
- `pnpm --filter @transum-in/web test:browser:e2e` (Playwright + Chrome; requires `DATABASE_URL` pointing at the isolated DB; screenshots in ignored `data/processed/product-p1r-browser/`).

## Boundaries

- Never mount, inspect, or write protected historical volumes (`transum-in-nexus-postgres-data`, Phase-5B).
- Only clean up resources created by your own invocation.
- Raw artifacts are immutable; never re-ingest from an unverified download without re-freezing manifests.
