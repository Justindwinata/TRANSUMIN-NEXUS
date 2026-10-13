import assert from 'node:assert/strict';
import test from 'node:test';
import { passengerApi } from './passenger-api.ts';

import {
  alertIsCurrent,
  easiestAmongShown,
  evidenceLabel,
  formatDuration,
  isValidReportDescription,
  journeySearchFailure,
  modeName,
  parsePoint,
  passengerRouteName,
  recoveryPart,
  recoveryPartLabel,
  recoverySummary,
  remainingReportTargets,
  samePassengerLeg,
  segmentPosition,
  toJakartaIso,
  transferLabel,
} from './passenger.ts';

test('product modes remain operator-specific', () => {
  assert.equal(modeName('TRANSJAKARTA'), 'TransJakarta');
  assert.equal(modeName('MIKROTRANS'), 'Mikrotrans');
  assert.notEqual(modeName('KRL'), modeName('MRT_JAKARTA'));
  assert.notEqual(modeName('LRT_JAKARTA'), modeName('LRT_JABODEBEK'));
  assert.equal(
    passengerRouteName({
      mode: 'MRT_JAKARTA',
      route_short_name: 'MRT_JAKARTA',
    }),
    '',
  );
  assert.equal(
    passengerRouteName({ mode: 'TRANSJAKARTA', route_short_name: '1' }),
    '1',
  );
  assert.equal(transferLabel(1), '1 transfer');
});

test('no route and router unavailability have useful distinct feedback', () => {
  assert.deepEqual(journeySearchFailure({ code: 'NO_ROUTE' }), {
    empty: true,
    message:
      'No usable journey was found. Try another departure time or destination.',
  });
  assert.deepEqual(
    journeySearchFailure({ code: 'ROUTER_UNAVAILABLE', status: 503 }),
    {
      empty: false,
      message:
        'Journey routing is temporarily unavailable. This search was not replaced with an estimate.',
    },
  );
  assert.equal(journeySearchFailure({ status: 503 }).empty, false);
});

test('recovery structure and passenger summary follow backend evidence', () => {
  const recovery = {
    status: 'COMPLETED',
    proposed_journey: { segments: [] },
    completed_segments: [0],
    preserved_segments: [1],
    invalidated_segments: [2],
    rejoined_segments: [3],
    additional_duration_seconds: 300,
    additional_transfers: 0,
  };
  assert.equal(recoveryPart(0, recovery), 'COMPLETED');
  assert.equal(recoveryPart(1, recovery), 'PRESERVED');
  assert.equal(recoveryPart(2, recovery), 'INVALIDATED');
  assert.equal(recoveryPart(3, recovery), 'REJOINED');
  assert.equal(recoveryPartLabel('INVALIDATED'), 'Changed in new route');
  assert.equal(recoveryPartLabel('REJOINED'), 'Rejoins original trip');
  assert.equal(
    recoverySummary(recovery),
    'Keeps 2 parts of your remaining trip · +5 min · no additional transfers',
  );
  assert.equal(
    recoverySummary({ ...recovery, status: 'NO_PATH', proposed_journey: null }),
    'No safe repair was found for the current conditions.',
  );
});

test('new route labels compare real leg identity, not generic mode alone', () => {
  const leg = {
    mode: 'TRANSJAKARTA',
    route_id: 'route-a',
    from: { name: 'Harmoni' },
    to: { name: 'Bundaran HI' },
    start_at: '2026-10-02T08:00:00+07:00',
    end_at: '2026-10-02T08:20:00+07:00',
  };
  assert.equal(samePassengerLeg(leg, { ...leg }), true);
  assert.equal(samePassengerLeg(leg, { ...leg, route_id: 'route-b' }), false);
});

test('Jakarta departure and coordinates are validated', () => {
  assert.equal(toJakartaIso('2026-10-02T08:30'), '2026-10-02T08:30:00+07:00');
  assert.deepEqual(parsePoint('-6.2', '106.8'), {
    latitude: -6.2,
    longitude: 106.8,
  });
  assert.throws(() => parsePoint('', '106.8'));
  assert.throws(() => parsePoint('-91', '106.8'));
});

test('progress keeps completed, current, and upcoming separate', () => {
  assert.equal(segmentPosition(0, 1), 'completed');
  assert.equal(segmentPosition(1, 1), 'current');
  assert.equal(segmentPosition(2, 1), 'upcoming');
});

test('expired or resolved alerts are not current; simulation is never live', () => {
  const alert = {
    resolved_at: null,
    freshness_status: 'FRESH',
    expires_at: '2026-10-02T09:00:00Z',
  };
  assert.equal(alertIsCurrent(alert, Date.parse('2026-10-02T08:00:00Z')), true);
  assert.equal(
    alertIsCurrent(alert, Date.parse('2026-10-02T10:00:00Z')),
    false,
  );
  assert.equal(
    alertIsCurrent(
      { ...alert, freshness_status: 'EXPIRED' },
      Date.parse('2026-10-02T08:00:00Z'),
    ),
    false,
  );
  assert.equal(evidenceLabel('SIMULATED'), 'Controlled simulation');
  assert.notEqual(evidenceLabel('SIMULATED'), evidenceLabel('LIVE'));
  assert.equal(formatDuration(3700), '1 jam 2 min');
});

test('targeted SSE forwards owner and reconnect cursor, then parses heartbeat and alert', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, options) => {
    calls.push({ input, options });
    return new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              'id: hb\nevent: heartbeat\ndata: {"type":"heartbeat"}\n\n',
            ),
          );
          controller.enqueue(
            new TextEncoder().encode(
              'id: alert-1\nevent: journey.alert.created\ndata: {"type":"journey.alert.created"}\n\n',
            ),
          );
          controller.close();
        },
      }),
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    );
  };
  try {
    const received = [];
    let opened = 0;
    await passengerApi.streamAlerts(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'previous-event',
      new AbortController().signal,
      (event) => received.push(event),
      () => {
        opened += 1;
      },
    );
    assert.equal(opened, 1);
    assert.deepEqual(
      received.map((event) => event.type),
      ['heartbeat', 'journey.alert.created'],
    );
    assert.equal(calls[0].options.headers['last-event-id'], 'previous-event');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
test('easiest among shown is subset-scoped and tie-aware, not global', () => {
  const base = {
    walking_distance_meters: 0,
    transfer_count: 0,
    journey_id: 'a',
  };
  assert.deepEqual(easiestAmongShown([]), []);
  assert.deepEqual(easiestAmongShown([base]), ['a']);
  assert.deepEqual(
    easiestAmongShown([
      { ...base, journey_id: 'invalid-transfers', transfer_count: -1 },
      {
        ...base,
        journey_id: 'invalid-walking',
        walking_distance_meters: Number.NaN,
      },
    ]),
    [],
  );
  assert.deepEqual(
    easiestAmongShown([base, { ...base, journey_id: 'b', transfer_count: 1 }]),
    ['a'],
  );
  assert.deepEqual(
    easiestAmongShown([
      { ...base, journey_id: 'longer-walk', walking_distance_meters: 50 },
      { ...base, journey_id: 'shorter-walk', walking_distance_meters: 25 },
    ]),
    ['shorter-walk'],
  );
  assert.deepEqual(
    easiestAmongShown(
      [
        { ...base, journey_id: 'x' },
        { ...base, journey_id: 'y' },
      ].map((j) => j),
    ).sort(),
    ['x', 'y'],
  );
});

test('report targets only cover remaining journey parts with provenance', () => {
  const stopA = {
    mobility_entity_id: '11111111-1111-4111-8111-111111111111',
    entity_type: 'STOP',
    provenance_ref: 'gtfs:route-6H:stop-a',
  };
  const routeB = {
    mobility_entity_id: '22222222-2222-4222-8222-222222222222',
    entity_type: 'ROUTE',
    provenance_ref: '',
  };
  const journey = {
    segments: [
      {
        sequence: 0,
        mode: 'TRANSJAKARTA',
        route_short_name: '6H',
        from: { name: 'Gambir' },
        to: { name: 'Sarinah' },
        entity_bindings: [stopA, routeB],
      },
      {
        sequence: 1,
        mode: 'TRANSJAKARTA',
        route_short_name: '6H',
        from: { name: 'Sarinah' },
        to: { name: 'Pejaten' },
        entity_bindings: [
          { ...stopA, provenance_ref: 'gtfs:route-6H:stop-a-alias' },
        ],
      },
    ],
  };
  const remaining = remainingReportTargets(journey, 0);
  assert.equal(remaining.length, 2, 'stop dedupes, route stays distinct');
  assert.equal(
    remaining.filter((t) => t.id === stopA.mobility_entity_id).length,
    1,
    'repeated entity+type dedupes',
  );
  assert.equal(remaining[0].provenance, 'gtfs:route-6H:stop-a');
  assert.match(remaining[0].label, /Gambir – Sarinah/);
  assert.equal(remaining.find((t) => t.type === 'ROUTE').provenance, 'provenance: tidak tersedia');
  const all = remainingReportTargets(journey, 0);
  assert.equal(all.every((target) => ['STOP', 'STATION', 'ROUTE'].includes(target.type)), true);
  const afterFirstLeg = remainingReportTargets(journey, 1);
  assert.equal(afterFirstLeg.length, 1, 'only later leg remains');
  assert.equal(remainingReportTargets(journey, 5).length, 0);
});

test('report descriptions trim to validated server bounds', () => {
  assert.equal(isValidReportDescription(' '), false);
  assert.equal(isValidReportDescription('Kondisi haltu banjir.'), true);
  assert.equal(isValidReportDescription('x'.repeat(2001)), false);
  assert.equal(isValidReportDescription('row\u0000'), false);
});
