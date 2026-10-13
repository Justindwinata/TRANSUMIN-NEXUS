import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright-core';

const webUrl = process.env.PASSENGER_WEB_URL ?? 'http://127.0.0.1:3000';
const chromePath =
  process.env.PRODUCT_P1R_CHROME ??
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const repositoryRoot = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const gpsRequestPattern = /(?:geo(?:location)?|gps|location)/i;

async function waitForApp(page) {
  await page.goto(webUrl, { waitUntil: 'domcontentloaded' });
  const config = await page.request.get(`${webUrl}/api/passenger/config`);
  assert.equal(config.status(), 200, 'Passenger routing snapshot is not configured.');
  await page.getByRole('button', { name: /Load presentation scenario/ }).waitFor();
}

async function loadAndActivate(page) {
  await waitForApp(page);
  const planning = page.waitForResponse((response) => response.url().endsWith('/api/passenger/journeys/plan') && response.request().method() === 'POST', { timeout: 120_000 });
  await page.getByRole('button', { name: /Load presentation scenario/ }).click();
  const planResponse = await planning;
  const body = await planResponse.json().catch(() => null);
  assert.equal(planResponse.status(), 201, `Real plan failed: ${planResponse.status()} ${JSON.stringify(body?.error ?? body)}`);
  const plans = body?.data ?? body;
  assert.ok(Array.isArray(plans) && plans.length > 0, 'Real OTP returned no alternatives.');
  await page
    .getByRole('region', { name: 'Journey choices' })
    .getByRole('button')
    .first()
    .waitFor({ timeout: 120_000 });
  assert.ok(
    await page.getByText('Historical controlled replay').count(),
    'Presentation scenario evidence label missing.',
  );
  assert.ok(
    await page.getByText('Gambir').count() && (await page.getByText('Pejaten').count()),
    'Presentation scenario places missing.',
  );
  const activation = page.waitForResponse((response) => /\/activate$/.test(response.url()) && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Mulai Perjalanan' }).click();
  assert.equal((await activation).status(), 201, 'Real activation failed.');
  await page.getByRole('heading', { name: 'Your active journey' }).waitFor({ timeout: 30_000 });
  await page.getByText(/Progress is manual/).first().waitFor();
  await page.getByText('Lokasi perangkat (opsional)').click();
  assert.equal(await page.getByRole('button', { name: 'Bagikan lokasi perangkat sekali ini' }).count(), 1, 'GPS not OFF by default.');
  await page.getByText('Lokasi perangkat (opsional)').click();
}

async function assertNoGpsPersistence(page) {
  const storage = await page.evaluate(() => Object.fromEntries(
    Object.entries(localStorage).filter(([key, value]) => /geo|gps|location/i.test(`${key} ${value}`)),
  ));
  assert.deepEqual(storage, {}, 'GPS/location data persisted in localStorage.');
}

async function requestLocation(page) {
  const share = page.getByRole('button', { name: 'Bagikan lokasi perangkat sekali ini' });
  if ((await share.count()) === 0) await page.getByText('Lokasi perangkat (opsional)').click();
  await share.click();
  await page
    .getByRole('alert')
    .filter({ hasText: 'Izin lokasi ditolak' })
    .waitFor({ timeout: 15_000 });
  assert.match(
    await page.locator('.progress-actions').innerText(),
    /0 of \d+ parts complete/,
    'Denied GPS caused automatic progress or boarding.',
  );
}

async function advanceManually(page) {
  const before = await page.locator('.progress-actions').innerText();
  assert.match(before, /0 of \d+ parts complete/);
  const boarding = page.getByRole('button', { name: 'Saya Sudah Naik' });
  if (await boarding.count()) {
    await boarding.click();
    await page.getByRole('button', { name: 'Saya Sudah Turun' }).click();
  }
  const advance = page.getByRole('button', { name: /Lanjutkan Perjalanan|Selesaikan Perjalanan/ });
  await advance.click();
  await page.getByText(/1 of \d+ parts complete/).waitFor();
  assert.match(await page.locator('.progress-actions').innerText(), /Progress is manual/);
}

const browser = await chromium.launch({
  executablePath: chromePath,
  headless: true,
  args: ['--deny-permission-prompts'],
});
const gpsRequests = [];
try {
  const denied = await browser.newContext({
    viewport: { width: 390, height: 844 },
    permissions: [],
  });
  const deniedPage = await denied.newPage();
  deniedPage.on('request', (request) => {
    if (gpsRequestPattern.test(request.url())) gpsRequests.push(request.url());
  });
  await loadAndActivate(deniedPage);
  const permissionState = await deniedPage.evaluate(async () =>
    (await navigator.permissions.query({ name: 'geolocation' })).state,
  );
  assert.equal(permissionState, 'denied', 'Chromium geolocation permission is not denied.');
  await requestLocation(deniedPage);
  await assertNoGpsPersistence(deniedPage);
  await advanceManually(deniedPage);
  await assertNoGpsPersistence(deniedPage);

  const unsupported = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  await unsupported.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'geolocation', {
      configurable: true,
      get: () => undefined,
    });
  });
  const unsupportedPage = await unsupported.newPage();
  unsupportedPage.on('request', (request) => {
    if (gpsRequestPattern.test(request.url())) gpsRequests.push(request.url());
  });
  await loadAndActivate(unsupportedPage);
  if ((await unsupportedPage.getByRole('button', { name: 'Bagikan lokasi perangkat sekali ini' }).count()) === 0)
    await unsupportedPage.getByText('Lokasi perangkat (opsional)').click();
  await unsupportedPage.getByRole('button', { name: 'Bagikan lokasi perangkat sekali ini' }).click();
  await unsupportedPage.getByText(/Peramban ini tidak mendukung lokasi perangkat/).waitFor();
  await assertNoGpsPersistence(unsupportedPage);
  await advanceManually(unsupportedPage);
  await assertNoGpsPersistence(unsupportedPage);

  assert.deepEqual(gpsRequests, [], 'GPS/location network request detected.');
  console.log(JSON.stringify({
    status: 'PASS',
    evidence: 'real presentation scenario plan/activate through 127.0.0.1:3000 proxy',
    chromium_permission: permissionState,
    gps_default: 'OFF',
    denied_context: 'permission denied by Chromium setting; manual progression passed',
    unsupported_context: 'SIMULATED unsupported geolocation via isolated init script; manual progression passed',
    auto_boarding: false,
    location_network_requests: 0,
    location_persistence: false,
    repository_root: repositoryRoot,
  }));
} finally {
  await browser.close();
}
