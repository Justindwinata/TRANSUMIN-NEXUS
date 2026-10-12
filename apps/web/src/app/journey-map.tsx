'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { Journey, JourneySegment } from '../lib/passenger';

const tileSize = 256;
const legColors: Readonly<Record<JourneySegment['mode'], string>> = {
  WALK: '#6b7a82',
  TRANSJAKARTA: '#17697a',
  MIKROTRANS: '#537b86',
  KRL: '#3563a8',
  MRT_JAKARTA: '#a8483f',
  LRT_JAKARTA: '#4f8a4c',
  LRT_JABODEBEK: '#775aa8',
};

type Point = readonly [number, number];
type Size = Readonly<{ width: number; height: number }>;
type Marker = Readonly<{
  id: string;
  kind: 'origin' | 'destination' | 'boarding' | 'alighting' | 'transfer';
  symbol: 'O' | 'D' | 'B' | 'A' | 'T';
  label: string;
  point: Point;
}>;

export function JourneyMap({ journey }: Readonly<{ journey: Journey }>) {
  const labelId = useId().replaceAll(':', '-');
  const frameRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const geometry = journey.segments.flatMap((segment) =>
    toPoints(segment.geometry?.coordinates ?? []),
  );

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(entry?.contentRect.width ?? 0),
    );
    observer.observe(frame);
    setWidth(frame.clientWidth);
    return () => observer.disconnect();
  }, []);

  if (geometry.length < 2)
    return (
      <p className="fine-print">
        Route geometry is unavailable for this journey. No inferred line is
        shown.
      </p>
    );

  const size = { width: Math.max(width, 280), height: width > 560 ? 360 : 280 };
  const bounds = findBounds(geometry);
  const center: Point = [
    (bounds.minLongitude + bounds.maxLongitude) / 2,
    (bounds.minLatitude + bounds.maxLatitude) / 2,
  ];
  const zoom = fitZoom(bounds, size);
  const markers = journeyMarkers(journey);

  return (
    <figure className="journey-map" aria-labelledby={`${labelId}-caption`}>
      <div ref={frameRef} className="map-frame" style={{ height: size.height }}>
        <div className="map-tiles" aria-hidden="true">
          {visibleTiles(center, zoom, size).map((tile) => (
            // Native image is intentional: slippy-map tiles are dynamic external resources.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={`${zoom}/${tile.x}/${tile.y}`}
              src={`https://tile.openstreetmap.org/${zoom}/${tile.x}/${tile.y}.png`}
              alt=""
              width={tileSize}
              height={tileSize}
              loading="lazy"
              draggable={false}
              style={{ left: tile.left, top: tile.top }}
            />
          ))}
        </div>
        <svg
          className="map-overlay"
          viewBox={`0 0 ${size.width} ${size.height}`}
          role="img"
          aria-label="Selected route with origin, destination, boarding, alighting, and transfer markers"
        >
          {journey.segments.map((segment) => {
            const points = toPoints(segment.geometry?.coordinates ?? []);
            if (points.length < 2) return null;
            return (
              <polyline
                key={segment.sequence}
                data-segment={segment.sequence}
                data-mode={segment.mode}
                points={points
                  .map((point) => pixel(point, center, zoom, size))
                  .map(({ x, y }) => `${x.toFixed(1)},${y.toFixed(1)}`)
                  .join(' ')}
                fill="none"
                stroke={legColors[segment.mode]}
                strokeWidth={segment.mode === 'WALK' ? 2.5 : 4}
                strokeDasharray={segment.mode === 'WALK' ? '6 5' : undefined}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            );
          })}
          {markers.map((marker) => {
            const { x, y } = pixel(marker.point, center, zoom, size);
            return (
              <g
                key={marker.id}
                className={`map-marker ${marker.kind}`}
                transform={`translate(${x},${y})`}
              >
                <circle r="9" />
                <text textAnchor="middle" dominantBaseline="central">
                  {marker.symbol}
                </text>
              </g>
            );
          })}
        </svg>
        <div className="map-attribution">
          &copy;{' '}
          <a
            href="https://www.openstreetmap.org/copyright"
            target="_blank"
            rel="noreferrer"
          >
            OpenStreetMap contributors
          </a>
        </div>
      </div>
      <figcaption id={`${labelId}-caption`}>
        <span>
          Route geometry: {journey.routing_context.provider}{' '}
          {journey.routing_context.provider_version}, scheduled snapshot. Walk
          geometry is estimated.
        </span>
        <ul className="map-legend" aria-label="Map markers">
          {markers.map((marker) => (
            <li key={`legend-${marker.id}`}>
              <strong>{marker.symbol}</strong> {marker.label}
            </li>
          ))}
        </ul>
      </figcaption>
    </figure>
  );
}

function toPoints(coordinates: readonly number[][]): Point[] {
  return coordinates.flatMap((coordinate) =>
    coordinate.length === 2 &&
    Number.isFinite(coordinate[0]) &&
    Number.isFinite(coordinate[1])
      ? [[coordinate[0]!, coordinate[1]!] as Point]
      : [],
  );
}

function point(endpoint: JourneySegment['from']): Point | null {
  return typeof endpoint.longitude === 'number' &&
    typeof endpoint.latitude === 'number'
    ? [endpoint.longitude, endpoint.latitude]
    : null;
}

function journeyMarkers(journey: Journey): Marker[] {
  const markers: Marker[] = [];
  const segments = journey.segments;
  const first = segments[0];
  const last = segments.at(-1);
  const origin = first ? point(first.from) : null;
  const destination = last ? point(last.to) : null;
  if (first && origin)
    markers.push({
      id: 'origin',
      kind: 'origin',
      symbol: 'O',
      label: `Origin · ${first.from.name}`,
      point: origin,
    });
  for (const segment of segments) {
    if (segment.mode === 'WALK') continue;
    const boarding = point(segment.from);
    const alighting = point(segment.to);
    if (boarding)
      markers.push({
        id: `boarding-${segment.sequence}`,
        kind: 'boarding',
        symbol: 'B',
        label: `Board ${segment.mode} · ${segment.from.name}`,
        point: boarding,
      });
    if (alighting)
      markers.push({
        id: `alighting-${segment.sequence}`,
        kind: 'alighting',
        symbol: 'A',
        label: `Alight · ${segment.to.name}`,
        point: alighting,
      });
  }
  for (const segment of segments) {
    if (segment.mode !== 'WALK') continue;
    const previousTransit = segments
      .slice(0, segment.sequence)
      .findLast((candidate) => candidate.mode !== 'WALK');
    const nextTransit = segments
      .slice(segment.sequence + 1)
      .find((candidate) => candidate.mode !== 'WALK');
    const transfer = point(segment.from);
    if (previousTransit && nextTransit && transfer)
      markers.push({
        id: `transfer-${segment.sequence}`,
        kind: 'transfer',
        symbol: 'T',
        label: `Transfer walk · ${segment.from.name} to ${segment.to.name}`,
        point: transfer,
      });
  }
  if (last && destination)
    markers.push({
      id: 'destination',
      kind: 'destination',
      symbol: 'D',
      label: `Destination · ${last.to.name}`,
      point: destination,
    });
  return markers;
}

function longitudeX(longitude: number, zoom: number) {
  return ((longitude + 180) / 360) * 2 ** zoom;
}
function latitudeY(latitude: number, zoom: number) {
  const radians = (latitude * Math.PI) / 180;
  return (
    ((1 - Math.log(Math.tan(radians) + 1 / Math.cos(radians)) / Math.PI) / 2) *
    2 ** zoom
  );
}
function pixel(point: Point, center: Point, zoom: number, size: Size) {
  return {
    x:
      (longitudeX(point[0], zoom) - longitudeX(center[0], zoom)) * tileSize +
      size.width / 2,
    y:
      (latitudeY(point[1], zoom) - latitudeY(center[1], zoom)) * tileSize +
      size.height / 2,
  };
}
function findBounds(points: readonly Point[]) {
  return points.reduce(
    (bounds, [longitude, latitude]) => ({
      minLongitude: Math.min(bounds.minLongitude, longitude),
      maxLongitude: Math.max(bounds.maxLongitude, longitude),
      minLatitude: Math.min(bounds.minLatitude, latitude),
      maxLatitude: Math.max(bounds.maxLatitude, latitude),
    }),
    {
      minLongitude: Infinity,
      maxLongitude: -Infinity,
      minLatitude: Infinity,
      maxLatitude: -Infinity,
    },
  );
}
function fitZoom(bounds: ReturnType<typeof findBounds>, size: Size) {
  for (let zoom = 15; zoom >= 2; zoom -= 1) {
    const width =
      (longitudeX(bounds.maxLongitude, zoom) -
        longitudeX(bounds.minLongitude, zoom)) *
      tileSize;
    const height =
      (latitudeY(bounds.minLatitude, zoom) -
        latitudeY(bounds.maxLatitude, zoom)) *
      tileSize;
    if (width <= size.width * 0.72 && height <= size.height * 0.68) return zoom;
  }
  return 2;
}
function visibleTiles(center: Point, zoom: number, size: Size) {
  const centerX = longitudeX(center[0], zoom);
  const centerY = latitudeY(center[1], zoom);
  const firstX = Math.floor(centerX - size.width / tileSize / 2) - 1;
  const lastX = Math.ceil(centerX + size.width / tileSize / 2) + 1;
  const firstY = Math.floor(centerY - size.height / tileSize / 2) - 1;
  const lastY = Math.ceil(centerY + size.height / tileSize / 2) + 1;
  const limit = 2 ** zoom;
  const tiles = [];
  for (let x = Math.max(0, firstX); x <= Math.min(limit - 1, lastX); x += 1)
    for (let y = Math.max(0, firstY); y <= Math.min(limit - 1, lastY); y += 1)
      tiles.push({
        x,
        y,
        left: (x - centerX) * tileSize + size.width / 2,
        top: (y - centerY) * tileSize + size.height / 2,
      });
  return tiles;
}
