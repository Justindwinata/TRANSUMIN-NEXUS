import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

const webUrl = process.env.PASSENGER_WEB_URL ?? 'http://127.0.0.1:3000';
const chromePath =
  process.env.PRODUCT_P1R_CHROME ??
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const allowed = new Set([
  'gojek.com',
  'www.gojek.com',
  'grab.com',
  'www.grab.com',
  'bluebirdgroup.com',
  'www.bluebirdgroup.com',
]);

// Level 1 handoff: official provider websites only. No partner API, no
// undocumented deep link, no automatic coordinate transfer, no booking claim.
const browser = await chromium.launch({
  executablePath: chromePath,
  headless: true,
});
const summary = {
  status: 'PASS',
  integration_level: 'LEVEL_1_EXTERNAL_HANDOFF',
};
try {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const page = await ctx.newPage();
  await page.goto(webUrl, { waitUntil: 'domcontentloaded' });
  await page
    .getByRole('button', { name: /Load presentation scenario/ })
    .waitFor();
  await page
    .getByRole('button', { name: /Load presentation scenario/ })
    .click();
  await page
    .getByRole('region', { name: 'Journey choices' })
    .getByRole('button')
    .first()
    .waitFor({ timeout: 120000 });
  await page.getByRole('button', { name: 'Mulai Perjalanan' }).click();
  await page
    .getByRole('heading', { name: 'Your active journey' })
    .waitFor({ timeout: 30000 });

  const links = page.locator('.external-handoff a');
  await links.first().waitFor({ timeout: 15000 });
  assert.equal(
    await links.count(),
    3,
    'Expected Gojek, Grab, Bluebird handoff links.',
  );
  for (const href of await links.evaluateAll((nodes) =>
    nodes.map((n) => n.href),
  )) {
    const url = new URL(href);
    assert.equal(url.protocol, 'https:', `Non-HTTPS handoff: ${href}`);
    assert.ok(
      allowed.has(url.hostname),
      `Unverified provider host: ${url.hostname}`,
    );
    assert.equal(
      url.search,
      '',
      `Handoff URL carries query/coordinates: ${href}`,
    );
  }
  const rels = await links.evaluateAll((nodes) => nodes.map((n) => n.rel));
  for (const rel of rels)
    assert.ok(
      rel.includes('noopener') && rel.includes('noreferrer'),
      `Unsafe rel: ${rel}`,
    );
  const body = await page.locator('.external-handoff').innerText();
  assert.ok(
    /tidak dikirim otomatis|koordinat tidak/i.test(body),
    'Coordinate transfer honesty missing.',
  );
  assert.ok(
    !/tersedia sopir|driver tersedia|harga pasti|fare confirmed/i.test(body),
    'Fabricated availability or fare.',
  );
  await page.screenshot({ path: '.release-evidence/R4/r4-f06-handoff.png' });
  summary.providers = ['Gojek', 'Grab', 'Bluebird'];
  summary.coordinate_transfer = false;
  summary.booking_claim = false;
  console.log(JSON.stringify(summary));
} catch (error) {
  console.error(
    JSON.stringify({
      status: 'FAIL',
      message: error instanceof Error ? error.message : String(error),
    }),
  );
  process.exitCode = 1;
} finally {
  await browser.close();
}
