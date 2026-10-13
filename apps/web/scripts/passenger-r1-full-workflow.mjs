import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const web = process.env.M7_WEB_URL ?? 'http://127.0.0.1:3000';
const api = process.env.M7_API_URL ?? 'http://127.0.0.1:3001/api/v1';
const chrome =
  process.env.PRODUCT_P1R_CHROME ??
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const envFile = (() => {
  try {
    return readFileSync(
      fileURLToPath(new URL('../../../.env', import.meta.url)),
      'utf8',
    );
  } catch {
    return '';
  }
})();
const env = (name) =>
  process.env[name] ??
  envFile
    .split('\n')
    .find((line) => line.startsWith(`${name}=`))
    ?.slice(name.length + 1)
    .trim() ??
  '';
const token = env('CONTROLLED_REVIEW_TOKEN');
const reviewer = `r1-${randomUUID()}`;
const cases = [];
const evidence = {
  suite: 'passenger-r1-full-workflow',
  web,
  departure_input_jakarta: '2026-10-02T08:11',
  place_identities: {},
  snapshot: null,
  preferences: {},
  easiest: null,
  acceptance_map_timeline_parity: null,
  persisted_completed: null,
};
const evidenceDir = join(
  process.env.PRODUCT_ACCEPTANCE_EVIDENCE_DIR ??
    '/private/var/folders/9w/27j9sy2n31scrtpmj0tmgwl40000gn/T/opencode',
  'r2-r1-evidence',
);
async function recordEvidence(label) {
  try {
    await mkdir(evidenceDir, { recursive: true });
    await writeFile(
      join(evidenceDir, `${label}.json`),
      JSON.stringify(
        { evidence, completed_cases: cases, captured_label: label },
        null,
        2,
      ),
      'utf8',
    );
    return `evidence ${label}.json recorded`;
  } catch (error) {
    return `evidence ${label}.json NOT_RECORDED: ${String(error?.message ?? error).slice(0, 120)}`;
  }
}
async function snapshotScreenshot(label, selector = 'body') {
  try {
    await mkdir(evidenceDir, { recursive: true });
    await page
      .locator(selector)
      .first()
      .screenshot({
        path: join(evidenceDir, `${label}.png`),
      });
    return `screenshot ${label}.png recorded`;
  } catch (error) {
    return `screenshot ${label}.png NOT_RECORDED: ${String(error?.message ?? error).slice(0, 120)}`;
  }
}
let browser,
  context,
  other,
  page,
  active,
  plans,
  target,
  reportId,
  recovery,
  acceptance,
  otherJourney;
let reviewed = false;
let branch = null;
let failure = null;

function safe(value) {
  let text = String(value);
  for (const name of [
    'CONTROLLED_REVIEW_TOKEN',
    'PASSENGER_SERVICE_TOKEN',
    'PASSENGER_SESSION_SECRET',
  ]) {
    const secret = env(name);
    if (secret) text = text.replaceAll(secret, '[REDACTED]');
  }
  return text.slice(0, 700);
}
function mark(name, verdict, detail = '') {
  cases.push({ case: name, verdict, detail: safe(detail) });
  process.stderr.write(
    `[case] ${name}: ${verdict}${detail ? ` — ${safe(detail)}` : ''}\n`,
  );
}
async function step(name, fn) {
  try {
    const result = await fn();
    mark(name, 'PASS', typeof result === 'string' ? result : '');
    return result;
  } catch (error) {
    mark(name, 'FAIL', error.message);
    throw error;
  }
}
const data = (body) => body?.data ?? body;
async function jsonResponse(response) {
  return {
    status:
      typeof response.status === 'function'
        ? response.status()
        : response.status,
    body: await response.json().catch(() => null),
  };
}
async function proxy(path, options = {}, ownerContext = context) {
  return jsonResponse(
    await ownerContext.request.fetch(`${web}/api/passenger/${path}`, {
      ...options,
      timeout: 120_000,
      headers: { origin: web, ...(options.headers ?? {}) },
    }),
  );
}
function ok(result, statuses = [200, 201]) {
  assert.ok(
    statuses.includes(result.status),
    `HTTP ${result.status}: ${JSON.stringify(result.body?.error ?? result.body)}`,
  );
  return data(result.body);
}
async function controlled(action, payload) {
  return jsonResponse(
    await fetch(`${api}/controlled/passenger-reports/${reportId}/${action}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'x-controlled-reviewer': reviewer,
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(120_000),
    }),
  );
}
async function uiMutation(button, suffix, method) {
  const wait = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/passenger/${suffix}`) &&
      response.request().method() === method,
    { timeout: 120_000 },
  );
  await page.getByRole('button', { name: button, exact: true }).click();
  return ok(await jsonResponse(await wait));
}
function jakarta(at) {
  return new Date(Date.parse(at) + 7 * 3600_000).toISOString().slice(0, 16);
}
async function choosePlace(field, query, option) {
  const input = page.getByRole('combobox', { name: field });
  const wait = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname.endsWith('/api/passenger/transit/places') &&
      url.searchParams.get('q') === query
    );
  });
  await input.fill(query);
  const response = await wait;
  const matches = ok(await jsonResponse(response));
  const chosen = page.getByRole('option', { name: option }).first();
  const externalId = (await chosen.locator('small').innerText())
    .split(' · ')
    .at(-1);
  const place = matches.find(
    (item) =>
      item.external_id === externalId &&
      item.name === (field === 'From' ? 'Kelapa Gading' : 'Gambir') &&
      item.kind === 'STATION',
  );
  assert.ok(
    place,
    'selected option identity missing from actual search response',
  );
  const snapshotId = new URL(response.url()).searchParams.get('snapshot_id');
  assert.equal(snapshotId, evidence.snapshot);
  await chosen.click();
  assert.equal(await input.inputValue(), place.name);
  evidence.place_identities[field] = place;
}
async function planFromUi(preference) {
  await page.getByLabel('Rank by').selectOption(preference);
  const wait = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/passenger/journeys/plan') &&
      response.request().method() === 'POST',
    { timeout: 120_000 },
  );
  await page
    .getByRole('button', { name: 'Find journeys', exact: true })
    .click();
  const response = await wait;
  const result = await jsonResponse(response);
  const payload = response.request().postDataJSON();
  assert.ok(payload, 'plan request JSON missing');
  {
    assert.deepEqual(
      payload.origin,
      {
        latitude: evidence.place_identities.From.latitude,
        longitude: evidence.place_identities.From.longitude,
      },
      'plan request origin did not use selected place coordinates',
    );
    assert.deepEqual(
      payload.destination,
      {
        latitude: evidence.place_identities.To.latitude,
        longitude: evidence.place_identities.To.longitude,
      },
      'plan request destination did not use selected place coordinates',
    );
    assert.equal(
      payload.network_snapshot_id,
      evidence.snapshot,
      'plan request did not use the exact live snapshot',
    );
    assert.equal(
      payload.departure_at,
      '2026-10-02T08:11:00+07:00',
      'plan request did not use the entered Jakarta departure',
    );
    assert.equal(
      payload.preference,
      preference,
      'plan request preference mismatch',
    );
  }
  const list = ok(result);
  assert.ok(
    Array.isArray(list) && list.length > 0,
    `${preference}: no OTP alternatives`,
  );
  for (const journey of list) {
    assert.equal(journey.routing_context.provider, 'OTP');
    assert.match(journey.routing_context.graph_sha256, /^[a-f0-9]{64}$/);
    assert.ok(
      journey.segments.every(
        (segment) =>
          Array.isArray(segment.geometry?.coordinates) &&
          segment.geometry.coordinates.length >= 2,
      ),
      'segment geometry missing',
    );
  }
  await page
    .getByRole('region', { name: 'Journey choices' })
    .getByRole('button')
    .first()
    .waitFor({ timeout: 120_000 });
  return list;
}
async function advanceCurrent() {
  const leg = active.segments[active.progress.completed_segment_count];
  assert.ok(leg, 'no current leg');
  const time = page.getByLabel('Progress time (Jakarta, controlled)');
  if (leg.mode !== 'WALK') {
    await time.fill(jakarta(leg.start_at));
    active = await uiMutation(
      'Saya Sudah Naik',
      `journeys/${active.journey_id}/boarding/${leg.sequence}`,
      'POST',
    );
    assert.equal(
      active.progress.boarding_confirmed_segment_sequence,
      leg.sequence,
    );
    await time.fill(jakarta(leg.end_at));
    active = await uiMutation(
      'Saya Sudah Turun',
      `journeys/${active.journey_id}/alighting/${leg.sequence}`,
      'POST',
    );
    assert.equal(
      active.progress.alighting_confirmed_segment_sequence,
      leg.sequence,
    );
  }
  const next = active.segments[leg.sequence + 1];
  await time.fill(jakarta(next?.start_at ?? leg.end_at));
  active = await uiMutation(
    next ? 'Lanjutkan Perjalanan' : 'Selesaikan Perjalanan',
    `journeys/${active.journey_id}/progress`,
    'PATCH',
  );
  assert.equal(active.progress.completed_segment_count, leg.sequence + 1);
  return leg.mode !== 'WALK';
}
async function mapChecks() {
  await page
    .getByRole('application', { name: /Interactive selected route map/ })
    .waitFor({ timeout: 30_000 });
  await page
    .getByRole('status')
    .filter({ hasText: 'Interactive route map ready.' })
    .waitFor({ timeout: 30_000 });
  await page.locator('.maplibregl-canvas').first().waitFor({ timeout: 15_000 });
  await page.getByText('© OpenStreetMap contributors').waitFor();
  await page.waitForFunction(
    () => document.querySelectorAll('.maplibre-marker').length >= 2,
    null,
    { timeout: 30_000 },
  );
  assert.ok(await page.getByRole('list', { name: 'Map markers' }).count());
  assert.equal(
    await page
      .getByText('Route geometry is unavailable.', { exact: false })
      .count(),
    0,
  );
  await page
    .getByRole('application', { name: /Interactive selected route map/ })
    .locator('canvas')
    .hover();
  await page.mouse.wheel(0, 160);
  await page.waitForTimeout(300);
  assert.ok(await page.locator('.maplibre-frame canvas').count());
}

try {
  await step('runtime-ready', async () => {
    assert.equal(env('CONTROLLED_REVIEW_ENABLED'), 'true');
    assert.ok(token.length >= 32, 'controlled review token unavailable');
    assert.ok((await fetch(web, { signal: AbortSignal.timeout(20_000) })).ok);
    assert.ok(
      (
        await fetch('http://127.0.0.1:3001/health/ready', {
          signal: AbortSignal.timeout(20_000),
        })
      ).ok,
    );
  });
  browser = await chromium.launch(
    existsSync(chrome)
      ? { executablePath: chrome, headless: true }
      : { headless: true },
  );
  context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  other = await browser.newContext({ viewport: { width: 390, height: 844 } });
  page = await context.newPage();

  await step('ui-place-search-identity', async () => {
    await page.goto(web, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      () => {
        const button = [...document.querySelectorAll('button')].find(
          (item) => item.textContent?.trim() === 'Find journeys',
        );
        return button && !button.disabled;
      },
      null,
      { timeout: 30_000 },
    );
    evidence.snapshot = ok(await proxy('config')).network_snapshot_id;
    assert.match(
      evidence.snapshot,
      /^[0-9a-f-]{36}$/,
      'config did not return a real network snapshot id',
    );
    await choosePlace(
      'From',
      'Kelapa Gading',
      /^Kelapa Gading LRT Jakarta · station/,
    );
    await choosePlace('To', 'Gambir', /^Gambir TransJakarta · station/);
    assert.ok(
      (await context.cookies()).some(
        (cookie) =>
          cookie.name === 'transumin_proto_session' && cookie.httpOnly,
      ),
    );
    const forbidden = page.getByText('Advanced: enter coordinates instead');
    assert.ok(await forbidden.count(), 'place-search UI missing');
    return `snapshot ${evidence.snapshot}; From ${evidence.place_identities.From.name} (${evidence.place_identities.From.external_id}); To ${evidence.place_identities.To.name} (${evidence.place_identities.To.external_id})`;
  });

  await step('ui-preference-otp-plans', async () => {
    await page.getByLabel('Depart (Jakarta time)').fill('2026-10-02T08:11');
    const byPreference = {};
    for (const preference of ['FEWEST_TRANSFERS', 'LEAST_WALKING', 'FASTEST'])
      byPreference[preference] = await planFromUi(preference);
    plans = byPreference.FASTEST;
    const all = Object.values(byPreference).flat();
    assert.ok(
      all.every((journey) => journey.routing_context.provider === 'OTP'),
    );
    const metric = {
      FASTEST: (journey) => journey.duration_seconds,
      FEWEST_TRANSFERS: (journey) => journey.transfer_count,
      LEAST_WALKING: (journey) => journey.walking_distance_meters,
    };
    for (const [preference, list] of Object.entries(byPreference)) {
      assert.ok(list.length > 0, `${preference}: no OTP alternatives returned`);
      const best = Math.min(...list.map(metric[preference]));
      assert.ok(
        metric[preference](list[0]) <= best + 1e-6,
        `${preference}: first option is not the extreme value`,
      );
      for (const journey of list) {
        assert.equal(
          journey.network_snapshot_id,
          evidence.snapshot,
          `${preference}: snapshot provenance drift`,
        );
        assert.equal(
          journey.routing_context.network_snapshot_id,
          evidence.snapshot,
          `${preference}: routing snapshot drift`,
        );
        assert.equal(
          journey.routing_context.common_service_date,
          '2026-10-02',
          `${preference}: service-date provenance drift`,
        );
        assert.equal(
          journey.routing_context.timezone,
          'Asia/Jakarta',
          `${preference}: timezone drift`,
        );
      }
      evidence.preferences[preference] = {
        alternatives: list.length,
        first: {
          journey_id: list[0].journey_id,
          duration_seconds: list[0].duration_seconds,
          transfer_count: list[0].transfer_count,
          walking_distance_meters: list[0].walking_distance_meters,
          modes: list[0].segments.map((segment) => segment.mode),
        },
      };
    }
    const transfers = Math.min(...plans.map((item) => item.transfer_count));
    const simplest = plans.filter(
      (journey) => journey.transfer_count === transfers,
    );
    const walking = Math.min(
      ...simplest.map((item) => item.walking_distance_meters),
    );
    const easiest = simplest.filter(
      (journey) => journey.walking_distance_meters === walking,
    );
    assert.ok(easiest.length > 0, 'easiest subset empty');
    const easiestIds = easiest.map((journey) => journey.journey_id);
    evidence.easiest = {
      transfer_count: transfers,
      walking_distance_meters: walking,
      journey_ids: easiestIds,
    };
    if (plans.length > 1) {
      const rendered = page.getByText('Easiest among shown', { exact: false });
      assert.ok((await rendered.count()) > 0, 'easiest subset not rendered');
      const flagged = await page
        .getByRole('region', { name: 'Journey choices' })
        .getByRole('button')
        .evaluateAll((buttons) =>
          buttons
            .filter((button) =>
              button.textContent?.includes('Easiest among shown'),
            )
            .map((button) =>
              button.textContent?.includes('Option') ? button.textContent : '',
            ),
        );
      assert.equal(
        flagged.length,
        easiestIds.length,
        'rendered easiest flags do not match fewest-then-least-walking subset',
      );
    } else
      assert.equal(easiestIds.length, 1, 'single-candidate easiest mismatch');
    await page
      .getByRole('region', { name: 'Journey choices' })
      .getByRole('button')
      .first()
      .waitFor({ timeout: 120_000 });
    const shot = await snapshotScreenshot('choices-three-preferences');
    active = plans.find((journey) =>
      journey.segments.some(
        (segment) =>
          segment.sequence >= 2 &&
          segment.entity_bindings.some(
            (binding) =>
              binding.entity_type === 'ROUTE' && binding.mobility_entity_id,
          ),
      ),
    );
    assert.ok(active, 'no FASTEST candidate with future route dependency');
    return `${Object.keys(byPreference).length} preferences; FASTEST ${plans.length} candidates; easiest ${easiestIds.length}; ${shot}`;
  });

  await step('ui-map-geometry-markers-attribution-timeline', async () => {
    assert.ok(
      (await page.getByLabel('Depart (Jakarta time)').inputValue()) ===
        '2026-10-02T08:11',
      'departure control did not retain the entered Jakarta time',
    );
    assert.equal(
      await page.getByLabel('Rank by').inputValue(),
      'FASTEST',
      'preference control did not retain FASTEST',
    );
    await page.getByLabel('Rank by').selectOption('FEWEST_TRANSFERS');
    assert.equal(
      await page.getByLabel('Rank by').inputValue(),
      'FEWEST_TRANSFERS',
    );
    await page.getByLabel('Rank by').selectOption('LEAST_WALKING');
    assert.equal(
      await page.getByLabel('Rank by').inputValue(),
      'LEAST_WALKING',
    );
    await page.getByLabel('Rank by').selectOption('BALANCED');
    assert.equal(await page.getByLabel('Rank by').inputValue(), 'BALANCED');
    await page.getByLabel('Rank by').selectOption('FASTEST');
    assert.equal(await page.getByLabel('Rank by').inputValue(), 'FASTEST');
    assert.ok(
      await page.getByRole('combobox', { name: 'From' }).count(),
      'From place control missing',
    );
    assert.ok(
      await page.getByRole('combobox', { name: 'To' }).count(),
      'To place control missing',
    );
    assert.ok(
      (
        await page.getByRole('combobox', { name: 'From' }).inputValue()
      ).includes('Kelapa Gading'),
      'From control did not retain the chosen place',
    );
    assert.ok(
      (await page.getByRole('combobox', { name: 'To' }).inputValue()).includes(
        'Gambir',
      ),
      'To control did not retain the chosen place',
    );
    assert.ok(
      await page
        .getByRole('button', { name: 'Find journeys', exact: true })
        .count(),
      'Find journeys button missing',
    );
    assert.ok(
      await page
        .getByRole('button', { name: /Load presentation scenario/ })
        .count(),
      'demo-scenario button missing from full UI control path',
    );
    assert.ok(
      await page.getByText('Advanced: enter coordinates instead').count(),
      'coordinate-entry control missing from full UI control path',
    );
    await page
      .getByRole('region', { name: 'Journey choices' })
      .getByRole('button')
      .nth(plans.indexOf(active))
      .click();
    await page.locator('.leg-list').first().waitFor();
    target = active.segments.find(
      (segment) =>
        segment.sequence >= 2 &&
        segment.entity_bindings.some(
          (binding) =>
            binding.entity_type === 'ROUTE' && binding.mobility_entity_id,
        ),
    );
    await mapChecks();
    await page.waitForFunction(
      (count) => document.querySelectorAll('.leg-list li').length >= count,
      active.segments.length,
      { timeout: 15_000 },
    );
    assert.ok(await page.getByText(/Router: OTP/).count());
    const before = await page.locator('.leg-list li').evaluateAll((items) =>
      items.map((item) => ({
        text: item.innerText
          .replace(/ · (completed|current|upcoming)/g, '')
          .trim(),
        position:
          [...item.classList].find((name) =>
            ['completed', 'current', 'upcoming'].includes(name),
          ) ?? null,
      })),
    );
    const map = page.locator('.maplibre-frame');
    const parity = await map.evaluate((node) => ({
      route_sources: Number(node.getAttribute('data-route-source-count')),
      route_points: Number(node.getAttribute('data-route-point-count')),
      markers: Number(node.getAttribute('data-marker-count')),
      fit_bounds: node.getAttribute('data-fit-bounds'),
    }));
    assert.equal(
      parity.route_sources,
      active.segments.length,
      'map route-source count differs from itinerary legs',
    );
    assert.ok(
      parity.route_points >= 2 * active.segments.length,
      'map route points do not cover itinerary geometry',
    );
    assert.ok(parity.markers >= 2, 'map endpoint markers missing');
    assert.ok(parity.fit_bounds, 'map did not fit returned geometry');
    const shot = await snapshotScreenshot('selected-itinerary-map-timeline');
    evidence.acceptance_map_timeline_parity = {
      journey_id: active.journey_id,
      map: parity,
      timeline: before,
      screenshot: shot,
    };
  });

  await step('activate-and-independent-identity', async () => {
    active = await uiMutation(
      'Mulai Perjalanan',
      `journeys/${active.journey_id}/activate`,
      'POST',
    );
    assert.equal(active.status, 'ACTIVE');
    assert.equal(active.progress.method, 'CONTROLLED_MANUAL');
    assert.equal(
      active.progress.completed_segment_count,
      0,
      'activation did not anchor at origin',
    );
    assert.equal(
      active.network_snapshot_id,
      evidence.snapshot,
      'active journey left the exact network snapshot',
    );
    assert.equal(
      active.routing_context.common_service_date,
      '2026-10-02',
      'active journey service-date mismatch',
    );
    const otherPage = await other.newPage();
    await otherPage.goto(web, { waitUntil: 'domcontentloaded' });
    // Independent browser establishes its own server-derived cookie; unrelated OD corridor.
    const snapshotId = ok(await proxy('config', {}, other)).network_snapshot_id;
    const places = async (query) =>
      ok(
        await proxy(
          `transit/places?q=${encodeURIComponent(query)}&snapshot_id=${encodeURIComponent(snapshotId)}`,
          {},
          other,
        ),
      );
    const harmoni = (await places('Harmoni')).find(
      (place) =>
        place.kind === 'STATION' && place.product_mode === 'TRANSJAKARTA',
    );
    const lebak = (await places('Lebak Bulus Bank Syariah Indonesia')).find(
      (place) =>
        place.kind === 'STATION' && place.product_mode === 'MRT_JAKARTA',
    );
    assert.ok(
      harmoni && lebak,
      'unrelated second-context stops unavailable from supported search',
    );
    const planned = ok(
      await proxy(
        'journeys/plan',
        {
          method: 'POST',
          data: {
            origin: {
              latitude: harmoni.latitude,
              longitude: harmoni.longitude,
            },
            destination: {
              latitude: lebak.latitude,
              longitude: lebak.longitude,
            },
            departure_at: active.start_at,
            network_snapshot_id: snapshotId,
            preference: 'BALANCED',
          },
        },
        other,
      ),
    );
    otherJourney = ok(
      await proxy(
        `journeys/${planned[0].journey_id}/activate`,
        {
          method: 'POST',
          headers: { 'idempotency-key': randomUUID() },
          data: { selected_journey: planned[0] },
        },
        other,
      ),
    );
    const cookieA = (await context.cookies()).find(
      (cookie) => cookie.name === 'transumin_proto_session',
    );
    const cookieB = (await other.cookies()).find(
      (cookie) => cookie.name === 'transumin_proto_session',
    );
    assert.ok(
      cookieA?.httpOnly && cookieB?.httpOnly && cookieA.value !== cookieB.value,
    );
    assert.notEqual(otherJourney.journey_id, active.journey_id);
    assert.ok(
      [403, 404].includes(
        (await proxy(`journeys/${active.journey_id}`, {}, other)).status,
      ),
    );
    return otherJourney;
  });

  await step('boarding-alighting-prefix-and-persisted-timeline', async () => {
    let transit = 0;
    while (active.progress.completed_segment_count < target.sequence - 1)
      if (await advanceCurrent()) transit++;
    assert.ok(transit > 0, 'no boarding/alighting before report');
    assert.equal(active.progress.method, 'CONTROLLED_MANUAL');
    assert.deepEqual(
      ok(await proxy(`journeys/${active.journey_id}`)).progress,
      active.progress,
    );
  });

  const binding = target.entity_bindings.find(
    (item) => item.entity_type === 'ROUTE' && item.mobility_entity_id,
  );
  await step('ui-report-unverified', async () => {
    const selector = page.getByLabel(
      'Lokasi atau layanan pada sisa perjalanan',
    );
    const value = await selector
      .locator('option')
      .evaluateAll(
        (options, id) =>
          options.find((option) => option.value.includes(id))?.value,
        binding.mobility_entity_id,
      );
    assert.ok(value);
    await selector.selectOption(value);
    await page
      .getByLabel('Waktu kejadian (WIB)')
      .fill(jakarta(new Date(Date.now() - 60_000).toISOString()));
    await page
      .getByLabel('Keterangan')
      .fill(`R1 SIMULATED acceptance ${randomUUID()}`);
    const report = await uiMutation(
      'Kirim laporan',
      'passenger-reports',
      'POST',
    );
    reportId = report.report_id;
    assert.equal(report.verification_status, 'REPORTED_UNVERIFIED');
    assert.ok(
      await page.getByText(/Belum diverifikasi/, { exact: false }).count(),
    );
  });
  await step('review-owner-isolation', async () => {
    assert.ok(
      [403, 404].includes(
        (await proxy(`passenger-reports/${reportId}`, {}, other)).status,
      ),
    );
    assert.equal(
      (
        await proxy(`controlled/passenger-reports/${reportId}/verify`, {
          method: 'POST',
          data: {
            operational_state: 'UNAVAILABLE',
            incident_type: 'SERVICE_SUSPENSION',
            reason: 'proxy denied',
          },
        })
      ).status,
      403,
    );
  });
  await step('controlled-relevant-simulated-alert', async () => {
    reviewed = true;
    const review = ok(
      await controlled('verify', {
        operational_state: 'UNAVAILABLE',
        incident_type: 'SERVICE_SUSPENSION',
        reason: `R1 ${reportId}`,
      }),
    );
    assert.equal(review.verification_status, 'CONTROLLED_VERIFIED');
    const alerts = ok(await proxy(`journeys/${active.journey_id}/alerts`));
    const alert = alerts.find(
      (item) =>
        item.mobility_entity_id === binding.mobility_entity_id &&
        item.evidence_type === 'SIMULATED' &&
        !item.resolved_at,
    );
    assert.ok(
      alert && alert.affected_segment_sequences.includes(target.sequence),
    );
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page
      .getByText('Controlled simulation', { exact: false })
      .first()
      .waitFor({ timeout: 30_000 });
  });
  await step('unrelated-second-context-alert-isolation', async () => {
    assert.ok(otherJourney, 'second context journey missing');
    const alerts = ok(
      await proxy(`journeys/${otherJourney.journey_id}/alerts`, {}, other),
    );
    assert.equal(
      alerts.filter(
        (item) => item.mobility_entity_id === binding.mobility_entity_id,
      ).length,
      0,
      'unrelated journey received the reviewed-entity alert',
    );
    assert.ok(
      [403, 404].includes(
        (await proxy(`passenger-reports/${reportId}`, {}, other)).status,
      ),
    );
  });
  await step('recovery-accept-persist', async () => {
    recovery = await uiMutation('Find another way', 'recoveries', 'POST');
    branch =
      recovery.status === 'COMPLETED'
        ? 'COMPLETED'
        : recovery.rejoin_status === 'NO_PATH'
          ? 'NO_PATH'
          : null;
    assert.ok(branch);
    if (branch === 'COMPLETED') {
      assert.ok(recovery.proposed_journey);
      assert.equal(recovery.metrics.disrupted_entity_avoidance, true);
      assert.equal(recovery.proposed_journey.routing_context.provider, 'OTP');
      acceptance = await uiMutation(
        'Use this repaired route',
        `recoveries/${recovery.recovery_id}/accept`,
        'POST',
      );
      assert.equal(acceptance.original_plan_preserved, true);
      assert.equal(acceptance.current_pointer_advanced, true);
      await page.reload({ waitUntil: 'domcontentloaded' });
      const persisted = ok(await proxy(`recoveries/${recovery.recovery_id}`));
      assert.equal(persisted.accepted, true);
      active = ok(await proxy(`journeys/${active.journey_id}`));
      assert.equal(active.status, 'ACTIVE');
      await page
        .getByText('Recovery accepted', { exact: false })
        .waitFor({ timeout: 30_000 });
      await page
        .locator('.maplibregl-canvas')
        .first()
        .waitFor({ timeout: 30_000 });
      await page.locator('.leg-list').first().waitFor({ timeout: 30_000 });
      const acceptedMap = await page
        .locator('.maplibre-frame')
        .evaluate((node) => ({
          route_sources: Number(node.getAttribute('data-route-source-count')),
          route_points: Number(node.getAttribute('data-route-point-count')),
          markers: Number(node.getAttribute('data-marker-count')),
        }));
      assert.equal(
        acceptedMap.route_sources,
        active.segments.length,
        'accepted map does not match accepted itinerary leg count',
      );
      assert.ok(
        acceptedMap.markers >= 2,
        'accepted map endpoint markers missing',
      );
      const acceptedTimeline = await page.locator('.leg-list li').count();
      assert.equal(
        acceptedTimeline,
        active.segments.length,
        'accepted timeline does not match accepted itinerary',
      );
      evidence.acceptance_map_timeline_parity.accepted = {
        journey_id: active.journey_id,
        map: acceptedMap,
        timeline_count: acceptedTimeline,
      };
      await recordEvidence('post-acceptance');
      return 'accepted, map/timeline parity persisted';
    }
    assert.equal(recovery.proposed_journey, null);
    return 'truthful NO_PATH';
  });
  await step('continued-boarding-alighting-completion', async () => {
    if (branch === 'NO_PATH') return 'NOT_APPLICABLE: no accepted route';
    const remainingTransit = active.segments
      .slice(active.progress.completed_segment_count)
      .filter((segment) => segment.mode !== 'WALK').length;
    let transit = 0;
    let steps = 0;
    try {
      while (active.status !== 'COMPLETED' && steps < 50) {
        if (await advanceCurrent()) transit++;
        steps++;
      }
    } catch (error) {
      const current = ok(await proxy(`journeys/${active.journey_id}`));
      throw new Error(
        `${safe(error.message)} (server progress=${current.progress.completed_segment_count}/${current.segments.length} status=${current.status})`,
      );
    }
    assert.ok(steps > 0, 'accepted continuation advanced no leg');
    assert.equal(
      transit,
      remainingTransit,
      'not every remaining transit leg was boarded and alighted',
    );
    const completed = ok(await proxy(`journeys/${active.journey_id}`));
    assert.equal(completed.status, 'COMPLETED');
    assert.equal(
      completed.progress.completed_segment_count,
      completed.segments.length,
    );
    await page
      .getByText('perjalanan ini sudah selesai.', { exact: false })
      .waitFor();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page
      .getByRole('heading', { name: 'Your active journey' })
      .waitFor({ timeout: 30_000 });
    await page
      .getByText('perjalanan ini sudah selesai.', { exact: false })
      .waitFor({ timeout: 30_000 });
    const reloaded = ok(await proxy(`journeys/${active.journey_id}`));
    assert.equal(
      reloaded.status,
      'COMPLETED',
      'journey status did not persist COMPLETED after reload',
    );
    assert.equal(
      reloaded.progress.completed_segment_count,
      reloaded.segments.length,
      'completed segment count did not persist after reload',
    );
    assert.deepEqual(
      reloaded.progress,
      completed.progress,
      'progress mutated across reload',
    );
    evidence.persisted_completed = {
      journey_id: active.journey_id,
      status: reloaded.status,
      completed_segment_count: reloaded.progress.completed_segment_count,
      segments: reloaded.segments.length,
    };
    const shot = await snapshotScreenshot('journey-completed-reloaded');
    const recorded = await recordEvidence('final');
    return `${steps} legs continued (${transit} transit); persisted COMPLETED after reload; ${shot}; ${recorded}`;
  });
  await step('persisted-completed-map-timeline-after-reload', async () => {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page
      .getByText('perjalanan ini sudah selesai.', { exact: false })
      .waitFor({ timeout: 30_000 });
    const reloaded = ok(await proxy(`journeys/${active.journey_id}`));
    assert.equal(reloaded.status, 'COMPLETED');
    await page.locator('.leg-list').first().waitFor({ timeout: 30_000 });
    const completedCount = await page.locator('.leg-list li').count();
    assert.equal(completedCount, reloaded.segments.length);
    return 'COMPLETED persisted after second reload';
  });
} catch (error) {
  failure = safe(error.message);
} finally {
  if (reportId && reviewed) {
    try {
      const closed = ok(
        await controlled('close', {
          decision: 'RESOLVED',
          reason: `R1 finally cleanup ${reportId}`,
        }),
      );
      assert.equal(closed.lifecycle_status, 'RESOLVED');
      mark(
        'controlled-close-finally',
        'PASS',
        'RESOLVED through controlled endpoint',
      );
    } catch (error) {
      mark('controlled-close-finally', 'FAIL', error.message);
    }
  }
  await browser?.close().catch(() => {});
}
const failed = cases.filter((item) => item.verdict === 'FAIL');
const status = failed.length ? 'FAIL' : failure ? 'NOT_VERIFIED' : 'PASS';
const sanitized = {
  snapshot: evidence.snapshot,
  place_identities: evidence.place_identities,
  departure_input_jakarta: evidence.departure_input_jakarta,
  preferences: evidence.preferences,
  easiest: evidence.easiest,
  evidenceDir: evidenceDir.replace(/^\/private\/var\//, '[TEMP]/'),
};
console.log(
  JSON.stringify({
    status,
    branch,
    cases,
    failure,
    sanitized,
    evidence:
      'real Playwright UI place search, OTP plans, controlled SIMULATED review, recovery persistence; no SQL cleanup',
  }),
);
process.exitCode = status === 'PASS' ? 0 : 1;
