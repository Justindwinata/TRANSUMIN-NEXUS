import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

type Context = { params: Promise<{ path: string[] }> };

const allowed = [
  /^transit\/places$/,
  /^journeys\/plan$/,
  /^journeys\/[0-9a-f-]{36}(?:\/(?:activate|progress|status|alerts(?:\/stream)?))?$/i,
  /^recoveries(?:\/[0-9a-f-]{36})?$/i,
];

async function forward(request: NextRequest, context: Context) {
  const { path } = await context.params;
  const resource = path.join('/');
  if (!allowed.some((pattern) => pattern.test(resource))) {
    return NextResponse.json(
      { error: { code: 'NOT_FOUND', message: 'Unknown passenger resource.' } },
      { status: 404 },
    );
  }
  const owner = request.headers.get('x-journey-owner');
  if (owner && !/^[A-Za-z0-9._:-]{1,128}$/.test(owner)) {
    return NextResponse.json(
      {
        error: {
          code: 'INVALID_PARAMETER',
          message: 'Invalid journey owner reference.',
        },
      },
      { status: 400 },
    );
  }
  const apiBase = (
    process.env.PASSENGER_API_BASE_URL ??
    process.env.NEXT_PUBLIC_API_BASE_URL ??
    'http://127.0.0.1:3001/api/v1'
  ).replace(/\/$/, '');
  const isStream = resource.endsWith('/alerts/stream');
  const timeoutMs =
    resource === 'recoveries' && request.method === 'POST' ? 120_000 : 30_000;
  const headers = new Headers();
  headers.set('accept', isStream ? 'text/event-stream' : 'application/json');
  if (owner) headers.set('x-journey-owner', owner);
  const lastEventId = request.headers.get('last-event-id');
  if (isStream && lastEventId) headers.set('last-event-id', lastEventId);
  const key = request.headers.get('idempotency-key');
  if (key) headers.set('idempotency-key', key);
  let body: string | undefined;
  if (request.method !== 'GET') {
    body = await request.text();
    if (body.length > 262_144) {
      return NextResponse.json(
        {
          error: {
            code: 'INVALID_PARAMETER',
            message: 'Request is too large.',
          },
        },
        { status: 413 },
      );
    }
    headers.set('content-type', 'application/json');
  }
  try {
    const upstream = new URL(`${apiBase}/${resource}`);
    if (resource === 'transit/places') upstream.search = request.nextUrl.search;
    const response = await fetch(upstream, {
      method: request.method,
      headers,
      body,
      cache: 'no-store',
      signal: isStream ? request.signal : AbortSignal.timeout(timeoutMs),
    });
    if (isStream && response.ok && response.body) {
      return new NextResponse(response.body, {
        status: response.status,
        headers: {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache, no-transform',
          'x-accel-buffering': 'no',
        },
      });
    }
    return new NextResponse(await response.text(), {
      status: response.status,
      headers: {
        'content-type':
          response.headers.get('content-type') ?? 'application/json',
        'cache-control': 'no-store',
      },
    });
  } catch {
    return NextResponse.json(
      {
        error: {
          code: 'ROUTER_UNAVAILABLE',
          message: 'Passenger service is temporarily unavailable.',
        },
      },
      { status: 503 },
    );
  }
}

export const GET = forward;
export const POST = forward;
export const PATCH = forward;
