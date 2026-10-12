import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

import { Injectable } from '@nestjs/common';

import {
  productModeForRouterEntity,
  type FeedKey,
  type ProductMode,
} from '../../routing-data/domain/otp-input.js';
import type {
  JourneyRoutingPort,
  RouterHealth,
  RouterPlanRequest,
} from '../application/journey-routing.port.js';
import {
  type JourneyAlternative,
  type JourneyLeg,
  type JourneyTimingPrecision,
  JourneyRoutingError,
} from '../domain/journey.js';

const repositoryRoot = fileURLToPath(
  new URL('../../../../../', import.meta.url),
);
const routerManifestPath = path.join(
  repositoryRoot,
  'data/manifests/PHASE-4B-A-ROUTER-INPUT.json',
);
const runtimeManifestPath = path.join(
  repositoryRoot,
  'data/manifests/PHASE-4B-A-OTP-RUNTIME.json',
);

type OtpStop = Readonly<{
  gtfsId: string;
  name: string;
  lat: number;
  lon: number;
}>;
type OtpLeg = Readonly<{
  mode: string;
  serviceDate: string | null;
  distance: number | null;
  duration: number | null;
  from: {
    name: string;
    lat: number;
    lon: number;
    stop: { gtfsId: string } | null;
  };
  to: {
    name: string;
    lat: number;
    lon: number;
    stop: { gtfsId: string } | null;
  };
  route: { gtfsId: string; shortName: string | null } | null;
  trip: { gtfsId: string } | null;
  intermediateStops: readonly OtpStop[] | null;
  start: { scheduledTime: string };
  end: { scheduledTime: string };
}>;
type OtpPlan = Readonly<{
  planConnection: {
    routingErrors: readonly { code: string; description: string }[];
    edges: readonly {
      node: {
        start: string;
        end: string;
        duration: number;
        walkDistance: number;
        legs: readonly OtpLeg[];
      };
    }[];
  };
}>;

type RouterManifest = Readonly<{
  snapshotId: string;
  timezone: 'Asia/Jakarta';
  serviceDates: readonly { representativeDate: string }[];
}>;
type RuntimeManifest = Readonly<{
  otp: { version: string };
  graph: { sha256: string };
}>;

const planQuery = `
query ProductJourneyPlan(
  $origin: PlanLabeledLocationInput!,
  $destination: PlanLabeledLocationInput!,
  $dateTime: PlanDateTimeInput!,
  $modes: PlanModesInput!,
  $preferences: PlanPreferencesInput,
  $first: Int!
) {
  planConnection(
    origin: $origin,
    destination: $destination,
    dateTime: $dateTime,
    modes: $modes,
    preferences: $preferences,
    itineraryFilter: {
      groupSimilarityKeepOne: 0.85,
      groupSimilarityKeepThree: 0.68
    },
    first: $first
  ) {
    routingErrors { code description }
    edges {
      node {
        start end duration walkDistance
        legs {
          mode serviceDate distance duration
          from { name lat lon stop { gtfsId } }
          to { name lat lon stop { gtfsId } }
          route { gtfsId shortName }
          trip { gtfsId }
          intermediateStops { gtfsId name lat lon }
          start { scheduledTime }
          end { scheduledTime }
        }
      }
    }
  }
}`;

@Injectable()
export class OtpJourneyRoutingAdapter implements JourneyRoutingPort {
  private readonly endpoint =
    process.env.OTP_URL ?? 'http://127.0.0.1:8080/otp/gtfs/v1';
  private readonly routerManifest = JSON.parse(
    readFileSync(routerManifestPath, 'utf8'),
  ) as RouterManifest;
  private readonly runtimeManifest = JSON.parse(
    readFileSync(runtimeManifestPath, 'utf8'),
  ) as RuntimeManifest;
  private readonly manifestSha256 = createHash('sha256')
    .update(readFileSync(routerManifestPath))
    .digest('hex');

  async planJourney(
    request: RouterPlanRequest,
  ): Promise<readonly JourneyAlternative[]> {
    const allowedModes = request.allowedModes ?? [
      'WALK',
      'TRANSJAKARTA',
      'MIKROTRANS',
      'KRL',
      'MRT_JAKARTA',
      'LRT_JAKARTA',
      'LRT_JABODEBEK',
    ];
    const otpTransitModes = [
      ...new Set(
        allowedModes.flatMap((mode) =>
          mode === 'TRANSJAKARTA' || mode === 'MIKROTRANS'
            ? ['BUS']
            : mode === 'KRL'
              ? ['RAIL']
              : mode === 'MRT_JAKARTA'
                ? ['SUBWAY']
                : mode === 'LRT_JAKARTA' || mode === 'LRT_JABODEBEK'
                  ? ['TRAM']
                  : [],
        ),
      ),
    ];
    const transitEnabled = otpTransitModes.length > 0;
    const variables = {
      origin: {
        label: 'Origin',
        location: { coordinate: request.origin },
      },
      destination: {
        label: 'Destination',
        location: { coordinate: request.destination },
      },
      dateTime: { earliestDeparture: request.departureAt },
      modes: transitEnabled
        ? {
            direct: allowedModes.includes('WALK') ? ['WALK'] : [],
            transit: {
              access: ['WALK'],
              egress: ['WALK'],
              transfer: ['WALK'],
              transit: otpTransitModes.map((mode) => ({ mode })),
            },
          }
        : { direct: ['WALK'], directOnly: true },
      preferences:
        request.excludedRouteIds.length === 0
          ? undefined
          : {
              transit: {
                filters: [{ exclude: [{ routes: request.excludedRouteIds }] }],
              },
            },
      first: Math.max(6, (request.maximumAlternatives ?? 3) * 4),
    };
    const payload = await this.query<OtpPlan>(planQuery, variables);
    const errors = payload.planConnection.routingErrors;
    if (
      payload.planConnection.edges.length === 0 &&
      errors.some((item) => item.code === 'OUTSIDE_SERVICE_PERIOD')
    )
      throw new JourneyRoutingError(
        'INVALID_TIME',
        'Requested time is outside the manifested service period.',
        { routingErrors: errors },
      );

    return payload.planConnection.edges.map(({ node }) => {
      const legs = node.legs.map((leg, sequence) =>
        normalizeLeg(leg, sequence),
      );
      return {
        journeyId: 'pending-state-validation',
        origin: request.origin,
        destination: request.destination,
        startAt: node.start,
        endAt: node.end,
        durationSeconds: node.duration,
        transferCount: Math.max(
          0,
          legs.filter((leg) => leg.mode !== 'WALK').length - 1,
        ),
        walkingDistanceMeters: node.walkDistance,
        legs,
        fareStatus: 'UNKNOWN',
        routingContext: {
          provider: 'OTP',
          providerVersion: '2.10.0',
          routingSnapshotId: this.routerManifest.snapshotId,
          routingManifestSha256: this.manifestSha256,
          graphSha256: this.runtimeManifest.graph.sha256,
          networkSnapshotId: request.networkSnapshotId,
          networkSnapshotHash: 'pending-state-validation',
          mobilityProjectionVersion: 'pending-state-validation',
          plannedAt: new Date().toISOString(),
          commonServiceDate:
            this.routerManifest.serviceDates[0]?.representativeDate ?? '',
          timezone: this.routerManifest.timezone,
          attemptCount: request.attempt,
          excludedRouteIds: request.excludedRouteIds,
        },
      };
    });
  }

  async routerHealth(): Promise<RouterHealth> {
    const started = performance.now();
    try {
      await this.query<{ __typename: string }>('{ __typename }', {});
      return {
        status: 'AVAILABLE',
        provider: 'OTP',
        version: this.runtimeManifest.otp.version,
        checkedAt: new Date().toISOString(),
        latencyMilliseconds: round(performance.now() - started),
      };
    } catch {
      return {
        status: 'UNAVAILABLE',
        provider: 'OTP',
        version: this.runtimeManifest.otp.version,
        checkedAt: new Date().toISOString(),
        latencyMilliseconds: round(performance.now() - started),
      };
    }
  }

  routingSnapshot() {
    return {
      snapshotId: this.routerManifest.snapshotId,
      manifestSha256: this.manifestSha256,
      graphSha256: this.runtimeManifest.graph.sha256,
      commonServiceDate:
        this.routerManifest.serviceDates[0]?.representativeDate ?? '',
      timezone: this.routerManifest.timezone,
    } as const;
  }

  private async query<T>(document: string, variables: object): Promise<T> {
    let response: Response;
    try {
      response = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: document, variables }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      throw new JourneyRoutingError(
        'ROUTER_UNAVAILABLE',
        'OTP could not be reached.',
        { cause: error instanceof Error ? error.message : 'unknown' },
      );
    }
    if (!response.ok)
      throw new JourneyRoutingError(
        'ROUTER_UNAVAILABLE',
        `OTP returned HTTP ${response.status}.`,
      );
    const payload = (await response.json()) as {
      data?: T;
      errors?: readonly { message: string }[];
    };
    if (payload.errors !== undefined || payload.data === undefined)
      throw new JourneyRoutingError(
        'ROUTER_UNAVAILABLE',
        'OTP returned an invalid GraphQL response.',
        { errors: payload.errors ?? [] },
      );
    return payload.data;
  }
}

export function normalizeLeg(leg: OtpLeg, sequence: number): JourneyLeg {
  const routeIdentity =
    leg.route === null ? null : parseNamespacedId(leg.route.gtfsId);
  const mode =
    routeIdentity === null
      ? ('WALK' as const)
      : productModeForRouterEntity({
          feedKey: routeIdentity.feedKey,
          otpMode: leg.mode,
        });
  return {
    sequence,
    mode,
    otpMode: leg.mode,
    from: {
      name: leg.from.name,
      otpStopId: leg.from.stop?.gtfsId ?? null,
      latitude: leg.from.lat,
      longitude: leg.from.lon,
    },
    to: {
      name: leg.to.name,
      otpStopId: leg.to.stop?.gtfsId ?? null,
      latitude: leg.to.lat,
      longitude: leg.to.lon,
    },
    intermediateStops: (leg.intermediateStops ?? []).map((stop) => ({
      name: stop.name,
      otpStopId: stop.gtfsId,
      latitude: stop.lat,
      longitude: stop.lon,
    })),
    startAt: leg.start.scheduledTime,
    endAt: leg.end.scheduledTime,
    durationSeconds: leg.duration ?? 0,
    distanceMeters: leg.distance ?? 0,
    routeId: leg.route?.gtfsId ?? null,
    routeShortName: leg.route?.shortName ?? null,
    tripId: leg.trip?.gtfsId ?? null,
    serviceDate: leg.serviceDate,
    timingPrecision: timingPrecision(mode),
    entityBindings: [],
    operationalFlags: [],
  };
}

export function parseNamespacedId(value: string): Readonly<{
  feedKey: FeedKey;
  entityType: string;
  originalId: string;
}> | null {
  const match = /(?:^|:)tnx:(tj|mikro|krl|mrt|lrtj|lrtjb):([^:]+):(.+)$/.exec(
    value,
  );
  if (match === null) return null;
  return {
    feedKey: match[1] as FeedKey,
    entityType: match[2] as string,
    originalId: decodeURIComponent(match[3] as string),
  };
}

function timingPrecision(mode: ProductMode): JourneyTimingPrecision {
  if (mode === 'KRL') return 'EXACT_SCHEDULE';
  if (
    mode === 'MRT_JAKARTA' ||
    mode === 'LRT_JAKARTA' ||
    mode === 'LRT_JABODEBEK'
  )
    return 'FREQUENCY_DERIVED';
  if (mode === 'TRANSJAKARTA' || mode === 'MIKROTRANS')
    return 'SOURCE_GTFS_WITH_FREQUENCIES';
  return 'ESTIMATED';
}

function round(value: number): number {
  return Number(value.toFixed(3));
}
