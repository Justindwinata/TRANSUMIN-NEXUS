import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

type Context = { params: Promise<{ path: string[] }> };

const allowed = [
  /^transit\/places$/,
  /^journeys\/plan$/,
  /^journeys\/[0-9a-f-]{36}(?:\/(?:activate|progress|status|alerts(?:\/stream)?|boarding\/\d+|alighting\/\d+))?$/i,
  /^recoveries(?:\/[0-9a-f-]{36})?$/i,
];

const SESSION_COOKIE = 'transumin_proto_session';
const OWNER_PATTERN = /^passenger:[0-9a-f-]{36}$/;
const SESSION_TTL_SECONDS = 60 * 60 * 12;

function sessionSecret(): string | null {
  const secret = process.env.PASSENGER_SESSION_SECRET;
  if (!secret || secret.length < 32) return null;
  return secret;
}

/** ponytail: prototype session identity, not production authentication. */
function sign(owner: string, secret: string): string {
  return createHmac('sha256', secret).update(owner).digest('base64url');
}

function verify(token: string, owner: string, secret: string): boolean {
  const expected = sign(owner, secret);
  const a = Buffer.from(expected);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Server-derived identity. The browser never supplies the owner value:
 * a first visitor gets a minted HttpOnly cookie; later requests reuse the
 * signed cookie. Fail-closed when PASSENGER_SESSION_SECRET is absent.
 */
function isStreamResource(resource: string): boolean {
  return resource.endsWith('/alerts/stream');
}

function ownerFor(
  request: NextRequest,
  secret: string,
): { owner: string; mintNew: boolean } {
  const cookieValue = request.cookies.get(SESSION_COOKIE)?.value;
  if (cookieValue) {
    const separator = cookieValue.lastIndexOf('.');
    if (
      separator > 0
      && verify(cookieValue.slice(separator + 1), cookieValue.slice(0, separator), secret)
      && OWNER_PATTERN.test(cookieValue.slice(0, separator))
    )
      return { owner: cookieValue.slice(0, separator), mintNew: false };
    return { owner: '', mintNew: false }; // invalid cookie: refuse
  }
  return { owner: `passenger:${randomUUID()}`, mintNew: true };
}


async function forward(request: NextRequest, context: Context) {
  const { path } = await context.params;
  const resource = path.join('/');
  if (!allowed.some((pattern) => pattern.test(resource))) {
    return NextResponse.json(
      { error: { code: 'NOT_FOUND', message: 'Unknown passenger resource.' } },
      { status: 404 },
    );
  }
  const secret = sessionSecret();
  if (!secret) {
    return NextResponse.json(
      {
        error: {
          code: 'OWNER_IDENTITY_UNAVAILABLE',
          message:
            'Passenger session identity is unavailable; set PASSENGER_SESSION_SECRET.',
        },
      },
      { status: 503 },
    );
  }
  const { owner, mintNew } = ownerFor(request, secret);
  if (!owner) {
    return NextResponse.json(
      { error: { code: 'INVALID_SESSION', message: 'Session is invalid.' } },
      { status: 403 },
    );
  }
  const secure = process.env.NODE_ENV === 'production';
  if (request.method !== 'GET' && !isStreamResource(resource)) {
    const site = request.headers.get('sec-fetch-site');
    if (site && site !== 'same-origin' && site !== 'none')
      return NextResponse.json(
        { error: { code: 'FORBIDDEN', message: 'Cross-site request denied.' } },
        { status: 403 },
      );
    const source = request.headers.get('origin') ?? request.headers.get('referer');
    const host = request.headers.get('host');
    if (!source || !host)
      return NextResponse.json(
        { error: { code: 'FORBIDDEN', message: 'Request origin is required.' } },
        { status: 403 },
      );
    try {
      const sourceUrl = new URL(source);
      const expectedProtocol = secure ? 'https:' : 'http:';
      if (sourceUrl.host !== host || sourceUrl.protocol !== expectedProtocol)
        return NextResponse.json(
          { error: { code: 'FORBIDDEN', message: 'Cross-site request denied.' } },
          { status: 403 },
        );
    } catch {
      return NextResponse.json(
        { error: { code: 'FORBIDDEN', message: 'Cross-site request denied.' } },
        { status: 403 },
      );
    }
  }
  const apiBase = (
    process.env.PASSENGER_API_BASE_URL ??
    process.env.NEXT_PUBLIC_API_BASE_URL ??
    'http://127.0.0.1:3001/api/v1'
  ).replace(/\/$/, '');
  const isStream = resource.endsWith('/alerts/stream');
  const timeoutMs =
    resource === 'recoveries' && request.method === 'POST' ? 120_000 : 30_000;
  const upstreamHeaders = new Headers();
  upstreamHeaders.set('accept', isStream ? 'text/event-stream' : 'application/json');
  upstreamHeaders.set('x-journey-owner', owner);
  const lastEventId = request.headers.get('last-event-id');
  if (isStream && lastEventId) upstreamHeaders.set('last-event-id', lastEventId);
  const key = request.headers.get('idempotency-key');
  if (key) upstreamHeaders.set('idempotency-key', key);
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
    upstreamHeaders.set('content-type', 'application/json');
  }
  try {
    const upstream = new URL(`${apiBase}/${resource}`);
    if (resource === 'transit/places') upstream.search = request.nextUrl.search;
    const response = await fetch(upstream, {
      method: request.method,
      headers: upstreamHeaders,
      body,
      cache: 'no-store',
      signal: isStream ? request.signal : AbortSignal.timeout(timeoutMs),
    });
      if (isStream && response.ok && response.body) {
        const streamed = new NextResponse(response.body, {
          status: response.status,
          headers: {
            'content-type': 'text/event-stream',
            'cache-control': 'no-cache, no-transform',
            'x-accel-buffering': 'no',
          },
        });
        if (mintNew)
          streamed.cookies.set(SESSION_COOKIE, `${owner}.${sign(owner, secret)}`, {
            httpOnly: true,
            secure,
            sameSite: 'strict',
            path: '/',
            maxAge: SESSION_TTL_SECONDS,
          });
        return streamed;
      }
    const responseHeaders = {
      'content-type':
        response.headers.get('content-type') ?? 'application/json',
      'cache-control': 'no-store',
    };
    const result = new NextResponse(await response.text(), {
      status: response.status,
      headers: responseHeaders,
    });
    if (mintNew)
      result.cookies.set(SESSION_COOKIE, `${owner}.${sign(owner, secret)}`, {
        httpOnly: true,
        secure,
        sameSite: 'strict',
        path: '/',
        maxAge: SESSION_TTL_SECONDS,
      });
    return result;
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
