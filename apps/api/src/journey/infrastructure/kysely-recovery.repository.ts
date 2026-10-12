import { Inject, Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';

import {
  DATABASE,
  type FoundationDatabase,
} from '../../infrastructure/database/database.constants.js';
import { stableUuid } from '../../spatial/domain/spatial-identity.js';
import type { RecoveryRepositoryPort } from '../application/recovery.repository.port.js';
import type { RecoveryImpact, RecoveryProposal } from '../domain/recovery.js';
import { RecoveryError } from '../domain/recovery.js';

@Injectable()
export class KyselyRecoveryRepository implements RecoveryRepositoryPort {
  constructor(
    @Inject(DATABASE)
    private readonly database: Kysely<FoundationDatabase>,
  ) {}

  async findByIdempotency(
    ownerRef: string,
    idempotencyKey: string,
  ): Promise<RecoveryProposal | null> {
    const result = await sql<{ proposal: RecoveryProposal }>`
      select comparison_json as proposal from recovery.recovery_plan
      where owner_ref=${ownerRef} and idempotency_key=${idempotencyKey}
    `.execute(this.database);
    return result.rows[0]?.proposal ?? null;
  }

  async getCurrentImpact(
    impactId: string,
    journeyId: string,
    ownerRef: string,
  ): Promise<RecoveryImpact | null> {
    const result = await sql<RecoveryImpact>`
      select distinct i.id as "impactId", i.journey_id as "journeyId",
        i.mobility_entity_id as "mobilityEntityId",
        i.state_transition_id as "stateTransitionId",
        i.operational_state as "operationalState",
        i.projection_version as "projectionVersion",
        i.provenance_ref as "provenanceRef"
      from journey.journey_impact i
      join journey.journey_plan p on p.id=i.journey_id
      join journey.active_journey a on a.journey_id=i.journey_id
      join journey.journey_progress pr on pr.journey_id=i.journey_id
      join journey.journey_impact_dependency x on x.impact_id=i.id
      join journey.journey_dependency d on d.id=x.dependency_id
      where i.id=${impactId}::uuid and i.journey_id=${journeyId}::uuid
        and p.owner_ref=${ownerRef} and a.lifecycle_status='ACTIVE'
        and i.impact_status='BLOCKING' and i.resolved_at is null
        and d.leg_sequence >= pr.completed_leg_count
    `.execute(this.database);
    return result.rows[0] ?? null;
  }

  async save(
    proposal: RecoveryProposal,
    idempotencyKey: string,
  ): Promise<RecoveryProposal> {
    return this.database.transaction().execute(async (transaction) => {
      const inserted = await sql<{ id: string }>`
        insert into recovery.recovery_plan (
          id, active_journey_id, impact_id, owner_ref, idempotency_key,
          method, status, progress_revision, completed_leg_count,
          recovery_anchor_name, recovery_anchor_lat, recovery_anchor_lon,
          recovery_at, network_snapshot_id, mobility_projection_version,
          original_journey_fingerprint, proposed_fingerprint, baseline_fingerprint,
          preserved_leg_count, eligible_remaining_leg_count, changed_leg_count,
          added_travel_time_seconds, added_transfers, plan_change_count,
          disrupted_entity_avoided, state_validation_ms,
          preservation_processing_ms, proposed_routing_ms, baseline_routing_ms,
          total_computation_ms, triggering_entity_id, state_transition_id,
          reason, proposed_journey_json, baseline_journey_json, comparison_json
        ) values (
          ${proposal.recoveryId}::uuid, ${proposal.activeJourneyId}::uuid,
          ${proposal.impactId}::uuid, ${proposal.ownerRef}, ${idempotencyKey},
          ${proposal.method}, ${proposal.status}, ${proposal.progressRevision},
          ${proposal.completedLegCount}, ${proposal.recoveryAnchor.name},
          ${proposal.recoveryAnchor.point.latitude}, ${proposal.recoveryAnchor.point.longitude},
          ${proposal.recoveryAt}::timestamptz, ${proposal.networkSnapshotId}::uuid,
          ${proposal.mobilityProjectionVersion}, ${proposal.originalJourneyFingerprint},
          ${proposal.proposedFingerprint}, ${proposal.baselineFingerprint},
          ${proposal.metrics.preservedLegCount},
          ${proposal.metrics.eligibleRemainingLegCount},
          ${proposal.metrics.changedLegCount},
          ${proposal.metrics.addedTravelTimeSeconds}, ${proposal.metrics.addedTransfers},
          ${proposal.metrics.planChangeCount}, ${proposal.metrics.disruptedEntityAvoidance},
          ${proposal.metrics.stateValidationMilliseconds},
          ${proposal.metrics.preservationProcessingMilliseconds},
          ${proposal.metrics.proposedRoutingMilliseconds},
          ${proposal.metrics.baselineRoutingMilliseconds},
          ${proposal.metrics.totalComputationMilliseconds},
          ${proposal.triggeringEntityId}::uuid, ${proposal.stateTransitionId}::uuid,
          ${proposal.reason}, ${JSON.stringify(proposal.proposedJourney)}::jsonb,
          ${JSON.stringify(proposal.baselineJourney)}::jsonb,
          ${JSON.stringify(proposal)}::jsonb
        ) on conflict (owner_ref, idempotency_key) do nothing returning id
      `.execute(transaction);
      if (inserted.rows[0] === undefined) {
        const existing = await sql<{
          id: string;
          impactId: string;
          progressRevision: number;
        }>`
          select id, impact_id as "impactId", progress_revision as "progressRevision"
          from recovery.recovery_plan
          where owner_ref=${proposal.ownerRef} and idempotency_key=${idempotencyKey}
        `.execute(transaction);
        const row = existing.rows[0];
        if (
          row === undefined ||
          row.impactId !== proposal.impactId ||
          row.progressRevision !== proposal.progressRevision
        )
          throw new RecoveryError(
            'IDEMPOTENCY_CONFLICT',
            'The idempotency key belongs to different recovery input.',
          );
        return this.get(row.id, proposal.ownerRef);
      }
      let sequence = 0;
      for (const [classification, structure, legs] of [
        ['COMPLETED', 'COMPLETED', proposal.completedLegs],
        ['STILL_VALID', 'PRESERVED', proposal.preservedLegs],
        ['INVALIDATED', 'INVALIDATED', proposal.invalidatedLegs],
        ['REPAIRED_REPLACED', 'REPAIRED', proposal.repairedLegs],
        ['STILL_VALID', 'REJOINED', proposal.rejoinedLegs],
      ] as const)
        for (const leg of legs) {
          await sql`
            insert into recovery.recovery_segment (
              id, recovery_id, sequence, classification,
              original_leg_sequence, result_leg_json
            ) values (
              ${stableUuid('recovery-segment', `${proposal.recoveryId}:${sequence}`)}::uuid,
              ${proposal.recoveryId}::uuid, ${sequence}, ${classification},
              ${structure === 'REPAIRED' ? null : leg.sequence},
              ${JSON.stringify({ ...leg, recoveryStructure: structure })}::jsonb
            )
          `.execute(transaction);
          sequence += 1;
        }
      return proposal;
    });
  }

  async get(recoveryId: string, ownerRef: string): Promise<RecoveryProposal> {
    const result = await sql<{ ownerRef: string; proposal: RecoveryProposal }>`
      select owner_ref as "ownerRef", comparison_json as proposal
      from recovery.recovery_plan where id=${recoveryId}::uuid
    `.execute(this.database);
    const row = result.rows[0];
    if (row === undefined || row.ownerRef !== ownerRef)
      throw new RecoveryError(
        'RECOVERY_NOT_FOUND',
        'Recovery proposal not found.',
      );
    return row.proposal;
  }
}
