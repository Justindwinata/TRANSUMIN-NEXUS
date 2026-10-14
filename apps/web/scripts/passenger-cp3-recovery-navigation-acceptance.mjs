import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { assertCp2Runtime } from './cp2-runtime-guard.mjs';

const webUrl = process.env.PASSENGER_WEB_URL ?? 'http://127.0.0.1:3302';
const apiUrl =
  process.env.PASSENGER_API_BASE_URL ?? 'http://127.0.0.1:3303/api/v1';
const chromePath =
  process.env.PRODUCT_P1R_CHROME ??
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const reviewer = 'cp3-controlled-reviewer';

async function installGpsStub(context) {
  await context.addInitScript(() => {
    let id = 0;
    const watches = new Map();
    const fake = {
      watchPosition(success) {
        const key = ++id;
        watches.set(key, success);
        window.__gpsWatch = (p) =>
          watches.get(key)?.({
            coords: {
              latitude: p.lat,
              longitude: p.lon,
              accuracy: p.acc ?? 8,
              heading: null,
              altitude: null,
              altitudeAccuracy: null,
              speed: null,
            },
            timestamp: p.t ?? Date.now(),
          });
        return key;
      },
      clearWatch(key) {
        watches.delete(key);
      },
      getCurrentPosition(_success, error) {
        error?.({ code: 2, message: 'unavailable' });
      },
    };
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      get: () => fake,
    });
  });
}
function attrs(page) {
  return page.evaluate(() => {
    const c = document.querySelector('.navigation-card');
    return c
      ? {
          text: c.innerText,
          scope: c.getAttribute('data-navigation-scope'),
          evidence: c.getAttribute('data-provenance'),
          maneuverIndex: c.getAttribute('data-maneuver-index'),
          total: c.getAttribute('data-maneuver-total'),
        }
      : null;
  });
}
async function direct(path, options = {}) {
  const response = await fetch(`${apiUrl}/${path}`, {
    ...options,
    headers: {
      accept: 'application/json',
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  const body = await response.json().catch(() => null);
  assert.ok(
    response.ok,
    `${options.method ?? 'GET'} ${path}: ${response.status} ${JSON.stringify(body)}`,
  );
  return body?.data;
}

await assertCp2Runtime();
const browser = await chromium.launch({
  executablePath: chromePath,
  headless: true,
});
const summary = {
  status: 'PASS',
  provenance:
    'SIMULATED geolocation stub; real OTP plan; controlled review API',
};
try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    permissions: ['geolocation'],
  });
  await installGpsStub(context);
  const page = await context.newPage();
  await page.clock.install();
  await page.goto(webUrl, { waitUntil: 'domcontentloaded' });
  await page
    .getByRole('button', { name: /Load presentation scenario/ })
    .waitFor();

  const planResponse = page.waitForResponse(
    (r) =>
      r.url().endsWith('/api/passenger/journeys/plan') &&
      r.request().method() === 'POST',
    { timeout: 120000 },
  );
  await page
    .getByRole('button', { name: /Load presentation scenario/ })
    .click();
  const plan = await planResponse;
  assert.equal(plan.status(), 201);
  const planned = await plan.json();
  const candidate = planned.data.find((j) => j.segments?.[0]?.mode === 'WALK');
  assert.ok(candidate, 'OTP plan has no WALK-first candidate');
  summary.original_journey_id = candidate.journey_id;
  summary.original_itinerary_identity =
    candidate.plan_fingerprint ?? candidate.journey_id;

  const index = planned.data.indexOf(candidate);
  await page
    .getByRole('region', { name: 'Journey choices' })
    .getByRole('button')
    .nth(index)
    .click();
  const activation = page.waitForResponse(
    (r) => r.url().includes('/activate') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Mulai Perjalanan' }).click();
  const activatedResponse = await activation;
  assert.ok([200, 201].includes(activatedResponse.status()));
  const activated = (await activatedResponse.json()).data;
  summary.active_journey_id = activated.journey_id;
  const sessionCookie = (await context.cookies()).find(
    (c) => c.name === 'transumin_proto_session',
  );
  summary.owner_session = sessionCookie
    ? decodeURIComponent(sessionCookie.value).split('.')[0]
    : null;
  assert.ok(
    typeof summary.owner_session === 'string' &&
      summary.owner_session.startsWith('passenger:'),
    `expected passenger session cookie got ${summary.owner_session}`,
  );
  assert.equal(activated.segments[0].mode, 'WALK');
  await page.getByRole('heading', { name: 'Your active journey' }).waitFor();
  const before = await attrs(page);
  assert.ok(before?.scope?.startsWith(`${activated.journey_id}:`));
  summary.walk_navigation_scope_before = before.scope;
  summary.walk_navigation_evidence_before = before.evidence;
  assert.ok(
    ['OTP_DERIVED_MANEUVER', 'SCHEMATIC_GEOMETRY'].includes(before.evidence),
  );
  console.log(
    `ASSERT recovery.walk_active scope=${before.scope} evidence=${before.evidence}`,
  );
  const activeBeforeRecovery = await page.evaluate(
    async (id) => (await fetch(`/api/passenger/journeys/${id}`)).json(),
    activated.journey_id,
  );
  assert.equal(activeBeforeRecovery.data.progress.completed_segment_count, 0);
  assert.equal(activeBeforeRecovery.data.status, 'ACTIVE');
  summary.original_segment_count = activeBeforeRecovery.data.segments.length;
  summary.original_itinerary_segments = activeBeforeRecovery.data.segments
    .map((s) => s.mode)
    .join(',');
  summary.original_plan_id =
    activeBeforeRecovery.data.original_plan.journey_id ??
    activeBeforeRecovery.data.plan_journey_id;
  summary.leg_progressed = true;
  const progressResponse = page.waitForResponse(
    (r) =>
      r
        .url()
        .includes(`/api/passenger/journeys/${activated.journey_id}/progress`) &&
      r.request().method() === 'PATCH',
  );
  await page.getByRole('button', { name: 'Lanjutkan Perjalanan' }).click();
  assert.equal((await progressResponse).status(), 200);
  const activeAfterWalkProgress = await page.evaluate(
    async (id) => (await fetch(`/api/passenger/journeys/${id}`)).json(),
    activated.journey_id,
  );
  assert.equal(
    activeAfterWalkProgress.data.progress.completed_segment_count,
    1,
  );
  assert.equal(activeAfterWalkProgress.data.status, 'ACTIVE');
  assert.equal(
    activeAfterWalkProgress.data.segments[
      activeAfterWalkProgress.data.progress.completed_segment_count - 1
    ].mode,
    'WALK',
  );
  console.log(
    `ASSERT recovery.walk_leg_progressed completed_segments=${activeAfterWalkProgress.data.progress.completed_segment_count} plan=${summary.original_plan_id}`,
  );
  const activeAfterWalk = await page.evaluate(() => document.body.innerText);
  assert.ok(/Laporkan kondisi/.test(activeAfterWalk));

  // Submit report through real passenger UI; status must remain REPORTED_UNVERIFIED.
  const target = page.locator('#report-target');
  await target.waitFor();
  const options = await target
    .locator('option')
    .evaluateAll((items) =>
      items.map((x) => ({ value: x.value, text: x.textContent })),
    )
    .then((x) => x.filter((o) => o.value));
  assert.ok(options[0], 'No remaining report target');
  await target.selectOption(options[0].value);
  await page
    .locator('#report-description')
    .fill('Controlled passenger observation for continuity proof.');
  const submittedReport = page.waitForResponse(
    (r) =>
      r.url().endsWith('/api/passenger/passenger-reports') &&
      r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Kirim laporan' }).click();
  const submittedResponse = await submittedReport;
  const submittedBody = await submittedResponse.json().catch(() => null);
  assert.equal(
    submittedResponse.status(),
    201,
    `report submit failed: ${JSON.stringify(submittedBody)}`,
  );
  await page
    .getByText(/Laporan tersimpan .*Belum diverifikasi/)
    .waitFor({ timeout: 30000 });
  const reportCard = page.locator('.report-list article').first();
  const reportText = await reportCard.innerText();
  assert.match(reportText, /Belum diverifikasi/);
  const reportId = (await reportCard.getAttribute('aria-label')).replace(
    'Laporan ',
    '',
  );
  summary.report_id = reportId;
  summary.report_status = 'REPORTED_UNVERIFIED';
  console.log(`ASSERT report.status=REPORTED_UNVERIFIED report_id=${reportId}`);

  // Controlled reviewer flow: direct API only, no reviewer credential in browser.
  assert.ok(
    process.env.CONTROLLED_REVIEW_TOKEN &&
      process.env.CONTROLLED_REVIEW_TOKEN.length >= 32,
    'controlled reviewer token missing',
  );
  const verified = await direct(
    `controlled/passenger-reports/${reportId}/verify`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${process.env.CONTROLLED_REVIEW_TOKEN}`,
        'x-controlled-reviewer': reviewer,
      },
      body: JSON.stringify({
        operational_state: 'UNAVAILABLE',
        incident_type: 'SERVICE_SUSPENSION',
        reason: 'Controlled SIMULATED continuity review.',
      }),
    },
  );
  assert.equal(verified.verification_status, 'CONTROLLED_VERIFIED');
  summary.review_provenance = 'SIMULATED';
  console.log(
    `ASSERT report.review status=CONTROLLED_VERIFIED provenance=SIMULATED reviewer=${reviewer}`,
  );

  await page
    .getByRole('region', { name: 'Journey updates' })
    .getByRole('article', { name: 'Targeted journey alert' })
    .waitFor({ timeout: 30000 });
  const alert = page
    .getByRole('region', { name: 'Journey updates' })
    .getByRole('article', { name: 'Targeted journey alert' });
  assert.ok(await alert.count());
  summary.targeted_alert = true;

  const otherContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  let otherOwner;
  try {
    const otherPage = await otherContext.newPage();
    await otherPage.goto(webUrl, { waitUntil: 'domcontentloaded' });
    await otherPage
      .getByRole('button', { name: /Load presentation scenario/ })
      .waitFor();
    const otherPlan = otherPage.waitForResponse(
      (r) =>
        r.url().endsWith('/api/passenger/journeys/plan') &&
        r.request().method() === 'POST',
      { timeout: 120000 },
    );
    await otherPage
      .getByRole('button', { name: /Load presentation scenario/ })
      .click();
    assert.equal((await otherPlan).status(), 201);
    await otherPage
      .getByRole('region', { name: 'Journey choices' })
      .getByRole('button')
      .first()
      .click();
    const otherActivation = otherPage.waitForResponse(
      (r) => r.url().includes('/activate') && r.request().method() === 'POST',
    );
    await otherPage.getByRole('button', { name: 'Mulai Perjalanan' }).click();
    assert.ok([200, 201].includes((await otherActivation).status()));
    await otherPage
      .getByRole('heading', { name: 'Your active journey' })
      .waitFor({ timeout: 30000 });
    await otherPage.waitForTimeout(1500);
    const otherAlerts = await otherPage
      .getByRole('region', { name: 'Journey updates' })
      .getByRole('article', { name: 'Targeted journey alert' })
      .count();
    assert.equal(otherAlerts, 0, 'unaffected owner received targeted alert');
    const otherCookie = (await otherContext.cookies()).find(
      (c) => c.name === 'transumin_proto_session',
    );
    otherOwner = otherCookie
      ? decodeURIComponent(otherCookie.value).split('.')[0]
      : null;
    assert.ok(otherOwner && otherOwner !== summary.owner_session);
    summary.unaffected_owner_session = otherOwner;
    summary.unaffected_owner_alert_count = otherAlerts;
    console.log(
      `ASSERT alert.owner_targeted=true owner=${summary.owner_session} unaffected_owner=${otherOwner} alerts=0`,
    );

    const recoveryResponse = page.waitForResponse(
      (r) => r.url().endsWith('/recoveries') && r.request().method() === 'POST',
      { timeout: 120000 },
    );
    await alert.getByRole('button', { name: 'Find another way' }).click();
    const proposal = await (await recoveryResponse).json();
    await page
      .getByRole('heading', { name: 'Recovery option' })
      .waitFor({ timeout: 120000 });
    const recoveryId = proposal.data?.recovery_id;
    assert.ok(recoveryId, 'recovery ID missing before acceptance');
    const crossOwnerStatus = await otherPage.evaluate(async (id) => {
      const response = await fetch(`/api/passenger/recoveries/${id}`);
      return response.status;
    }, recoveryId);
    assert.equal(crossOwnerStatus, 404, 'foreign owner read recovery proposal');
    summary.cross_owner_recovery_rejected = true;
    console.log(
      `ASSERT recovery.cross_owner_rejected status=${crossOwnerStatus} foreign_owner=${otherOwner}`,
    );
  } finally {
    await otherContext.close();
  }
  await page.getByRole('button', { name: 'Use this repaired route' }).click();
  await page.getByText(/Recovery accepted/).waitFor({ timeout: 120000 });

  const after = await attrs(page);
  const postAccept = await page.evaluate(
    async (id) => (await fetch(`/api/passenger/journeys/${id}`)).json(),
    activated.journey_id,
  );
  summary.accepted_recovery_id = postAccept.data.accepted_recovery_id;
  assert.ok(
    summary.accepted_recovery_id,
    'accepted recovery ID missing after refresh from server',
  );
  assert.equal(postAccept.data.journey_id, activated.journey_id);
  assert.equal(postAccept.data.progress.completed_segment_count, 1);
  assert.deepEqual(
    postAccept.data.segments.slice(0, 1),
    activeAfterWalkProgress.data.segments.slice(0, 1),
    'recovery changed completed WALK history',
  );
  assert.ok(after?.scope?.includes(`:${summary.accepted_recovery_id}:1.`));
  assert.equal(
    after?.maneuverIndex,
    '-1',
    'obsolete maneuver index survived recovery',
  );
  summary.current_segment_count = postAccept.data.segments.length;
  summary.new_itinerary_segments = postAccept.data.segments
    .map((s) => s.mode)
    .join(',');
  summary.new_leg_geometry_rendered = postAccept.data.segments.some(
    (s) =>
      Array.isArray(s.geometry?.coordinates) &&
      s.geometry.coordinates.length >= 2,
  );
  summary.original_plan_preserved =
    postAccept.data.original_plan.journey_id === summary.original_plan_id;
  assert.ok(summary.original_plan_preserved);
  console.log(
    `ASSERT recovery.accepted accepted_recovery_id=${summary.accepted_recovery_id} lineage=true original_plan_preserved=true`,
  );
  console.log(
    `ASSERT itinerary.revision remaining_legs ${summary.original_segment_count} -> ${summary.current_segment_count} modes=${summary.new_itinerary_segments}`,
  );
  console.log(
    `ASSERT leg_geometry.rendered=${summary.new_leg_geometry_rendered}`,
  );
  const walkingLegs = postAccept.data.segments.filter((s) => s.mode === 'WALK');
  const walkingWithSteps = walkingLegs.filter(
    (s) => Array.isArray(s.walking_steps) && s.walking_steps.length > 0,
  );
  console.log(
    `ASSERT navigation.walking_maneuvers walk_legs=${walkingLegs.length} maneuvers=${walkingWithSteps.length ? 'OTP_DERIVED' : 'SCHEMATIC_GEOMETRY fallback'}`,
  );
  const scopeIdle = after?.scope === 'none' && walkingLegs.length === 0;
  if (!scopeIdle)
    assert.notEqual(
      after?.scope,
      before?.scope,
      'navigation scope stayed stale',
    );
  assert.ok(
    !/Reposisi diperlukan/i.test(after?.text ?? ''),
    'stale navigation instruction remained',
  );
  summary.recovery_acceptance_lineage = true;
  summary.active_itinerary_revision = summary.accepted_recovery_id;
  summary.walk_navigation_scope_after = after?.scope;
  summary.walk_navigation_evidence_after = after?.evidence;
  console.log(
    `ASSERT navigation.scope_changed old=${before.scope} new=${after.scope} idle_nonwalk=${scopeIdle}`,
  );
  console.log(
    `ASSERT navigation.stale_instruction_invalidated=true new_leg_geometry_rendered=${summary.new_leg_geometry_rendered} evidence=${after.evidence}`,
  );

  await page.reload();
  await page
    .getByRole('heading', { name: 'Your active journey' })
    .waitFor({ timeout: 30000 });
  await page.getByText(/Recovery accepted/).waitFor({ timeout: 30000 });
  summary.refresh_after_recovery = true;
  console.log(
    'ASSERT refresh.after_recovery accepted_itinerary_persisted=true',
  );

  // Continue via controlled manual boarding/alighting/progression until server marks completion.
  for (let i = 0; i < 12; i += 1) {
    const complete = page.getByRole('button', {
      name: 'Selesaikan Perjalanan',
    });
    if (await complete.count()) {
      await complete.click();
      break;
    }
    const board = page.getByRole('button', { name: 'Saya Sudah Naik' });
    if (await board.count()) {
      await board.click();
      await page.waitForTimeout(250);
      continue;
    }
    const alight = page.getByRole('button', { name: 'Saya Sudah Turun' });
    if (await alight.count()) {
      await alight.click();
      await page.waitForTimeout(250);
      continue;
    }
    const next = page.getByRole('button', { name: 'Lanjutkan Perjalanan' });
    if (await next.count()) {
      await next.click();
      await page.waitForTimeout(350);
      continue;
    }
    throw new Error('No legitimate continuation control after recovery');
  }
  await page
    .getByText(/Selesaikan Perjalanan — perjalanan ini sudah selesai/)
    .waitFor({ timeout: 30000 });
  summary.completed = true;
  await page.reload();
  await page
    .getByRole('heading', { name: 'Your active journey' })
    .waitFor({ timeout: 30000 });
  await page
    .getByText(/Selesaikan Perjalanan — perjalanan ini sudah selesai/)
    .waitFor({ timeout: 30000 });
  summary.completed_after_reload = true;
  console.log(
    'ASSERT completion.status=COMPLETED reload_persistence=true recovery_lineage=true',
  );
  console.log(JSON.stringify(summary));
} catch (error) {
  console.error(
    JSON.stringify({
      status: 'NOT_VERIFIED',
      message: error instanceof Error ? error.message : String(error),
    }),
  );
  process.exitCode = 1;
} finally {
  await browser.close();
}
