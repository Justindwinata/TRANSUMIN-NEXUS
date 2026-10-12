# API Documentation

Phase 0.2 freezes the narrative contract in `API-CONTRACT-V1.md` and the machine-readable contract in `openapi-v1.yaml`. They define versioned resources, identifiers, envelopes, errors, evidence, scenario/run separation, idempotency, and pagination.

Phase 1A implements only `GET /api/v1/data-sources` and `GET /api/v1/data-sources/{sourceId}/versions`. Their schemas are explicit and generate the shared TypeScript contract. Other product endpoints and authentication provider/transport remain deferred.
