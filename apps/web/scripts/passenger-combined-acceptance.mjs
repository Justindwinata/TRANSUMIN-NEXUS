import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { assertCp2Runtime } from './cp2-runtime-guard.mjs';
import {
  navigationScopeKey,
  walkGeometryIdentity,
} from '../src/lib/navigation.ts';

// COMBINED: V20 UI progression + FINAL Current/repeat + CP3 generation identity.
// No route interception, fabricated itinerary, or product DB writes.
const web = process.env.PASSENGER_WEB_URL;
const dir = process.env.PRODUCT_ACCEPTANCE_EVIDENCE_DIR;
assert.ok(web && dir, 'Owned isolated dispatcher environment required');
const summary = {
  suite: 'COMBINED',
  status: 'NOT VERIFIED',
  service_date: '2026-10-02',
  evidence_type: 'SCHEDULED',
  gps: 'SIMULATED',
  review: 'SIMULATED',
  results: [],
  defects: [],
};
const manifest = JSON.parse(
  readFileSync(
    new URL('../../../data/manifests/LOCAL-PLACE-INDEX.json', import.meta.url),
  ),
);
const bytes = readFileSync(
  new URL('../../../.local/geocoder/local-places.json', import.meta.url),
);
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
assert.equal(sha256(bytes), manifest.index_sha256);
const index = JSON.parse(bytes);
assert.equal(index.datasetVersionId, manifest.dataset_version_id);
summary.local_index = {
  sha256: sha256(bytes),
  dataset_version_id: index.datasetVersionId,
  source: manifest.source,
  coverage: manifest.coverage,
};
const jakarta = (at) =>
  new Date(Math.ceil(Date.parse(at) / 60000) * 60000 + 7 * 3600000)
    .toISOString()
    .slice(0, 16);
const safe = (message) => {
  let text = String(message);
  for (const key of ['CONTROLLED_REVIEW_TOKEN', 'PASSENGER_SESSION_SECRET'])
    if (process.env[key])
      text = text.replaceAll(process.env[key], '[REDACTED]');
  return text.slice(0, 1800);
};
await mkdir(dir, { recursive: true });
const persist = () =>
  Promise.all([
    writeFile(join(dir, 'combined.json'), JSON.stringify(summary, null, 2)),
    writeFile(
      join(dir, 'combined-defects.json'),
      JSON.stringify(summary.defects, null, 2),
    ),
  ]);
await assertCp2Runtime();
const browser = await chromium.launch({
  executablePath:
    process.env.PRODUCT_P1R_CHROME ??
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: web.startsWith('https:') ? ['--ignore-certificate-errors'] : [],
});
let stage = 'start';
try {
  for (const width of [390, 1280]) {
    // GPS coordinate comes from checksummed actual ADDRESS, not invented place.
    const addressEntry = index.entries.find(
      (entry) =>
        entry.kind === 'ADDRESS' && entry.name.includes('Mall Kelapa Gading'),
    );
    assert.ok(addressEntry, 'Actual ADDRESS unavailable in local index');
    const gps = {
      latitude: addressEntry.latitude,
      longitude: addressEntry.longitude,
      accuracy: 5,
    };
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      viewport: { width, height: width === 390 ? 844 : 900 },
      isMobile: width === 390,
      hasTouch: width === 390,
      permissions: ['geolocation'],
      geolocation: gps,
      serviceWorkers: 'block',
    });
    const result = {
      width,
      status: 'NOT VERIFIED',
      steps: [],
      requests: [],
      console: [],
      preferences: [],
      progress: [],
      screenshots: [],
    };
    summary.results.push(result);
    let reportId,
      reviewed = false,
      page;
    await context.tracing.start({
      screenshots: true,
      snapshots: true,
      sources: true,
    });
    const controlled = async (action, payload) => {
      const response = await fetch(
        `${process.env.CONTROLLED_REVIEW_API_URL}/controlled/passenger-reports/${reportId}/${action}`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${process.env.CONTROLLED_REVIEW_TOKEN}`,
            'x-controlled-reviewer': 'combined-simulated-reviewer',
            'content-type': 'application/json',
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(120000),
        },
      );
      const body = await response.json();
      assert.ok(response.ok, `controlled ${action}: HTTP ${response.status}`);
      return body.data;
    };
    try {
      page = await context.newPage();
      page.setDefaultTimeout(30000);
      page.on('console', (message) =>
        result.console.push({
          type: message.type(),
          text: safe(message.text()),
        }),
      );
      page.on('pageerror', (error) =>
        result.console.push({ type: 'pageerror', text: safe(error.message) }),
      );
      page.on('response', async (response) => {
        if (
          !response.url().includes('/api/passenger/') ||
          response.url().endsWith('/stream')
        )
          return;
        const body = await response.json().catch(() => null);
        result.requests.push({
          method: response.request().method(),
          path: new URL(response.url()).pathname,
          status: response.status(),
          request_id:
            body?.meta?.request_id ??
            body?.error?.request_id ??
            response.headers()['x-request-id'] ??
            null,
          idempotency_key:
            response.request().headers()['idempotency-key'] ?? null,
        });
      });
      const step = (name) => {
        stage = `${width}:${name}`;
        result.steps.push(name);
        console.log(JSON.stringify({ suite: 'COMBINED', stage }));
      };
      const wait = (suffix, method = 'POST') =>
        page.waitForResponse(
          (r) =>
            r.url().endsWith(`/api/passenger/${suffix}`) &&
            r.request().method() === method,
          { timeout: 120000 },
        );
      const data = async (response) => {
        const body = await response.json();
        assert.ok(
          response.ok(),
          `HTTP ${response.status()}: ${JSON.stringify(body.error ?? body).slice(0, 800)}`,
        );
        return body.data;
      };
      const mutation = async (button, suffix, method = 'POST') => {
        const pending = wait(suffix, method);
        const [, response] = await Promise.all([
          page.getByRole('button', { name: button, exact: true }).click(),
          pending,
        ]);
        return data(response);
      };
      const read = (path) =>
        context.request.get(`${web}/api/passenger/${path}`).then(data);
      const shot = async (name) => {
        const file = `combined-${width}-${name}.png`;
        await page.screenshot({ path: join(dir, file), fullPage: true });
        result.screenshots.push(file);
        const overflow = await page.evaluate(
          () =>
            Math.max(
              document.documentElement.scrollWidth,
              document.body.scrollWidth,
            ) - document.documentElement.clientWidth,
        );
        assert.ok(overflow <= 1, `${width}px overflow ${overflow}px`);
      };
      async function choose(label, query, kind) {
        const pending = page.waitForResponse((response) => {
          const url = new URL(response.url());
          return (
            url.pathname.endsWith('/api/passenger/transit/places') &&
            url.searchParams.get('q') === query
          );
        });
        const [, response] = await Promise.all([
          page.getByRole('combobox', { name: label, exact: true }).fill(query),
          pending,
        ]);
        const places = await data(response);
        const place = places.find(
          (item) =>
            item.kind === kind &&
            item.name.toLowerCase().includes(query.toLowerCase()),
        );
        assert.ok(
          place,
          `${kind} ${query} absent from actual provider dataset`,
        );
        assert.equal(place.provenance, 'OSM_LOCAL_BOUNDED_INDEX');
        assert.equal(place.dataset_version_id, manifest.dataset_version_id);
        const source = index.entries.find(
          (entry) => entry.externalId === place.external_id,
        );
        assert.ok(source, 'Place absent from checksummed source');
        assert.equal(place.latitude, source.latitude);
        assert.equal(place.longitude, source.longitude);
        await page
          .getByRole('option')
          .filter({ hasText: place.external_id })
          .click();
        return place;
      }
      step('current-gps-simulated');
      await page.goto(web, { waitUntil: 'domcontentloaded' });
      await page
        .getByRole('button', { name: 'Find journeys', exact: true })
        .click({ trial: true });
      const snapshot = (await read('config')).network_snapshot_id;
      result.snapshot = snapshot;
      await page
        .getByRole('group', { name: 'From input method', exact: true })
        .getByRole('button', { name: 'Current', exact: true })
        .click();
      await page
        .getByText('Fresh accurate device location ready.', { exact: true })
        .waitFor();
      await shot('current-simulated');
      step('address-poi');
      await page
        .getByRole('group', { name: 'From input method', exact: true })
        .getByRole('button', { name: 'Place', exact: true })
        .click();
      const origin = await choose('From', 'Mall Kelapa Gading', 'ADDRESS');
      const destination = await choose('To', 'Emporium', 'POI');
      result.places = { origin, destination };
      await page
        .getByLabel('Depart (Jakarta time)', { exact: true })
        .fill('2026-10-02T08:11');
      let rows;
      for (const preference of [
        'BALANCED',
        'FASTEST',
        'LEAST_WALKING',
        'FEWEST_TRANSFERS',
      ]) {
        step(`preference-${preference}`);
        const pending = wait('journeys/plan');
        const action =
          preference === 'BALANCED'
            ? page
                .getByRole('button', { name: 'Find journeys', exact: true })
                .click()
            : page
                .getByRole('combobox', { name: /^Rank by/ })
                .selectOption(preference); // Native preference control replans; no duplicate POST.
        const [, response] = await Promise.all([action, pending]);
        const payload = response.request().postDataJSON();
        assert.equal(payload.preference, preference);
        assert.equal(payload.network_snapshot_id, snapshot);
        assert.equal(payload.departure_at, '2026-10-02T08:11:00+07:00');
        assert.deepEqual(payload.origin, {
          latitude: origin.latitude,
          longitude: origin.longitude,
        });
        assert.deepEqual(payload.destination, {
          latitude: destination.latitude,
          longitude: destination.longitude,
        });
        const envelope = await response.json();
        assert.ok(
          response.ok(),
          `${preference} provider/dataset HTTP ${response.status()}: ${JSON.stringify(envelope.error)}`,
        );
        assert.equal(envelope.meta.provenance.evidence_type, 'SCHEDULED');
        rows = envelope.data;
        assert.ok(
          rows.length,
          `${preference}: provider dataset returned no routes; NOT TESTED downstream`,
        );
        for (const row of rows) {
          assert.equal(row.routing_context.provider, 'OTP');
          assert.equal(row.routing_context.common_service_date, '2026-10-02');
          assert.match(row.routing_context.graph_sha256, /^[a-f0-9]{64}$/);
          assert.ok(
            row.segments.every((leg) => leg.geometry?.coordinates.length >= 2),
          );
        }
        result.preferences.push({
          preference,
          request: payload,
          request_id: envelope.meta.request_id,
          response_sha256: sha256(JSON.stringify(rows)),
          journeys: rows,
        });
        await page
          .getByRole('region', { name: 'Journey choices' })
          .getByRole('button')
          .first()
          .waitFor();
      }
      const selected = rows.find((row) => {
        const transit = row.segments.filter((leg) => leg.mode !== 'WALK');
        return (
          transit.length >= 2 &&
          transit
            .at(-1)
            .entity_bindings.some(
              (binding) =>
                binding.entity_type === 'ROUTE' && binding.mobility_entity_id,
            )
        );
      });
      assert.ok(
        selected,
        'Actual OTP dataset lacks transit-prefix/future-route recovery corridor; downstream NOT TESTED',
      );
      result.actual_modes = [
        ...new Set(selected.segments.map((leg) => leg.mode)),
      ];
      await page
        .getByRole('region', { name: 'Journey choices' })
        .getByRole('button')
        .nth(rows.indexOf(selected))
        .click();
      await shot('choices');
      let active = await mutation(
        'Mulai Perjalanan',
        `journeys/${selected.journey_id}/activate`,
      );
      const firstId = active.journey_id;
      result.active_journey_id = firstId;
      assert.deepEqual(active.segments, selected.segments);
      async function parity() {
        await page.locator('.navigation-card').waitFor();
        const current =
          active.segments[active.progress.completed_segment_count];
        if (current?.mode === 'WALK')
          assert.equal(
            await page
              .locator('.navigation-card')
              .getAttribute('data-navigation-scope'),
            navigationScopeKey(firstId, active.accepted_recovery_id, current),
          );
        assert.deepEqual(
          await page
            .locator('.leg-list li')
            .evaluateAll((nodes) =>
              nodes.map((node) => node.getAttribute('data-leg-fingerprint')),
            ),
          active.segments.map(walkGeometryIdentity),
        );
        await page.waitForFunction(
          (count) =>
            Number(
              document
                .querySelector('.maplibre-frame')
                ?.getAttribute('data-route-source-count'),
            ) === count,
          active.segments.length,
        );
      }
      async function advance() {
        const leg = active.segments[active.progress.completed_segment_count];
        assert.ok(leg);
        const time = page.getByLabel('Progress time (Jakarta, controlled)', {
          exact: true,
        });
        const at = (value) =>
          jakarta(
            new Date(
              Math.max(
                Date.parse(value),
                Date.parse(active.progress.recorded_at),
              ),
            ).toISOString(),
          );
        if (leg.mode !== 'WALK') {
          await time.fill(at(leg.start_at));
          active = await mutation(
            'Saya Sudah Naik',
            `journeys/${firstId}/boarding/${leg.sequence}`,
          );
          assert.equal(
            active.progress.boarding_confirmed_segment_sequence,
            leg.sequence,
          );
          await time.fill(at(leg.end_at));
          active = await mutation(
            'Saya Sudah Turun',
            `journeys/${firstId}/alighting/${leg.sequence}`,
          );
          assert.equal(
            active.progress.alighting_confirmed_segment_sequence,
            leg.sequence,
          );
        }
        await time.fill(
          at(active.segments[leg.sequence + 1]?.start_at ?? leg.end_at),
        );
        active = await mutation(
          leg.sequence + 1 < active.segments.length
            ? 'Lanjutkan Perjalanan'
            : 'Selesaikan Perjalanan',
          `journeys/${firstId}/progress`,
          'PATCH',
        );
        assert.equal(active.progress.completed_segment_count, leg.sequence + 1);
        result.progress.push({
          mode: leg.mode,
          sequence: leg.sequence,
          progress: active.progress,
        });
      }
      step('navigation-boarding-alighting');
      await parity();
      const firstTransit = active.segments.find((leg) => leg.mode !== 'WALK');
      while (active.progress.completed_segment_count <= firstTransit.sequence)
        await advance();
      await shot('progress');
      const target = active.segments
        .slice(active.progress.completed_segment_count)
        .find(
          (leg) =>
            leg.mode !== 'WALK' &&
            leg.entity_bindings.some(
              (binding) =>
                binding.entity_type === 'ROUTE' && binding.mobility_entity_id,
            ),
        );
      assert.ok(target, 'No remaining actual route target');
      const binding = target.entity_bindings.find(
        (item) => item.entity_type === 'ROUTE' && item.mobility_entity_id,
      );
      step('report-unverified');
      await page
        .getByLabel('Lokasi atau layanan pada sisa perjalanan')
        .selectOption(`${binding.mobility_entity_id}:ROUTE`);
      await page
        .getByLabel('Waktu kejadian (WIB)')
        .fill(jakarta(new Date(Date.now() - 60000).toISOString()));
      await page
        .getByLabel('Keterangan', { exact: true })
        .fill(`COMBINED SIMULATED ${randomUUID()}`);
      const report = await mutation('Kirim laporan', 'passenger-reports');
      reportId = report.report_id;
      assert.equal(report.verification_status, 'REPORTED_UNVERIFIED');
      result.report = report;
      step('controlled-simulated-review');
      const verified = await controlled('verify', {
        operational_state: 'UNAVAILABLE',
        incident_type: 'SERVICE_SUSPENSION',
        reason: 'COMBINED controlled SIMULATED review',
      });
      reviewed = true;
      assert.equal(verified.verification_status, 'CONTROLLED_VERIFIED');
      await page
        .getByRole('article', { name: 'Targeted journey alert', exact: true })
        .first()
        .waitFor();
      const alerts = await read(`journeys/${firstId}/alerts`);
      assert.ok(
        alerts.some(
          (alert) =>
            alert.mobility_entity_id === binding.mobility_entity_id &&
            alert.evidence_type === 'SIMULATED',
        ),
      );
      result.alerts = alerts;
      await shot('simulated-alert');
      step('real-otp-recovery');
      const recovery = await mutation('Find another way', 'recoveries');
      result.recovery = recovery;
      assert.equal(
        recovery.status,
        'COMPLETED',
        'Provider dataset produced no recovery; acceptance/continuation NOT TESTED',
      );
      assert.equal(recovery.proposed_journey.routing_context.provider, 'OTP');
      const drawer = page.getByRole('region', {
        name: 'Grounded copilot',
        exact: true,
      });
      await drawer
        .getByLabel('Question', { exact: true })
        .fill('Explain this recovery and its changed route.');
      const copilotPending = wait('copilot/messages');
      const [, copilotResponse] = await Promise.all([
        drawer
          .getByRole('button', { name: 'Ask grounded copilot', exact: true })
          .click(),
        copilotPending,
      ]);
      const copilot = await data(copilotResponse);
      result.copilot = {
        submitted: copilotResponse.request().postDataJSON(),
        response: copilot,
      };
      assert.ok(
        result.copilot.submitted.context_references.includes(
          `recovery:${recovery.recovery_id}`,
        ),
        'Copilot recovery context missing',
      );
      assert.ok(copilot.answer);
      step('copilot-owned-persisted-session');
      const sessionResponse = await context.request.get(
        `${web}/api/passenger/copilot/sessions/${copilot.session_id}`,
      );
      const sessionEnvelope = await sessionResponse.json();
      assert.equal(sessionResponse.status(), 200);
      assert.ok(sessionEnvelope.meta.request_id);
      const session = sessionEnvelope.data;
      assert.equal(session.session_id, copilot.session_id);
      assert.equal(session.history_limit, 100);
      const saved = session.messages.find(
        (message) => message.message_id === copilot.message_id,
      );
      assert.ok(
        saved,
        'Submitted copilot message missing from owned persisted session',
      );
      assert.match(saved.request_digest, /^[a-f0-9]{64}$/);
      for (const field of [
        'answer',
        'evidence_type',
        'evidence_references',
        'tool_result_references',
        'fallback_status',
      ])
        assert.deepEqual(saved[field], copilot[field]);
      assert.ok(
        saved.tool_audit.length,
        'Persisted grounded tool audit missing',
      );
      result.copilot.session = sessionEnvelope;
      const foreignContext = await browser.newContext({
        ignoreHTTPSErrors: true,
      });
      try {
        const denied = await foreignContext.request.get(
          `${web}/api/passenger/copilot/sessions/${copilot.session_id}`,
        );
        const deniedEnvelope = await denied.json();
        assert.equal(denied.status(), 404);
        assert.equal(deniedEnvelope.error.code, 'NOT_FOUND');
        assert.ok(deniedEnvelope.error.request_id);
        assert.equal(deniedEnvelope.data, undefined);
        result.copilot.cross_context = {
          status: denied.status(),
          response: deniedEnvelope,
        };
      } finally {
        await foreignContext.close();
      }
      step('accept-recovery');
      result.acceptance = await mutation(
        'Use this repaired route',
        `recoveries/${recovery.recovery_id}/accept`,
      );
      active = await read(`journeys/${firstId}`);
      assert.equal(active.accepted_recovery_id, recovery.recovery_id);
      assert.deepEqual(active.original_plan, selected);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page
        .getByText('Recovery accepted', { exact: false })
        .first()
        .waitFor();
      await parity();
      await shot('accepted-reloaded');
      step('complete-reload');
      for (let count = 0; active.status !== 'COMPLETED'; count++) {
        assert.ok(count < 50);
        await advance();
      }
      const completed = await read(`journeys/${firstId}`);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page
        .getByText('perjalanan ini sudah selesai.', { exact: false })
        .waitFor();
      assert.deepEqual(await read(`journeys/${firstId}`), completed);
      result.completed = completed;
      await shot('completed-reloaded');
      // Close controlled impact before second genuine journey; same signed owner.
      await controlled('close', {
        decision: 'RESOLVED',
        reason: 'COMBINED SIMULATED scenario complete',
      });
      reviewed = false;
      step('second-journey-no-leakage');
      await choose('From', 'Mall Kelapa Gading', 'ADDRESS');
      await choose('To', 'Emporium', 'POI');
      await page
        .getByLabel('Depart (Jakarta time)', { exact: true })
        .fill('2026-10-02T08:21');
      const secondRows = await mutation('Find journeys', 'journeys/plan');
      assert.ok(secondRows.length);
      const second = await mutation(
        'Mulai Perjalanan',
        `journeys/${secondRows[0].journey_id}/activate`,
      );
      assert.notEqual(second.journey_id, firstId);
      assert.equal(second.accepted_recovery_id, null);
      assert.equal(second.progress.completed_segment_count, 0);
      assert.deepEqual(
        await read(`passenger-reports?active_journey_id=${second.journey_id}`),
        [],
      );
      assert.deepEqual(await read(`journeys/${second.journey_id}/alerts`), []);
      assert.deepEqual(await read(`journeys/${firstId}`), completed);
      assert.equal(
        await page
          .getByRole('heading', { name: 'Recovery option', exact: true })
          .count(),
        0,
      );
      result.second_journey = second;
      await shot('second-journey');
      result.status = 'PASS';
    } catch (error) {
      result.error = safe(error.message);
      summary.defects.push({
        stage,
        status: 'OPEN / NOT VERIFIED',
        error: result.error,
      });
      summary.error = result.error;
      summary.failed_stage = stage;
      result.page_url = page?.url();
      result.page_text = await page
        ?.locator('body')
        .innerText({ timeout: 5000 })
        .then(safe)
        .catch(() => null);
      await persist();
      throw error;
    } finally {
      if (reviewed)
        await controlled('close', {
          decision: 'RESOLVED',
          reason: 'COMBINED finally SIMULATED cleanup',
        }).catch((error) =>
          summary.defects.push({
            stage: 'cleanup',
            error: safe(error.message),
          }),
        );
      if (result.status !== 'PASS')
        await page
          ?.screenshot({
            path: join(dir, `combined-${width}-failure.png`),
            fullPage: true,
          })
          .catch((error) =>
            summary.defects.push({
              stage: 'failure-screenshot',
              error: safe(error.message),
            }),
          );
      await context.tracing
        .stop({ path: join(dir, `combined-${width}-trace.zip`) })
        .catch((error) =>
          summary.defects.push({
            stage: 'trace-stop',
            error: safe(error.message),
          }),
        );
      await context.close().catch((error) =>
        summary.defects.push({
          stage: 'context-close',
          error: safe(error.message),
        }),
      );
      await persist();
    }
  }
  summary.status = 'PASS';
} catch (error) {
  summary.error = safe(error.message);
  summary.failed_stage = stage;
  process.exitCode = 1;
} finally {
  try {
    await browser.close();
  } finally {
    await persist();
  }
}
console.log(JSON.stringify(summary));
