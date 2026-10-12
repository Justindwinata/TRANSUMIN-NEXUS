import type { RecoveryImpact, RecoveryProposal } from '../domain/recovery.js';

export const RECOVERY_REPOSITORY = Symbol('RECOVERY_REPOSITORY');

export interface RecoveryRepositoryPort {
  findByIdempotency(
    ownerRef: string,
    idempotencyKey: string,
  ): Promise<RecoveryProposal | null>;
  getCurrentImpact(
    impactId: string,
    journeyId: string,
    ownerRef: string,
  ): Promise<RecoveryImpact | null>;
  save(
    proposal: RecoveryProposal,
    idempotencyKey: string,
  ): Promise<RecoveryProposal>;
  get(recoveryId: string, ownerRef: string): Promise<RecoveryProposal>;
}
