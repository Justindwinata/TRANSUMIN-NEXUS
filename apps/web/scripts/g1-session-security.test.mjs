import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { registerHooks } from 'node:module';
import test, { afterEach, beforeEach } from 'node:test';
import { NextRequest } from 'next/server.js';

registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(
      specifier === 'next/server' ? 'next/server.js' : specifier,
      context,
    );
  },
});
const { GET, POST } =
  await import('../src/app/api/passenger/[...path]/route.ts');

const secret = 'g1-synthetic-session-secret-0123456789';
const obsoleteSecret = 'g1-obsolete-session-secret-012345';
const serviceToken = 'g1-synthetic-service-token-0123456789';
const journeyId = '00000000-0000-4000-8000-000000000001';
const ownerA = 'passenger:00000000-0000-4000-8000-00000000000a';
const ownerB = 'passenger:00000000-0000-4000-8000-00000000000b';
const apiBase = 'http://127.0.0.1:39871/api/v1';

const sign = (owner, expiresAt, key) =>
  createHmac('sha256', key).update(`${owner}.${expiresAt}`).digest('base64url');
const cookie = (
  owner,
  expiresAt = Math.floor(Date.now() / 1000) + 3600,
  key = secret,
) => `${owner}.${expiresAt}.${sign(owner, expiresAt, key)}`;
const context = (path) => ({
  params: Promise.resolve({ path: path.split('/') }),
});
const request = (method, path, headers = {}, body) =>
  new NextRequest(`http://127.0.0.1/api/passenger/${path}`, {
    method,
    headers: { host: '127.0.0.1', ...headers },
    body,
  });

let originalFetch;
let originalEnv;
let upstreamCalls;

beforeEach(() => {
  originalEnv = Object.fromEntries(
    [
      'PASSENGER_SESSION_SECRET',
      'PASSENGER_SERVICE_TOKEN',
      'PASSENGER_API_BASE_URL',
      'NODE_ENV',
    ].map((name) => [name, process.env[name]]),
  );
  process.env.PASSENGER_SESSION_SECRET = secret;
  process.env.PASSENGER_SERVICE_TOKEN = serviceToken;
  process.env.PASSENGER_API_BASE_URL = apiBase;
  process.env.NODE_ENV = 'test';
  upstreamCalls = [];
  originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    upstreamCalls.push({ url: String(url), init });
    return new Response(JSON.stringify({ data: { accepted: true } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const [name, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

async function assertInvalidSession(value, method = 'GET') {
  const path =
    method === 'GET'
      ? `journeys/${journeyId}`
      : `journeys/${journeyId}/progress`;
  const response = await (method === 'GET' ? GET : POST)(
    request(
      method,
      path,
      {
        cookie: `transumin_proto_session=${value}`,
        ...(method === 'POST' ? { origin: 'http://127.0.0.1' } : {}),
      },
      method === 'POST' ? '{}' : undefined,
    ),
    context(path),
  );
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    error: { code: 'INVALID_SESSION', message: 'Session is invalid.' },
  });
  assert.equal(upstreamCalls.length, 0);
}

test('invalid signature fails closed before mutation reaches upstream', async () => {
  await assertInvalidSession(`${cookie(ownerA)}x`, 'POST');
});

test('obsolete-secret cookie fails closed before upstream fetch', async () => {
  await assertInvalidSession(
    cookie(ownerA, Math.floor(Date.now() / 1000) + 3600, obsoleteSecret),
  );
});

test('expired signed cookie fails closed before upstream fetch', async () => {
  await assertInvalidSession(cookie(ownerA, Math.floor(Date.now() / 1000) - 1));
});

test('malformed expiry fails closed before upstream fetch', async () => {
  await assertInvalidSession(`${ownerA}.NaN.signature`);
});

test('tampered expiry fails closed before mutation', async () => {
  const expiry = Math.floor(Date.now() / 1000) + 3600;
  await assertInvalidSession(
    `${ownerA}.${expiry + 1}.${sign(ownerA, expiry, secret)}`,
    'POST',
  );
});

test('old-format cookie fails closed before upstream fetch', async () => {
  const signature = createHmac('sha256', secret)
    .update(ownerA)
    .digest('base64url');
  await assertInvalidSession(`${ownerA}.${signature}`);
});

test('signed far-future expiry is rejected before protected mutation', async () => {
  await assertInvalidSession(
    cookie(ownerA, Math.floor(Date.now() / 1000) + 86400),
    'POST',
  );
});

test('changing owner without resigning fails closed', async () => {
  await assertInvalidSession(cookie(ownerA).replace(ownerA, ownerB), 'POST');
});

test('valid session derives upstream owner and ignores spoofed owner header', async () => {
  const response = await GET(
    request('GET', `journeys/${journeyId}`, {
      cookie: `transumin_proto_session=${cookie(ownerB)}`,
      'x-journey-owner': ownerA,
    }),
    context(`journeys/${journeyId}`),
  );
  assert.equal(response.status, 200);
  assert.equal(upstreamCalls.length, 1);
  assert.equal(upstreamCalls[0].init.headers.get('x-journey-owner'), ownerB);
  assert.notEqual(upstreamCalls[0].init.headers.get('x-journey-owner'), ownerA);
});
