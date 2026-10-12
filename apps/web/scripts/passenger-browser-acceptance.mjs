import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright-core';

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../..',
);
const webUrl = process.env.PASSENGER_WEB_URL ?? 'http://localhost:3000';
const apiUrl = process.env.PASSENGER_API_URL ?? 'http://127.0.0.1:3001/api/v1';
const chromePath =
  process.env.PRODUCT_P1R_CHROME ??
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const evidenceDir =
  process.env.PRODUCT_P1R_SCREENSHOT_DIR ??
  join(repositoryRoot, 'data/processed/product-p1r-browser');
const departure = '2026-10-02T08:00';

if (!process.env.DATABASE_URL)
  throw new Error(
    'DATABASE_URL must point to an isolated local acceptance DB.',
  );

async function waitForWeb() {
  const response = await fetch(webUrl, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok)
    throw new Error(`Passenger web returned ${response.status}.`);
}

async function startAcceptanceApi() {
  const child = spawn('pnpm', ['data:product-p1r:serve'], {
    cwd: repositoryRoot,
    env: { ...process.env, PRODUCT_P1R_ACCEPTANCE: '1' },
    detached: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const lines = [];
  const events = new EventEmitter();
  let output = '';
  let diagnostic = '';
  child.stdout.on('data', (chunk) => {
    output += chunk.toString();
    let boundary = output.indexOf('\n');
    while (boundary >= 0) {
      const line = output.slice(0, boundary).trim();
      output = output.slice(boundary + 1);
      lines.push(line);
      events.emit('line');
      boundary = output.indexOf('\n');
    }
  });
  child.stderr.on('data', (chunk) => {
    diagnostic = `${diagnostic}${chunk}`.slice(-2000);
  });
  const server = { child, lines, events, diagnostic: () => diagnostic };
  await waitForLine(server, /P1R_ACCEPTANCE_READY/, 0, 60_000);
  return server;
}

function waitForLine(server, pattern, after, timeoutMs = 45_000) {
  return new Promise((resolveLine, rejectLine) => {
    const check = () => {
      const line = server.lines.slice(after).find((item) => pattern.test(item));
      if (line) {
        cleanup();
        resolveLine(line);
      }
    };
    const failed = () => {
      cleanup();
      rejectLine(new Error(`Acceptance API stopped: ${server.diagnostic()}`));
    };
    const timer = setTimeout(() => {
      cleanup();
      rejectLine(new Error(`Acceptance API timeout: ${server.diagnostic()}`));
    }, timeoutMs);
    function cleanup() {
      clearTimeout(timer);
      server.events.off('line', check);
      server.child.off('exit', failed);
    }
    server.events.on('line', check);
    server.child.on('exit', failed);
    check();
  });
}

async function stopAcceptanceApi(server) {
  if (
    !server ||
    server.child.exitCode !== null ||
    server.child.signalCode !== null
  )
    return;
  const stopped = new Promise((resolveStop) => {
    server.child.once('exit', resolveStop);
    setTimeout(resolveStop, 10_000);
  });
  try {
    process.kill(-server.child.pid, 'SIGTERM');
  } catch {
    server.child.kill('SIGTERM');
  }
  await stopped;
}

async function inject(server, entityId, mode, state, expired = false) {
  const after = server.lines.length;
  server.child.stdin.write(
    `${JSON.stringify({ entityId, mode, state, expired })}\n`,
  );
  const line = await waitForLine(
    server,
    /"status":"INJECTED_SIMULATED"/,
    after,
  );
  const result = JSON.parse(line);
  assert.equal(result.unresolvedReferences.length, 0);
  return result;
}

async function apiRequest(resource, owner) {
  const response = await fetch(`${apiUrl}/${resource}`, {
    headers: { 'x-journey-owner': owner },
  });
  return { response, body: await response.json() };
}

async function choosePlace(page, field, query, option) {
  await page.getByRole('combobox', { name: field }).fill(query);
  await page.getByRole('option', { name: option }).click();
}

async function planAndActivate(page, sharedJourney = null) {
  await page.goto(webUrl);
  await choosePlace(page, 'From', 'Harmoni', /^Harmoni TransJakarta · station/);
  await choosePlace(
    page,
    'To',
    'Lebak Bulus Bank Syariah Indonesia',
    /^Lebak Bulus Bank Syariah Indonesia MRT Jakarta · station/,
  );
  await page
    .getByRole('textbox', { name: 'Depart (Jakarta time)' })
    .fill(departure);
  const planningResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/passenger/journeys/plan') &&
      response.request().method() === 'POST',
    { timeout: 120_000 },
  );
  await page.getByRole('button', { name: 'Find journeys' }).click();
  const planned = (await (await planningResponse).json()).data;
  const choiceButtons = page
    .getByRole('region', { name: 'Journey choices' })
    .getByRole('button');
  await choiceButtons.first().waitFor({ timeout: 120_000 });
  const choices = await choiceButtons.all();
  let selected = null;
  let selectedIndex = -1;
  for (const [index, choice] of choices.entries()) {
    const label = await choice.innerText();
    if (label.includes('TransJakarta') && label.includes('MRT Jakarta')) {
      selected = choice;
      selectedIndex = index;
      break;
    }
  }
  assert.ok(selected, 'Real OTP returned no TransJakarta + MRT option.');
  const selectedJourney = planned[selectedIndex];
  assert.ok(selectedJourney, 'Selected option was not in the OTP response.');
  await selected.click();
  if (!sharedJourney) {
    await mkdir(evidenceDir, { recursive: true });
    for (const [name, width, height] of [
      ['mobile', 390, 844],
      ['tablet', 768, 900],
      ['desktop', 1280, 900],
    ]) {
      await page.setViewportSize({ width, height });
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      );
      assert.equal(overflow, false, `${name} search has horizontal overflow.`);
      await page.screenshot({
        path: join(evidenceDir, `journey-search-${name}.png`),
        fullPage: true,
      });
    }
    await page.setViewportSize({ width: 390, height: 844 });
  }
  if (sharedJourney) {
    assert.equal(
      selectedJourney.journey_id,
      sharedJourney.journey_id,
      'Independent OTP searches must identify the same itinerary.',
    );
    const activation = await page.evaluate(async (journey) => {
      const owner = localStorage.getItem('transumin.passenger.owner');
      const response = await fetch(
        `/api/passenger/journeys/${journey.journey_id}/activate`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-journey-owner': owner,
          },
          body: JSON.stringify({
            selected_journey: journey,
            activated_at: journey.start_at,
          }),
        },
      );
      return { status: response.status, body: await response.json() };
    }, sharedJourney);
    assert.equal(activation.status, 201);
    await page.evaluate((journeyId) => {
      localStorage.setItem('transumin.passenger.journey', journeyId);
    }, activation.body.data.journey_id);
    await page.reload();
  } else {
    await page.getByRole('button', { name: 'Start this journey' }).click();
  }
  await page
    .getByRole('complementary', { name: 'Your active journey' })
    .waitFor();
  await page
    .getByText('Connected to journey-specific updates.')
    .waitFor({ timeout: 30_000 });
  const ids = await page.evaluate(() => ({
    owner: localStorage.getItem('transumin.passenger.owner'),
    journeyId: localStorage.getItem('transumin.passenger.journey'),
  }));
  assert.ok(
    ids.owner && ids.journeyId,
    'Browser did not persist owner/journey.',
  );
  const { response, body } = await apiRequest(
    `journeys/${ids.journeyId}`,
    ids.owner,
  );
  assert.equal(response.status, 200);
  assert.equal(body.data.status, 'ACTIVE');
  return { ...ids, journey: body.data, selectedJourney };
}

async function advance(page, completed, at) {
  await page
    .getByRole('textbox', { name: 'Progress time (Jakarta, controlled)' })
    .fill(at);
  await page
    .getByRole('button', { name: 'Mark current part complete' })
    .click();
  await page
    .getByText(`${completed} of 4 parts complete. Progress is manual.`)
    .waitFor();
}

let server;
let browser;
let affectedEntity = null;
try {
  await waitForWeb();
  server = await startAcceptanceApi();
  browser = await chromium.launch({
    executablePath: chromePath,
    headless: true,
  });
  const contextA = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const contextB = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  const a = await planAndActivate(pageA);
  const b = await planAndActivate(pageB, a.selectedJourney);
  assert.notEqual(a.owner, b.owner);
  assert.notEqual(a.journeyId, b.journeyId);
  assert.equal(a.journey.plan_journey_id, b.journey.plan_journey_id);
  assert.equal(a.journey.plan_fingerprint, b.journey.plan_fingerprint);
  assert.equal(a.journey.segments.length, 4);
  assert.equal(a.journey.segments[1].mode, 'TRANSJAKARTA');
  await advance(pageA, 1, '2026-10-02T08:07');
  await advance(pageB, 1, '2026-10-02T08:07');
  await advance(pageB, 2, '2026-10-02T08:24');
  const aBefore = (await apiRequest(`journeys/${a.journeyId}`, a.owner)).body
    .data;
  const bBefore = (await apiRequest(`journeys/${b.journeyId}`, b.owner)).body
    .data;
  assert.equal(aBefore.progress.completed_segment_count, 1);
  assert.equal(bBefore.progress.completed_segment_count, 2);
  const affected = aBefore.dependencies.find(
    (item) =>
      item.entity_type === 'ROUTE' && item.product_mode === 'TRANSJAKARTA',
  );
  assert.ok(affected, 'No canonical TransJakarta route dependency.');
  affectedEntity = affected.mobility_entity_id;
  await inject(
    server,
    affected.mobility_entity_id,
    'TRANSJAKARTA',
    'UNAVAILABLE',
  );
  await pageA
    .getByRole('article', { name: 'Targeted journey alert' })
    .waitFor();
  assert.match(
    await pageA
      .getByRole('article', { name: 'Targeted journey alert' })
      .innerText(),
    /Controlled simulation/,
  );
  assert.equal(
    await pageB
      .getByRole('article', { name: 'Targeted journey alert' })
      .count(),
    0,
  );
  const bAlerts = await apiRequest(`journeys/${b.journeyId}/alerts`, b.owner);
  assert.equal(bAlerts.response.status, 200);
  assert.equal(bAlerts.body.data.length, 0);
  const recoveryResponse = pageA.waitForResponse(
    (response) =>
      response.url().endsWith('/api/passenger/recoveries') &&
      response.request().method() === 'POST',
    { timeout: 120_000 },
  );
  await pageA.getByRole('button', { name: 'Find another way' }).click();
  const response = await recoveryResponse;
  assert.equal(response.status(), 201);
  const recovery = (await response.json()).data;
  assert.equal(recovery.status, 'COMPLETED');
  assert.ok(recovery.proposed_journey);
  assert.equal(recovery.metrics.disrupted_entity_avoidance, true);
  for (const segment of recovery.proposed_journey.segments) {
    for (const binding of segment.entity_bindings) {
      assert.notEqual(binding.canonical_entity_id, affected.mobility_entity_id);
      assert.notEqual(binding.mobility_entity_id, affected.mobility_entity_id);
    }
  }
  await pageA.getByRole('region', { name: 'Recovery option' }).waitFor();
  await pageA
    .getByRole('heading', { name: 'Original remaining trip' })
    .waitFor();
  await pageA.getByRole('heading', { name: 'Recommended route' }).waitFor();
  const aAfter = (await apiRequest(`journeys/${a.journeyId}`, a.owner)).body
    .data;
  assert.deepEqual(
    aAfter.segments,
    aBefore.segments,
    'Recovery changed the original plan.',
  );
  const denied = await apiRequest(
    `recoveries/${recovery.recovery_id}`,
    b.owner,
  );
  assert.ok(denied.response.status === 403 || denied.response.status === 404);
  const mrtDependency = bBefore.dependencies.find(
    (item) =>
      item.entity_type === 'ROUTE' && item.product_mode === 'MRT_JAKARTA',
  );
  assert.ok(mrtDependency);
  await inject(
    server,
    mrtDependency.mobility_entity_id,
    'MRT_JAKARTA',
    'UNKNOWN',
  );
  await inject(
    server,
    mrtDependency.mobility_entity_id,
    'MRT_JAKARTA',
    'UNAVAILABLE',
    true,
  );
  assert.equal(
    (await apiRequest(`journeys/${b.journeyId}/alerts`, b.owner)).body.data
      .length,
    0,
  );
  await pageA.route('**/api/passenger/journeys/*/alerts/stream', (route) =>
    route.abort(),
  );
  await pageA.reload();
  await pageA
    .getByText(
      'Reconnecting to journey updates. Latest alerts remain available.',
    )
    .waitFor({ timeout: 30_000 });
  await pageA.unroute('**/api/passenger/journeys/*/alerts/stream');
  await pageA
    .getByText('Connected to journey-specific updates.')
    .waitFor({ timeout: 45_000 });
  await pageB
    .getByText('Connected to journey-specific updates.')
    .waitFor({ timeout: 45_000 });
  assert.equal(
    await pageA
      .getByRole('article', { name: 'Targeted journey alert' })
      .count(),
    1,
  );
  assert.equal(
    await pageB
      .getByRole('article', { name: 'Targeted journey alert' })
      .count(),
    0,
  );
  await mkdir(evidenceDir, { recursive: true });
  const screenshots = [];
  for (const [name, width, height] of [
    ['mobile', 390, 844],
    ['tablet', 768, 900],
    ['desktop', 1280, 900],
  ]) {
    await pageA.setViewportSize({ width, height });
    const geometry = await pageA.evaluate(() => ({
      viewport: window.innerWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    assert.ok(
      geometry.scroll <= geometry.viewport,
      `${name} has horizontal overflow.`,
    );
    const path = join(evidenceDir, `passenger-${name}.png`);
    await pageA.screenshot({ path, fullPage: true });
    screenshots.push(path);
  }
  console.log(
    JSON.stringify({
      status: 'PASS',
      evidence:
        'two independent Chrome browser contexts, real OTP and database',
      plan_journey_id: a.journey.plan_journey_id,
      active_journey_ids: [a.journeyId, b.journeyId],
      affected_alerts: 1,
      unaffected_alerts: 0,
      recovery_status: recovery.status,
      blocked_entity_avoided: true,
      sse_reconnected: true,
      screenshots,
    }),
  );
} finally {
  if (browser) await browser.close();
  if (server && affectedEntity) {
    await inject(server, affectedEntity, 'TRANSJAKARTA', 'UNKNOWN').catch(
      () => undefined,
    );
  }
  await stopAcceptanceApi(server);
}
