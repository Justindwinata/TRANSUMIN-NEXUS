import type { components } from '@transum-in/shared-types';

export type Journey = components['schemas']['Journey'];
export type JourneySegment = components['schemas']['JourneySegment'];
export type JourneyAlert = components['schemas']['JourneyAlert'];
export type RecoveryAcceptance = components['schemas']['RecoveryAcceptance'];
export type Recovery = components['schemas']['Recovery'];
export type TransitPlace = components['schemas']['TransitPlace'];
export type PassengerReport = Readonly<{
  report_id: string;
  active_journey_id: string | null;
  category: string;
  observed_at: string;
  received_at: string;
  mobility_entity_id: string;
  entity_type: 'STOP' | 'STATION' | 'ROUTE';
  description: string;
  source: 'PASSENGER_SELF_REPORT';
  verification_status: 'REPORTED_UNVERIFIED' | 'CONTROLLED_VERIFIED';
  created_at: string;
}>;

export type PassengerReportTarget = Readonly<{
  key: string;
  id: string;
  type: 'STOP' | 'STATION' | 'ROUTE';
  label: string;
  provenance: string;
}>;

export function remainingReportTargets(
  journey: Journey,
  completedCount: number,
): PassengerReportTarget[] {
  const remaining = journey.segments.filter(
    (segment) => segment.sequence >= completedCount,
  );
  const byKey = new Map<string, PassengerReportTarget>();
  for (const segment of remaining) {
    for (const binding of segment.entity_bindings) {
      if (
        !binding.mobility_entity_id ||
        !['STOP', 'STATION', 'ROUTE'].includes(binding.entity_type)
      )
        continue;
      const key = `${binding.mobility_entity_id}:${binding.entity_type}`;
      if (byKey.has(key)) continue;
      const label =
        binding.entity_type === 'ROUTE'
          ? `${passengerRouteName(segment) || modeName(segment.mode)} · ${binding.entity_type}`
          : `${segment.from.name} – ${segment.to.name} · ${binding.entity_type}`;
      byKey.set(key, {
        key,
        id: binding.mobility_entity_id,
        type: binding.entity_type as PassengerReportTarget['type'],
        label,
        provenance: binding.provenance_ref || 'provenance: tidak tersedia',
      });
    }
  }
  return [...byKey.values()];
}

export function isValidReportDescription(value: string): boolean {
  const trimmed = value.trim();
  return (
    trimmed.length >= 1 && trimmed.length <= 2000 && !/\p{Cc}/u.test(value)
  );
}

const names: Record<JourneySegment['mode'], string> = {
  WALK: 'Walk',
  TRANSJAKARTA: 'TransJakarta',
  MIKROTRANS: 'Mikrotrans',
  KRL: 'KRL Commuter Line',
  MRT_JAKARTA: 'MRT Jakarta',
  LRT_JAKARTA: 'LRT Jakarta',
  LRT_JABODEBEK: 'LRT Jabodebek',
};

export function modeName(mode: JourneySegment['mode']): string {
  return names[mode];
}

export type JourneyPreference =
  'BALANCED' | 'FASTEST' | 'FEWEST_TRANSFERS' | 'LEAST_WALKING';

export function easiestAmongShown(journeys: readonly Journey[]): string[] {
  const valid = journeys.filter(
    (journey) =>
      Number.isInteger(journey.transfer_count) &&
      journey.transfer_count >= 0 &&
      Number.isFinite(journey.walking_distance_meters) &&
      journey.walking_distance_meters >= 0,
  );
  if (valid.length === 0) return [];
  // Product-only heuristic: fewest transfers, then least walking; no weighted research metric.
  const transfers = Math.min(...valid.map((journey) => journey.transfer_count));
  const simplest = valid.filter(
    (journey) => journey.transfer_count === transfers,
  );
  const walking = Math.min(
    ...simplest.map((journey) => journey.walking_distance_meters),
  );
  return simplest
    .filter((journey) => journey.walking_distance_meters === walking)
    .map((journey) => journey.journey_id);
}

export function passengerRouteName(segment: JourneySegment): string {
  const value = segment.route_short_name?.trim() ?? '';
  return value === segment.mode ? '' : value;
}

export function transferLabel(count: number): string {
  return `${count} ${count === 1 ? 'transfer' : 'transfers'}`;
}

export function formatClock(value: string): string {
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(value));
}

export function formatDuration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} jam ${minutes % 60} min`;
}

export function formatDistance(metres: number): string {
  return metres < 1000
    ? `${Math.round(metres)} m`
    : `${(metres / 1000).toFixed(1)} km`;
}

export function toJakartaIso(local: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local))
    throw new Error('Choose a valid departure date and time.');
  const value = `${local}:00+07:00`;
  if (!Number.isFinite(Date.parse(value)))
    throw new Error('Choose a valid departure date and time.');
  return value;
}

export function initialJakartaDateTime(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const part = (type: string) =>
    parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
}

export function parsePoint(
  latitude: string,
  longitude: string,
): { latitude: number; longitude: number } {
  const lat = Number(latitude);
  const lon = Number(longitude);
  if (
    !latitude.trim() ||
    !longitude.trim() ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    lat < -90 ||
    lat > 90 ||
    lon < -180 ||
    lon > 180
  ) {
    throw new Error('Enter valid latitude and longitude for both places.');
  }
  return { latitude: lat, longitude: lon };
}

export function segmentPosition(
  sequence: number,
  completedCount: number,
): 'completed' | 'current' | 'upcoming' {
  if (sequence < completedCount) return 'completed';
  if (sequence === completedCount) return 'current';
  return 'upcoming';
}

export function alertIsCurrent(alert: JourneyAlert, at = Date.now()): boolean {
  return (
    alert.resolved_at === null &&
    alert.freshness_status !== 'EXPIRED' &&
    (alert.expires_at === null || Date.parse(alert.expires_at) > at)
  );
}

export function evidenceLabel(evidence: string | null): string {
  switch (evidence) {
    case 'LIVE':
      return 'Live operator evidence';
    case 'OBSERVED':
      return 'Observed report';
    case 'SIMULATED':
      return 'Controlled simulation';
    case 'FORECAST':
      return 'Forecast';
    case 'SCHEDULED':
      return 'Scheduled data';
    case 'ESTIMATED':
      return 'Estimate';
    default:
      return 'Evidence not confirmed';
  }
}

export function distinctModes(journey: Journey): JourneySegment['mode'][] {
  return [...new Set(journey.segments.map((segment) => segment.mode))];
}

export function recoveryPart(
  sequence: number,
  recovery: Recovery,
): 'COMPLETED' | 'PRESERVED' | 'INVALIDATED' | 'REJOINED' | 'REPLACED' {
  if (recovery.completed_segments.includes(sequence)) return 'COMPLETED';
  if (recovery.rejoined_segments.includes(sequence)) return 'REJOINED';
  if (recovery.preserved_segments.includes(sequence)) return 'PRESERVED';
  if (recovery.invalidated_segments.includes(sequence)) return 'INVALIDATED';
  return 'REPLACED';
}

export function recoveryPartLabel(
  part: ReturnType<typeof recoveryPart>,
): string {
  return {
    COMPLETED: 'Already completed',
    PRESERVED: 'Stays the same',
    INVALIDATED: 'Changed in new route',
    REJOINED: 'Rejoins original trip',
    REPLACED: 'Replaced by new route',
  }[part];
}

export function samePassengerLeg(
  left: JourneySegment,
  right: JourneySegment,
): boolean {
  return (
    left.mode === right.mode &&
    left.route_id === right.route_id &&
    left.from.name === right.from.name &&
    left.to.name === right.to.name &&
    left.start_at === right.start_at &&
    left.end_at === right.end_at
  );
}

export function recoverySummary(recovery: Recovery): string {
  if (recovery.status !== 'COMPLETED' || !recovery.proposed_journey)
    return 'Tidak ada rute pengganti yang aman untuk kondisi saat ini. Rencana awal Anda tidak berubah.';
  const kept =
    recovery.preserved_segments.length + recovery.rejoined_segments.length;
  const parts = [
    `Keeps ${kept} part${kept === 1 ? '' : 's'} of your remaining trip`,
    recovery.additional_duration_seconds === null
      ? 'time difference unavailable'
      : `${recovery.additional_duration_seconds >= 0 ? '+' : '−'}${formatDuration(Math.abs(recovery.additional_duration_seconds))}`,
    recovery.additional_transfers === null
      ? 'transfer difference unavailable'
      : recovery.additional_transfers === 0
        ? 'no additional transfers'
        : `${recovery.additional_transfers > 0 ? '+' : ''}${recovery.additional_transfers} transfers`,
  ];
  return parts.join(' · ');
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return 'The request could not be completed.';
}

export function journeySearchFailure(error: unknown): {
  empty: boolean;
  message: string;
} {
  const coded = error as { code?: string; status?: number } | null;
  if (
    coded?.code === 'NO_ROUTE' ||
    coded?.code === 'NO_VALID_ROUTE_AFTER_STATE_VALIDATION'
  )
    return {
      empty: true,
      message:
        'No usable journey was found. Try another departure time or destination.',
    };
  if (coded?.code === 'ROUTER_UNAVAILABLE' || coded?.status === 503)
    return {
      empty: false,
      message:
        'Journey routing is temporarily unavailable. This search was not replaced with an estimate.',
    };
  return { empty: false, message: errorMessage(error) };
}
