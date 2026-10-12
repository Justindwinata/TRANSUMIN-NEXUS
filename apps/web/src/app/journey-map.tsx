'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  LngLatBounds,
  Map as MapLibreMap,
  Marker,
  NavigationControl,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { mapGeometryPoints } from '../lib/map-geometry';
import type { Journey, JourneySegment } from '../lib/passenger';

const colors: Readonly<Record<JourneySegment['mode'], string>> = {
  WALK: '#6b7a82',
  TRANSJAKARTA: '#17697a',
  MIKROTRANS: '#537b86',
  KRL: '#3563a8',
  MRT_JAKARTA: '#a8483f',
  LRT_JAKARTA: '#4f8a4c',
  LRT_JABODEBEK: '#775aa8',
};

type Point = readonly [number, number];
type JourneyMarker = Readonly<{
  id: string;
  kind: 'origin' | 'destination' | 'boarding' | 'alighting' | 'transfer';
  symbol: 'O' | 'D' | 'B' | 'A' | 'T';
  label: string;
  point: Point;
}>;

type Props = Readonly<{
  journey: Journey;
}>;

export function JourneyMap({ journey }: Props) {
  const labelId = useId().replaceAll(':', '-');
  const mapNode = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [mapError, setMapError] = useState('');
  const [mapReady, setMapReady] = useState(false);
  const segments = useMemo(
    () =>
      journey.segments.map((segment) => ({
        ...segment,
        points: toPoints(segment.geometry?.coordinates ?? []),
      })),
    [journey.segments],
  );
  const renderableSegments = useMemo(
    () => segments.filter((segment) => segment.points.length >= 2),
    [segments],
  );
  const markers = useMemo(() => journeyMarkers(journey), [journey.segments]);

  useEffect(() => {
    if (!mapNode.current || renderableSegments.length === 0) return;
    const map = new MapLibreMap({
      container: mapNode.current,
      attributionControl: false,
      interactive: true,
      style: {
        version: 8,
        sources: {
          osm: {
            type: 'raster',
            tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
            tileSize: 256,
            attribution: '© OpenStreetMap contributors',
          },
        },
        layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
      },
      center: [renderableSegments[0]!.points[0]![0], renderableSegments[0]!.points[0]![1]],
      zoom: 10,
    });
    mapRef.current = map;
    map.addControl(new NavigationControl({ showCompass: false }), 'top-right');
    const onError = () =>
      setMapError(
        'Map tiles or route layer could not load. Text itinerary remains available.',
      );
    map.on('error', onError);
    map.on('moveend', () => {
      const center = map.getCenter();
      mapNode.current?.setAttribute(
        'data-map-view',
        `${center.lng.toFixed(5)},${center.lat.toFixed(5)},${map.getZoom().toFixed(2)}`,
      );
    });
    map.on('load', () => {
      const all = renderableSegments.flatMap((segment) => segment.points);
      setMapReady(true);
      const bounds = all.reduce(
        (result, point) => result.extend(point as [number, number]),
        new LngLatBounds(
          all[0] as [number, number],
          all[0] as [number, number],
        ),
      );
      map.fitBounds(bounds, { padding: 48, maxZoom: 14, duration: 0 });
      mapNode.current?.setAttribute('data-fit-bounds', bounds.toArray().flat().join(','));
      mapNode.current?.setAttribute('data-route-source-count', String(renderableSegments.length));
      mapNode.current?.setAttribute(
        'data-route-point-count',
        String(renderableSegments.reduce((count, segment) => count + segment.points.length, 0)),
      );
      mapNode.current?.setAttribute('data-marker-count', String(markers.length));
      for (const segment of renderableSegments) {
        const id = `journey-${journey.journey_id}-segment-${segment.sequence}`;
        map.addSource(id, {
          type: 'geojson',
          data: {
            type: 'Feature',
            properties: {},
            geometry: { type: 'LineString', coordinates: segment.points },
          },
        });
        map.addLayer({
          id,
          type: 'line',
          source: id,
          paint: {
            'line-color': colors[segment.mode],
            'line-width': segment.mode === 'WALK' ? 3 : 5,
            'line-opacity': 0.92,
            ...(segment.mode === 'WALK'
              ? { 'line-dasharray': [1.5, 1.5] }
              : {}),
          },
          layout: { 'line-cap': 'round', 'line-join': 'round' },
        });
      }
      for (const marker of markers) {
        const element = document.createElement('div');
        element.className = `maplibre-marker map-marker ${marker.kind}`;
        element.textContent = marker.symbol;
        element.setAttribute('aria-label', marker.label);
        new Marker({ element })
          .setLngLat(marker.point as [number, number])
          .addTo(map);
      }
    });
    return () => {
      map.remove();
      mapRef.current = null;
      setMapReady(false);
    };
  }, [journey.journey_id, renderableSegments, markers]);

  const unavailableSegments = segments.filter((segment) => segment.points.length < 2);
  if (renderableSegments.length === 0)
    return (
      <p className="fine-print">
        Route geometry is unavailable. No inferred line is shown; use textual
        itinerary below.
      </p>
    );

  return (
    <figure className="journey-map" aria-labelledby={`${labelId}-caption`}>
      <div
        ref={mapNode}
        className="map-frame maplibre-frame"
        role="application"
        aria-label="Interactive selected route map. Pan and zoom are available; route details remain below."
      />
      <span className="sr-only" role="status">
        {mapReady
          ? 'Interactive route map ready.'
          : 'Loading interactive route map.'}
      </span>
      {!mapReady && !mapError && (
        <p className="fine-print" role="status">
          Loading interactive route map…
        </p>
      )}
      {mapError && (
        <p className="feedback error" role="status">
          {mapError}
        </p>
      )}
      {unavailableSegments.length > 0 && (
        <p className="fine-print" role="status">
          Partial geometry: {unavailableSegments.length} segment(s) lack valid
          navigable geometry and are not drawn on the map. The list below remains
          the source of truth.
        </p>
      )}
      <figcaption id={`${labelId}-caption`}>
        <span>
          Interactive route geometry: {journey.routing_context.provider}{' '}
          {journey.routing_context.provider_version}, scheduled snapshot. Dashed
          walking legs are unverified schematic OTP geometry, not validated
          navigation.
        </span>
        <ul className="map-legend" aria-label="Map markers">
          {markers.map((marker) => (
            <li key={marker.id}>
              <strong>{marker.symbol}</strong> {marker.label}
            </li>
          ))}
        </ul>
        <a
          href="https://www.openstreetmap.org/copyright"
          target="_blank"
          rel="noreferrer"
        >
          © OpenStreetMap contributors
        </a>
      </figcaption>
    </figure>
  );
}

function toPoints(coordinates: readonly number[][]): Point[] {
  return mapGeometryPoints(coordinates);
}

function point(endpoint: JourneySegment['from']): Point | null {
  return typeof endpoint.longitude === 'number' &&
    typeof endpoint.latitude === 'number'
    ? [endpoint.longitude, endpoint.latitude]
    : null;
}

function journeyMarkers(journey: Journey): JourneyMarker[] {
  const result: JourneyMarker[] = [];
  const first = journey.segments[0];
  const last = journey.segments.at(-1);
  const origin = first ? point(first.from) : null;
  const destination = last ? point(last.to) : null;
  if (first && origin)
    result.push({
      id: 'origin',
      kind: 'origin',
      symbol: 'O',
      label: `Origin · ${first.from.name}`,
      point: origin,
    });
  for (const segment of journey.segments) {
    if (segment.mode === 'WALK') continue;
    const from = point(segment.from);
    const to = point(segment.to);
    if (from)
      result.push({
        id: `boarding-${segment.sequence}`,
        kind: 'boarding',
        symbol: 'B',
        label: `Board ${segment.mode} · ${segment.from.name}`,
        point: from,
      });
    if (to)
      result.push({
        id: `alighting-${segment.sequence}`,
        kind: 'alighting',
        symbol: 'A',
        label: `Alight · ${segment.to.name}`,
        point: to,
      });
  }
  for (const segment of journey.segments) {
    if (segment.mode !== 'WALK') continue;
    const previous = journey.segments
      .slice(0, segment.sequence)
      .findLast((item) => item.mode !== 'WALK');
    const next = journey.segments
      .slice(segment.sequence + 1)
      .find((item) => item.mode !== 'WALK');
    const transfer = point(segment.from);
    if (previous && next && transfer)
      result.push({
        id: `transfer-${segment.sequence}`,
        kind: 'transfer',
        symbol: 'T',
        label: `Transfer walk · ${segment.from.name} to ${segment.to.name}`,
        point: transfer,
      });
  }
  if (last && destination)
    result.push({
      id: 'destination',
      kind: 'destination',
      symbol: 'D',
      label: `Destination · ${last.to.name}`,
      point: destination,
    });
  return result;
}
