import type { DevicePosition } from './map-geometry';

/** Stable product state IDs from the F-04 contract. */
export type NavMode =
  | 'PREPARING'
  | 'WALK_TO_BOARDING_STOP'
  | 'WAIT_FOR_TRANSIT'
  | 'ON_TRANSIT_CONFIRMED'
  | 'ALIGHTING_PENDING'
  | 'WALK_TRANSFER'
  | 'WALK_TO_DESTINATION'
  | 'ARRIVED'
  | 'NAVIGATION_UNAVAILABLE';

export const NAV_MODE = {
  PREPARING: 'PREPARING',
  WALK_TO_BOARDING_STOP: 'WALK_TO_BOARDING_STOP',
  WAIT_FOR_TRANSIT: 'WAIT_FOR_TRANSIT',
  ON_TRANSIT_CONFIRMED: 'ON_TRANSIT_CONFIRMED',
  ALIGHTING_PENDING: 'ALIGHTING_PENDING',
  WALK_TRANSFER: 'WALK_TRANSFER',
  WALK_TO_DESTINATION: 'WALK_TO_DESTINATION',
  ARRIVED: 'ARRIVED',
  NAVIGATION_UNAVAILABLE: 'NAVIGATION_UNAVAILABLE',
} as const;

export const OFF_ROUTE_TOLERANCE_M = 120;
export const OFF_ROUTE_CONFIRM_SAMPLES = 3;
export const OFF_ROUTE_HISTORY = 8;

export type PathPoint = Readonly<{ latitude: number; longitude: number }>;

export type SegmentLike = Readonly<{
  sequence: number;
  mode: string;
  from: Readonly<{ name: string }>;
  to: Readonly<{ name: string }>;
  route_short_name?: string | null;
  geometry: Readonly<{ type: string; coordinates: readonly number[][] }> | null;
}>;

export type BoardingState = Readonly<{ boarded: boolean; alighted: boolean }>;

const EARTH_RADIUS_M = 6_371_000;

function destinationMeters(from: PathPoint, to: PathPoint): number {
  const rad = Math.PI / 180;
  const aLat = from.latitude * rad;
  const bLat = to.latitude * rad;
  const dLat = bLat - aLat;
  const dLon = (to.longitude - from.longitude) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat) * Math.cos(bLat) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function pathPoints(segment: SegmentLike | null): PathPoint[] | null {
  const coordinates = segment?.geometry?.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null;
  const points: PathPoint[] = [];
  for (const coordinate of coordinates) {
    const [longitude, latitude] = coordinate;
    if (
      !Number.isFinite(longitude) ||
      !Number.isFinite(latitude) ||
      Math.abs(latitude) > 90 ||
      Math.abs(longitude) > 180
    )
      return null;
    points.push({ latitude, longitude });
  }
  return points;
}

/** Nearest-path-vertex distance. Schematic only, not operational route matching. */
export function distanceToPathMeters(
  point: PathPoint,
  points: PathPoint[] | null,
): number | null {
  if (!point || !points || points.length === 0) return null;
  let best = Infinity;
  for (const vertex of points) {
    const d = destinationMeters(point, vertex);
    if (Number.isFinite(d) && d < best) best = d;
  }
  return Number.isFinite(best) ? best : null;
}

export function remainingPathMeters(
  startIndex: number,
  points: PathPoint[] | null,
): number | null {
  if (points === null || !Number.isInteger(startIndex) || startIndex < 0)
    return null;
  if (startIndex > points.length - 1) return null;
  let total = 0;
  for (let i = startIndex; i < points.length - 1; i += 1)
    total += destinationMeters(points[i]!, points[i + 1]!);
  return total;
}

export function nearestPathIndex(
  point: PathPoint,
  points: PathPoint[] | null,
): number | null {
  if (!point || !points || points.length === 0) return null;
  let best = Infinity;
  let bestIndex = 0;
  for (let i = 0; i < points.length; i += 1) {
    const d = destinationMeters(point, points[i]!);
    if (d < best) {
      best = d;
      bestIndex = i;
    }
  }
  return bestIndex;
}

/**
 * Walking guidance is UNVERIFIED_SCHEMATIC: the leg has geometry but no
 * validated street-level maneuvers, so we never claim a turn or street name.
 */
export function nextVertexDistanceMeters(
  point: PathPoint,
  points: PathPoint[] | null,
): number | null {
  if (!point || !points || points.length === 0) return null;
  let best = Infinity;
  let bestIndex = -1;
  for (let i = 1; i < points.length; i += 1) {
    const d = destinationMeters(point, points[i]!);
    if (d < best) {
      best = d;
      bestIndex = i;
    }
  }
  if (bestIndex < 0) return null;
  // The final vertex is the destination, already included in remaining distance.
  return bestIndex === points.length - 1 ? null : best;
}

export function navigationMode(
  segments: readonly SegmentLike[],
  completedCount: number,
  boarding: BoardingState,
): NavMode {
  if (completedCount >= segments.length) return 'ARRIVED';
  const leg = segments[completedCount];
  if (!leg) return 'NAVIGATION_UNAVAILABLE';
  if (leg.mode === 'WALK') {
    if (completedCount === 0) return 'WALK_TO_BOARDING_STOP';
    if (completedCount < segments.length - 1) return 'WALK_TRANSFER';
    return 'WALK_TO_DESTINATION';
  }
  if (boarding.boarded) {
    if (boarding.alighted && completedCount + 1 < segments.length)
      return 'ALIGHTING_PENDING';
    return 'ON_TRANSIT_CONFIRMED';
  }
  return 'WAIT_FOR_TRANSIT';
}

/** Sustained-only: one noisy sample never triggers off-route. */
export function isOffRoute(
  history: readonly { distance: number | null }[],
  points: PathPoint[] | null,
  sampleCount = OFF_ROUTE_CONFIRM_SAMPLES,
  toleranceMeters = OFF_ROUTE_TOLERANCE_M,
): boolean {
  if (points === null || points.length < 2) return false;
  if (history.length < sampleCount) return false;
  const recent = history.slice(-sampleCount);
  for (const sample of recent)
    if (sample.distance === null || sample.distance < toleranceMeters)
      return false;
  return true;
}

export type Guidance = Readonly<{
  mode: NavMode;
  title: string;
  detail: string;
  provenance:
    'SCHEMATIC_GEOMETRY' | 'CONFIRMED_STATE' | 'SCHEDULE_LABEL' | 'NO_DEVICE';
}>;

function legLabel(mode: string, shortName: string | null | undefined): string {
  return mode === 'WALK'
    ? 'Jalan kaki'
    : shortName?.trim() || 'Transportasi publik';
}

function walkingGuidance(
  leg: SegmentLike | undefined,
  transfer: boolean,
  sample: { latitude: number; longitude: number } | null,
  path: PathPoint[] | null,
): Guidance {
  const target = leg?.to?.name ?? 'titik berikutnya';
  const mode: NavMode = transfer
    ? 'WALK_TRANSFER'
    : leg?.sequence === 0
      ? 'WALK_TO_BOARDING_STOP'
      : 'WALK_TO_DESTINATION';
  const base = transfer
    ? `Jalan kaki transfer menuju ${target}`
    : `Jalan kaki menuju ${target}`;
  if (sample && path && path.length >= 2) {
    const index = nearestPathIndex(sample, path);
    const remaining = index === null ? null : remainingPathMeters(index, path);
    const nextVertex = nextVertexDistanceMeters(sample, path);
    const detail = [
      remaining === null
        ? null
        : `Tersisa ±${Math.round(remaining)} m sepanjang geometri rencana.`,
      nextVertex === null || !Number.isFinite(nextVertex)
        ? null
        : `Titik rencana berikutnya ±${Math.round(nextVertex)} m.`,
    ]
      .filter(Boolean)
      .join(' ');
    return {
      mode,
      title: base,
      detail: detail
        ? `${detail} Panduan berbasis geometri rencana (skematik, bukan petunjuk belok tervalidasi).`
        : `Ikuti geomernya; penunjuk belok tervalidasi belum tersedia.`,
      provenance: 'SCHEMATIC_GEOMETRY',
    };
  }
  return {
    mode,
    title: base,
    detail:
      'Lokasi perangkat tidak tersedia. Lanjutkan secara manual; panduan skematik, petunjuk belok tervalidasi belum tersedia.',
    provenance: 'SCHEMATIC_GEOMETRY',
  };
}

/** Guidance from the current product state and current leg only. */
export function nextGuidance(
  legs: readonly SegmentLike[],
  completedCount: number,
  boarding: BoardingState,
  sample: { latitude: number; longitude: number } | null,
): Guidance | null {
  if (completedCount >= legs.length)
    return {
      mode: 'ARRIVED',
      title: 'Perjalanan selesai',
      detail: 'Anda sudah tiba di tujuan.',
      provenance: 'CONFIRMED_STATE',
    };
  const leg = legs[completedCount];
  if (!leg)
    return {
      mode: 'NAVIGATION_UNAVAILABLE',
      title: 'Navigasi tidak tersedia',
      detail:
        'Panduan tidak dapat dibuat dari rencana ini. Gunakan penandaan manual.',
      provenance: 'NO_DEVICE',
    };
  if (leg.mode === 'WALK') {
    const transfer = completedCount > 0;
    const path = leg.geometry ? pathPoints(leg) : null;
    return walkingGuidance(leg, transfer, sample, path);
  }
  const owner = legLabel(leg.mode, leg.route_short_name ?? undefined);
  if (boarding.boarded) {
    if (boarding.alighted && completedCount + 1 < legs.length)
      return {
        mode: 'ALIGHTING_PENDING',
        title: 'Persiapan turun',
        detail: `Bersiap turun di ${leg.to?.name ?? 'halte tujuan'}; lanjut jalur berikutnya setelah konfirmasi turun.`,
        provenance: 'SCHEDULE_LABEL',
      };
    return {
      mode: 'ON_TRANSIT_CONFIRMED',
      title: `Sudah naik ${owner}`,
      detail: `Turun di ${leg.to?.name ?? 'halte tujuan'} lalu konfirmasi turun.`,
      provenance: 'SCHEDULE_LABEL',
    };
  }
  return {
    mode: 'WAIT_FOR_TRANSIT',
    title: `Menunggu ${owner}`,
    detail: `Berjalan ke ${leg.from?.name ?? 'titik keberangkatan'} dan konfirmasi naik di sana.`,
    provenance: 'SCHEDULE_LABEL',
  };
}

/** Human-readable step label hierarchy for card rendering. */
export function modeNavLabel(mode: NavMode): string {
  switch (mode) {
    case 'WALK_TO_BOARDING_STOP':
      return 'Jalan menuju halte';
    case 'WALK_TRANSFER':
      return 'Jalan transfer';
    case 'WALK_TO_DESTINATION':
      return 'Jalan menuju tujuan';
    case 'WAIT_FOR_TRANSIT':
      return 'Menunggu transportasi';
    case 'ON_TRANSIT_CONFIRMED':
      return 'Di dalam perjalanan';
    case 'ALIGHTING_PENDING':
      return 'Persiapan turun';
    case 'ARRIVED':
      return 'Tiba';
    case 'NAVIGATION_UNAVAILABLE':
      return 'Navigasi tidak tersedia';
    default:
      return 'Menyiapkan navigasi';
  }
}

export function devicePositionFromSample(
  sample: Pick<DevicePosition, 'latitude' | 'longitude'> | null,
): { latitude: number; longitude: number } | null {
  return sample
    ? { latitude: sample.latitude, longitude: sample.longitude }
    : null;
}
