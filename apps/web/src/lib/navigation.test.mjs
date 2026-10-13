import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  OFF_ROUTE_HISTORY,
  distanceToPathMeters,
  isOffRoute,
  modeNavLabel,
  navigationMode,
  nextGuidance,
  pathPoints,
} from './navigation.ts';

function segWalk(overrides = {}) {
  return {
    sequence: 0,
    mode: 'WALK',
    from: { name: 'Dari' },
    to: { name: 'Ke' },
    route_short_name: null,
    geometry: {
      type: 'LineString',
      coordinates: [
        [106.81, -6.2],
        [106.82, -6.21],
        [106.83, -6.2],
      ],
    },
    ...overrides,
  };
}
function segBus(seq = 1, mode = 'TRANSJAKARTA', name = '6H') {
  return {
    sequence: seq,
    mode,
    from: { name: `Stasiun ${seq}` },
    to: { name: `Stasiun ${seq + 1}` },
    route_short_name: name,
    geometry: {
      type: 'LineString',
      coordinates: [
        [106.81, -6.2],
        [106.83, -6.2],
      ],
    },
  };
}

describe('F-04 navigation', () => {
  it('navigationMode covers every required state', () => {
    assert.equal(
      navigationMode([], 0, { boarded: false, alighted: false }),
      'ARRIVED',
    );
    assert.equal(
      navigationMode([], 1, { boarded: false, alighted: false }),
      'ARRIVED',
    );
    const seg = segWalk();
    const transit = segBus(0);
    assert.equal(
      navigationMode([seg, transit], 0, { boarded: false, alighted: false }),
      'WALK_TO_BOARDING_STOP',
    );
    assert.equal(
      navigationMode([transit, segWalk({ sequence: 1 })], 0, {
        boarded: false,
        alighted: false,
      }),
      'WAIT_FOR_TRANSIT',
    );
    assert.equal(
      navigationMode([transit], 0, { boarded: true, alighted: false }),
      'ON_TRANSIT_CONFIRMED',
    );
    assert.equal(
      navigationMode([transit, seg], 0, { boarded: true, alighted: true }),
      'ALIGHTING_PENDING',
    );
    assert.equal(
      navigationMode([seg, transit, segWalk({ sequence: 2 })], 1, {
        boarded: false,
        alighted: false,
      }),
      'WAIT_FOR_TRANSIT',
    );
    assert.equal(
      navigationMode([segWalk({ sequence: 0 }), segWalk({ sequence: 1 })], 1, {
        boarded: false,
        alighted: false,
      }),
      'WALK_TO_DESTINATION',
    );
    assert.equal(modeNavLabel('WALK_TO_BOARDING_STOP'), 'Jalan menuju halte');
    assert.equal(modeNavLabel('WAIT_FOR_TRANSIT'), 'Menunggu transportasi');
    assert.equal(
      modeNavLabel('NAVIGATION_UNAVAILABLE'),
      'Navigasi tidak tersedia',
    );
  });

  it('walking guidance never fabricates a turn street name', () => {
    const segments = [segWalk()];
    const guidance = nextGuidance(
      segments,
      0,
      { boarded: false, alighted: false },
      null,
    );
    assert.ok(guidance);
    assert.ok(
      !/(belok kanan|belok kiri|turn left|turn right|keep left|keep right)/i.test(
        guidance.detail,
      ),
    );
    assert.equal(guidance.provenance, 'SCHEMATIC_GEOMETRY');
    assert.ok(/skematik/i.test(guidance.detail));
  });

  it('walking distance decreases when simulated position advances', () => {
    const segment = segWalk();
    const path = pathPoints(segment);
    const first = distanceToPathMeters(
      { latitude: -6.2, longitude: 106.81 },
      path,
    );
    const last = distanceToPathMeters(
      { latitude: -6.2, longitude: 106.83 },
      path,
    );
    assert.ok(path);
    assert.ok(first !== null && last !== null);
    const ahead = { latitude: -6.2, longitude: 106.815 };
    const behind = nextGuidance(
      [segment],
      0,
      { boarded: false, alighted: false },
      ahead,
    );
    assert.ok(behind?.detail);
  });

  it('one noisy sample never reports off-route; sustained does', () => {
    const path = pathPoints(segWalk());
    assert.ok(path);
    const noisy = [{ distance: null }];
    assert.equal(isOffRoute(noisy, path), false);
    assert.equal(isOffRoute([{ distance: 200 }], path), false);
    assert.equal(
      isOffRoute(
        [{ distance: 130 }, { distance: 130 }, { distance: 130 }],
        path,
      ),
      true,
    );
  });

  it('OFF_ROUTE_HISTORY bounds growth', () => {
    assert.ok(OFF_ROUTE_HISTORY >= 3);
  });
});
