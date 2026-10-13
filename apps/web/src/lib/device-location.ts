export const GPS_ACCURACY_THRESHOLD_M = 50;
export const GPS_STALE_MS = 30_000;

export type GpsState =
  | 'GPS_OFF'
  | 'GPS_REQUESTING_PERMISSION'
  | 'GPS_TRACKING'
  | 'GPS_ACCURACY_LOW'
  | 'GPS_STALE'
  | 'GPS_PERMISSION_DENIED'
  | 'GPS_UNAVAILABLE'
  | 'GPS_ERROR'
  | 'GPS_STOPPED';

export const GPS_STATE = {
  GPS_OFF: 'GPS_OFF',
  GPS_REQUESTING_PERMISSION: 'GPS_REQUESTING_PERMISSION',
  GPS_TRACKING: 'GPS_TRACKING',
  GPS_ACCURACY_LOW: 'GPS_ACCURACY_LOW',
  GPS_STALE: 'GPS_STALE',
  GPS_PERMISSION_DENIED: 'GPS_PERMISSION_DENIED',
  GPS_UNAVAILABLE: 'GPS_UNAVAILABLE',
  GPS_ERROR: 'GPS_ERROR',
  GPS_STOPPED: 'GPS_STOPPED',
} as const;

export type GpsSample = Readonly<{
  latitude: number;
  longitude: number;
  accuracy: number | null;
  heading: number | null;
  timestamp: number;
}>;

export function gpsErrorState(code: number): GpsState {
  if (code === 1) return 'GPS_PERMISSION_DENIED';
  if (code === 2) return 'GPS_UNAVAILABLE';
  return 'GPS_ERROR';
}

export function gpsFreshness(sample: GpsSample | null, now: number): GpsState {
  if (
    !sample ||
    !Number.isFinite(now) ||
    now - sample.timestamp >= GPS_STALE_MS
  )
    return 'GPS_STALE';
  // 50m is a display-quality cutoff, not route-matching or operational truth.
  return sample.accuracy === null || sample.accuracy > GPS_ACCURACY_THRESHOLD_M
    ? 'GPS_ACCURACY_LOW'
    : 'GPS_TRACKING';
}

export function gpsNext(
  current: GpsSample | null,
  next: GpsSample,
  now = Date.now(),
): { sample: GpsSample | null; state: GpsState } {
  if (
    !Number.isFinite(next.latitude) ||
    Math.abs(next.latitude) > 90 ||
    !Number.isFinite(next.longitude) ||
    Math.abs(next.longitude) > 180 ||
    !Number.isFinite(next.timestamp) ||
    next.timestamp < 0 ||
    next.timestamp > now ||
    (next.accuracy !== null &&
      (!Number.isFinite(next.accuracy) || next.accuracy < 0))
  )
    return { sample: current, state: 'GPS_ERROR' };
  if (current && next.timestamp <= current.timestamp)
    return { sample: current, state: gpsFreshness(current, now) };
  const accurate =
    next.accuracy !== null && next.accuracy <= GPS_ACCURACY_THRESHOLD_M;
  const withinJitter =
    current &&
    distanceMeters(current, next) <=
      Math.max(current.accuracy ?? 0, next.accuracy ?? 0);
  const sample = {
    ...next,
    ...(withinJitter
      ? { latitude: current.latitude, longitude: current.longitude }
      : {}),
    heading:
      accurate &&
      next.heading !== null &&
      Number.isFinite(next.heading) &&
      next.heading >= 0 &&
      next.heading < 360
        ? next.heading
        : null,
  };
  return { sample, state: gpsFreshness(sample, now) };
}

export function distanceMeters(a: GpsSample, b: GpsSample): number {
  const rad = Math.PI / 180;
  const h =
    Math.sin(((b.latitude - a.latitude) * rad) / 2) ** 2 +
    Math.cos(a.latitude * rad) *
      Math.cos(b.latitude * rad) *
      Math.sin(((b.longitude - a.longitude) * rad) / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(Math.min(1, h)));
}
