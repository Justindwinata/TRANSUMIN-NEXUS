// R1-C S09 negative recovery acceptance: application-level NO_VALID_ALTERNATIVE.
// Real UI search + real OTP planning + controlled SIMULATED disruption of every remaining
// dependency (ROUTE/STOP/STATION are all legitimate passenger report targets). No fabricated
// OTP response: a route rejected because it still uses a blocked dependency legitimately
// yields NO_PATH / NO_RECOVERY_PATH, never an invented alternative.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const web = process.env.S09_WEB_URL ?? 'http://127.0.0.1:3000';
const api = (process.env.S09_API_URL ?? 'http://127.0.0.1:3001/api/v1').replace(
  /\/$/,
  '',
);
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
const reviewer = `s09-${randomUUID()}`;
const incidentFor = {
  ROUTE: 'SERVICE_SUSPENSION',
  STOP: 'STOP_CLOSURE',
  STATION: 'STATION_CLOSURE',
};
const cases = [];
let browser, context, page, active, recovery, outcome;
const reports = [];
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
async function proxy(path, options = {}) {
  return jsonResponse(
    await context.request.fetch(`${web}/api/passenger/${path}`, {
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
async function controlled(reportId, action, payload) {
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
  const [response] = await Promise.all([
    page.waitForResponse(
      (candidate) =>
        candidate.url().endsWith(`/api/passenger/${suffix}`) &&
        candidate.request().method() === method,
      { timeout: 120_000 },
    ),
    page.getByRole('button', { name: button, exact: true }).first().click(),
  ]);
  return jsonResponse(response);
}
function jakarta(at) {
  return new Date(Date.parse(at) + 7 * 3600_000).toISOString().slice(0, 16);
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
  page = await context.newPage();

  await step('ui-demo-scenario-plan', async () => {
    await page.goto(web, { waitUntil: 'domcontentloaded' });
    const wait = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/passenger/journeys/plan') &&
        response.request().method() === 'POST',
      { timeout: 120_000 },
    );
    await page
      .getByRole('button', { name: /Load presentation scenario/ })
      .click();
    const list = ok(await jsonResponse(await wait));
    assert.ok(
      Array.isArray(list) && list.length > 0,
      'no OTP alternatives for Gambir → Pejaten',
    );
    for (const journey of list) {
      assert.equal(journey.routing_context.provider, 'OTP');
      assert.match(journey.routing_context.graph_sha256, /^[a-f0-9]{64}$/);
    }
    active = list[0];
    await page
      .getByRole('region', { name: 'Journey choices' })
      .getByRole('button')
      .first()
      .waitFor({ timeout: 120_000 });
    return `${list.length} real OTP alternatives; ${list[0].segments.length} legs`;
  });

  await step('activate-at-origin-anchor', async () => {
    await page
      .getByRole('region', { name: 'Journey choices' })
      .getByRole('button')
      .first()
      .click();
    active = ok(
      await uiMutation(
        'Mulai Perjalanan',
        `journeys/${active.journey_id}/activate`,
        'POST',
      ),
    );
    assert.equal(active.status, 'ACTIVE');
    assert.equal(active.progress.completed_segment_count, 0);
    return `anchor at origin; revision ${active.progress.revision}`;
  });

  // UI report dropdown is remainingReportTargets(active): bindings of active.segments only.
  // Alternatives bindings are not offered, so we only disrupt dependencies of the active
  // journey's remaining legs. Origin+destination stops are included to maximize blockage.
  const limited = [];
  const seen = new Set();
  const collect = (binding, segment) => {
    if (
      !binding.mobility_entity_id ||
      !['ROUTE', 'STOP', 'STATION'].includes(binding.entity_type)
    )
      return;
    const key = `${binding.mobility_entity_id}:${binding.entity_type}`;
    if (seen.has(key)) return;
    seen.add(key);
    limited.push({
      id: binding.mobility_entity_id,
      type: binding.entity_type,
      segment,
    });
  };
  for (const segment of active.segments.slice(
    active.progress.completed_segment_count,
  )) {
    if (segment.mode === 'WALK') continue;
    for (const binding of segment.entity_bindings.filter(
      (item) => item.entity_type === 'ROUTE',
    ))
      collect(binding, segment);
  }
  const remainingSegments = active.segments.slice(
    active.progress.completed_segment_count,
  );
  for (const segment of [remainingSegments[0], remainingSegments.at(-1)]) {
    if (segment)
      for (const binding of segment.entity_bindings.filter((item) =>
        ['STOP', 'STATION'].includes(item.entity_type),
      ))
        collect(binding, segment);
  }

  await step('ui-report-covering-dependencies', async () => {
    assert.ok(limited.length >= 1, 'no reportable remaining dependency');
    assert.ok(limited.length <= 8, 'refusing to exceed passenger rate limit');
    process.stderr.write(
      `[s09] target count=${limited.length} types=${limited.map((target) => target.type).join(',')}\n`,
    );
    const selector = page.getByLabel(
      'Lokasi atau layanan pada sisa perjalanan',
    );
    for (const target of limited) {
      const value = await selector
        .locator('option')
        .evaluateAll(
          (options, id) =>
            options.find((option) => option.value.includes(id))?.value,
          target.id,
        );
      assert.ok(value, `dependency ${target.id} not offered by the report UI`);
      await selector.selectOption(value);
      await page
        .getByLabel('Waktu kejadian (WIB)')
        .fill(jakarta(new Date(Date.now() - 60_000).toISOString()));
      await page
        .getByLabel('Keterangan')
        .fill(`R1 S09 SIMULATED ${target.type} ${randomUUID()}`);
      const report = ok(
        await uiMutation('Kirim laporan', 'passenger-reports', 'POST'),
      );
      assert.equal(report.verification_status, 'REPORTED_UNVERIFIED');
      reports.push({ ...target, reportId: report.report_id });
    }
    return `${reports.length} REPORTED_UNVERIFIED reports (${limited.map((t) => t.type).join(', ')})`;
  });

  await step('controlled-verify-covering-dependencies', async () => {
    for (const report of reports) {
      const review = ok(
        await controlled(report.reportId, 'verify', {
          operational_state: 'UNAVAILABLE',
          incident_type: incidentFor[report.type],
          reason: `R1 S09 ${report.reportId}`,
        }),
      );
      assert.equal(review.verification_status, 'CONTROLLED_VERIFIED');
      report.verified = true;
    }
    const alerts = ok(await proxy(`journeys/${active.journey_id}/alerts`));
    for (const report of reports) {
      const alert = alerts.find(
        (item) =>
          item.mobility_entity_id === report.id &&
          item.evidence_type === 'SIMULATED' &&
          !item.resolved_at,
      );
      assert.ok(alert, `no SIMULATED alert for ${report.type} ${report.id}`);
    }
    return `${reports.length} CONTROLLED_VERIFIED + targeted SIMULATED alerts`;
  });

  const recoveryResult = await uiMutation(
    'Find another way',
    'recoveries',
    'POST',
  );
  if (recoveryResult.status === 200 || recoveryResult.status === 201) {
    recovery = ok(recoveryResult);
    if (recovery.status === 'NO_PATH') {
      assert.equal(recovery.rejoin_status, 'NO_PATH');
      assert.equal(recovery.proposed_journey, null);
      assert.equal(recovery.metrics.recovery_success, false);
      outcome = 'NO_PATH_PROPOSAL';
      mark(
        'recovery-yields-no-invented-alternative',
        'PASS',
        'NO_PATH proposal with null proposed_journey',
      );
    } else {
      outcome = 'REAL_ALTERNATIVE';
      mark(
        'recovery-yields-no-invented-alternative',
        'NOT_VERIFIED',
        `live OTP returned a genuine ${recovery.status} alternative after selected reportable dependencies became UNAVAILABLE; engine-level NO_PATH not reproducible on this corridor`,
      );
    }
  } else if (recoveryResult.status === 422) {
    const code = recoveryResult.body?.error?.code;
    assert.equal(code, 'NO_RECOVERY_PATH', `unexpected error code ${code}`);
    assert.equal(
      recoveryResult.body?.error?.details?.recovery_code,
      'NO_RECOVERY_PATH',
    );
    outcome = 'NO_RECOVERY_PATH_422';
    mark(
      'recovery-yields-no-invented-alternative',
      'PASS',
      'application-level NO_RECOVERY_PATH; no alternative invented',
    );
  } else {
    throw new Error(
      `unexpected recovery HTTP ${recoveryResult.status}: ${JSON.stringify(recoveryResult.body?.error ?? recoveryResult.body)}`,
    );
  }

  // Skipped (not PASS) unless a real no-alternative proposal is on the screen.
  if (outcome === 'REAL_ALTERNATIVE') {
    await page.getByRole('heading', { name: 'Recovery option' }).waitFor();
    mark(
      'ui-indonesian-no-alternative-explanation',
      'NOT_VERIFIED',
      'genuine alternative exists; no no-alternative UI was exercised',
    );
  } else
    await step('ui-indonesian-no-alternative-explanation', async () => {
      await page
        .getByText(/Tidak ada rute pengganti yang aman/i)
        .first()
        .waitFor({ timeout: 30_000 });
      assert.equal(
        await page
          .getByRole('button', { name: 'Use this repaired route' })
          .count(),
        0,
      );
      assert.ok(
        await page.getByRole('button', { name: 'Find another way' }).count(),
        'retry control missing',
      );
      return 'Indonesian no-alternative explanation shown; retry available';
    });

  await step('journey-history-preserved-and-no-acceptance', async () => {
    const current = ok(await proxy(`journeys/${active.journey_id}`));
    assert.equal(current.status, 'ACTIVE');
    assert.equal(
      current.progress.completed_segment_count,
      0,
      'completed legs changed',
    );
    assert.equal(
      current.progress.revision,
      active.progress.revision,
      'revision mutated unexpectedly',
    );
    assert.equal(
      current.segments.length,
      active.segments.length,
      'journey structure changed',
    );
    if (outcome === 'NO_PATH_PROPOSAL') {
      const rejected = await proxy(
        `recoveries/${recovery.recovery_id}/accept`,
        {
          method: 'POST',
          headers: { 'idempotency-key': randomUUID() },
          data: { progress_revision: recovery.progress_revision },
        },
      );
      assert.equal(
        rejected.status,
        422,
        `NO_PATH proposal accepted: HTTP ${rejected.status}`,
      );
      assert.equal(
        rejected.body?.error?.details?.recovery_code,
        'RECOVERY_NOT_ACCEPTABLE',
      );
    }
    return 'ACTIVE, history intact, revision unchanged, no acceptance persisted';
  });
} catch (error) {
  failure = safe(error.message);
} finally {
  let closedAll = true;
  for (const report of reports.filter((item) => item.verified)) {
    try {
      const closed = ok(
        await controlled(report.reportId, 'close', {
          decision: 'RESOLVED',
          reason: `R1 S09 finally cleanup ${report.reportId}`,
        }),
      );
      assert.equal(closed.lifecycle_status, 'RESOLVED');
    } catch (error) {
      closedAll = false;
      mark('controlled-close-finally', 'FAIL', error.message);
    }
  }
  if (closedAll && reports.some((item) => item.verified))
    mark(
      'controlled-close-finally',
      'PASS',
      `${reports.filter((item) => item.verified).length} RESOLVED through controlled endpoint`,
    );
  await browser?.close().catch(() => {});
}
const failed = cases.filter((item) => item.verdict === 'FAIL');
const notVerified = cases.filter((item) => item.verdict === 'NOT_VERIFIED');
const status = failed.length
  ? 'FAIL'
  : failure || notVerified.length
    ? 'NOT_VERIFIED'
    : 'PASS';
console.log(
  JSON.stringify({
    status,
    outcome,
    cases,
    failure,
    evidence:
      'real UI demo-scenario search, real OTP planning, controlled SIMULATED UNAVAILABLE disruption of selected reportable dependencies; no SQL cleanup',
  }),
);
process.exitCode = status === 'PASS' ? 0 : 1;
