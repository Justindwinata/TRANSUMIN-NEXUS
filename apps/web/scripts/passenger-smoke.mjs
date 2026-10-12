import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const base = process.env.PASSENGER_WEB_URL ?? 'http://127.0.0.1:3000';
const api = `${base}/api/passenger`;
const owner = `passenger:${randomUUID()}`;
const originLatitude = -6.108205;

async function request(path, options = {}) {
  const response = await fetch(`${api}/${path}`, options);
  const body = await response.json();
  if (!response.ok)
    throw new Error(
      `${path}: ${response.status} ${JSON.stringify(body.error)}`,
    );
  return { status: response.status, data: body.data };
}

const config = await request('config');
const planned = await request('journeys/plan', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    origin: { latitude: originLatitude, longitude: 106.89982 },
    destination: { latitude: -6.205627, longitude: 106.822295 },
    departure_at: '2026-10-02T08:00:00+07:00',
    network_snapshot_id: config.data.network_snapshot_id,
    preference: 'BALANCED',
  }),
});
assert.ok(planned.data.length > 0, 'OTP returned no journey');
const selected = planned.data[0];
assert.ok(selected.segments.length > 1, 'No usable multi-leg plan');
const headers = {
  'content-type': 'application/json',
  'x-journey-owner': owner,
};
const activated = await request(`journeys/${selected.journey_id}/activate`, {
  method: 'POST',
  headers,
  body: JSON.stringify({
    selected_journey: selected,
    activated_at: selected.start_at,
  }),
});
assert.equal(activated.data.status, 'ACTIVE');
assert.ok(activated.data.dependencies.length > 0);
assert.equal(
  activated.data.routing_context.network_snapshot_id,
  selected.routing_context.network_snapshot_id,
);
const progressed = await request(
  `journeys/${activated.data.journey_id}/progress`,
  {
    method: 'PATCH',
    headers,
    body: JSON.stringify({
      completed_segment_count: 1,
      current_segment_sequence: 1,
      recorded_at: selected.segments[1].start_at,
    }),
  },
);
assert.equal(progressed.data.progress.completed_segment_count, 1);
assert.deepEqual(
  progressed.data.segments,
  activated.data.segments,
  'Progress mutated the original plan',
);
console.log(
  JSON.stringify({
    status: 'PASS',
    source: 'real OTP and API via web proxy',
    alternatives: planned.data.length,
    plan_journey_id: selected.journey_id,
    active_journey_id: activated.data.journey_id,
    segments: selected.segments.length,
    dependencies: activated.data.dependencies.length,
    completed: progressed.data.progress.completed_segment_count,
    network_snapshot_id: selected.routing_context.network_snapshot_id,
  }),
);
