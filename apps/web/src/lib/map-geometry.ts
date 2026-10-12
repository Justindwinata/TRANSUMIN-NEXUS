export function mapGeometryPoints(coordinates: readonly number[][]): [number, number][] {
  if (
    coordinates.length < 2 ||
    coordinates.length > 10_000 ||
    coordinates.some(
      (point) =>
        point.length !== 2 ||
        !Number.isFinite(point[0]) ||
        !Number.isFinite(point[1]) ||
        Math.abs(point[0]!) > 180 ||
        Math.abs(point[1]!) > 90,
    )
  ) return [];
  // Reject the entire leg: filtering bad points would bridge unsupported gaps.
  return coordinates.map((point) => [point[0]!, point[1]!]);
}
