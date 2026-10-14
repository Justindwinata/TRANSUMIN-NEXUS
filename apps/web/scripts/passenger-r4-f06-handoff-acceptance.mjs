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
  // LEVEL 1 trip context: coordinates leave the page only on explicit user
  // action, and they are copied, never embedded in a provider URL.
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByRole('button', { name: 'Salin tujuan' }).click();
  await page.getByText(/^Disalin: /).waitFor({ timeout: 10000 });
  const clipboard = await page.evaluate(() => navigator.clipboard.readText());
  assert.ok(
    clipboard.startsWith('Tujuan Transum-In: '),
    `Clipboard trip context unexpected: ${clipboard}`,
  );
  const pageText = await page.locator('body').innerText();
  assert.ok(
    !/\d+\.\d{4,}/.test(pageText),
    'Raw coordinates rendered into the page text.',
  );
  assert.ok(
    await links.evaluateAll((nodes) =>
      nodes.every((node) => new URL(node.href).pathname === '/'),
    ),
    'Handoff targets must be provider homepages with no redirect path.',
  );
  summary.trip_context_copy = true;
  summary.coordinates_in_dom = false;
  summary.redirect_params = false;
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
