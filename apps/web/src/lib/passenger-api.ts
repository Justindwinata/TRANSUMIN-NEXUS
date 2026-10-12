import type {
  Journey,
  JourneyAlert,
  Recovery,
  TransitPlace,
} from './passenger';

type Envelope<T> = { data: T; meta?: unknown };

export class PassengerApiError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/passenger/${path}`, {
    ...options,
    cache: 'no-store',
    headers: {
      accept: 'application/json',
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = (
      body as { error?: { code?: string; message?: string } } | null
    )?.error;
    throw new PassengerApiError(
      error?.code ?? 'REQUEST_FAILED',
      error?.message ?? 'The service could not complete this request.',
      response.status,
    );
  }
  return (body as Envelope<T>).data;
}

export const passengerApi = {
  config: () => request<{ network_snapshot_id: string }>('config'),
  places: (query: string, snapshotId: string, signal?: AbortSignal) =>
    request<TransitPlace[]>(
      `transit/places?q=${encodeURIComponent(query)}&snapshot_id=${encodeURIComponent(snapshotId)}`,
      { signal },
    ),
  plan: (input: object) =>
    request<Journey[]>('journeys/plan', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  activate: (journey: Journey, owner: string, activatedAt?: string) =>
    request<Journey>(`journeys/${journey.journey_id}/activate`, {
      method: 'POST',
      headers: { 'x-journey-owner': owner },
      body: JSON.stringify({
        selected_journey: journey,
        ...(activatedAt ? { activated_at: activatedAt } : {}),
      }),
    }),
  getJourney: (id: string, owner: string) =>
    request<Journey>(`journeys/${id}`, {
      headers: { 'x-journey-owner': owner },
    }),
  progress: (
    id: string,
    owner: string,
    completed: number,
    total: number,
    recordedAt: string,
  ) =>
    request<Journey>(`journeys/${id}/progress`, {
      method: 'PATCH',
      headers: { 'x-journey-owner': owner },
      body: JSON.stringify({
        completed_segment_count: completed,
        current_segment_sequence: completed < total ? completed : null,
        recorded_at: recordedAt,
      }),
    }),
  alerts: (id: string, owner: string) =>
    request<JourneyAlert[]>(`journeys/${id}/alerts`, {
      headers: { 'x-journey-owner': owner },
    }),
  streamAlerts: async (
    id: string,
    owner: string,
    lastEventId: string | null,
    signal: AbortSignal,
    onEvent: (event: { id: string | null; type: string }) => void,
    onOpen: () => void,
  ): Promise<void> => {
    const response = await fetch(
      `/api/passenger/journeys/${id}/alerts/stream`,
      {
        headers: {
          accept: 'text/event-stream',
          'x-journey-owner': owner,
          ...(lastEventId ? { 'last-event-id': lastEventId } : {}),
        },
        cache: 'no-store',
        signal,
      },
    );
    if (!response.ok || !response.body)
      throw new PassengerApiError(
        'STREAM_UNAVAILABLE',
        'Live journey updates are temporarily unavailable.',
        response.status,
      );
    onOpen();
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder
          .decode(value, { stream: true })
          .replaceAll('\r\n', '\n');
        if (buffer.length > 65_536)
          throw new Error('Journey event exceeded its size limit.');
        let boundary = buffer.indexOf('\n\n');
        while (boundary >= 0) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const idLine = frame
            .split('\n')
            .find((line) => line.startsWith('id:'));
          const eventLine = frame
            .split('\n')
            .find((line) => line.startsWith('event:'));
          const data = frame
            .split('\n')
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).trimStart())
            .join('\n');
          if (data) {
            const payload = JSON.parse(data) as { type?: string };
            onEvent({
              id: idLine?.slice(3).trim() ?? null,
              type: eventLine?.slice(6).trim() ?? payload.type ?? 'message',
            });
          }
          boundary = buffer.indexOf('\n\n');
        }
      }
    } finally {
      reader.releaseLock();
    }
  },
  getRecovery: (id: string, owner: string) =>
    request<Recovery>(`recoveries/${id}`, {
      headers: { 'x-journey-owner': owner },
    }),
  recovery: (
    journeyId: string,
    impactId: string,
    owner: string,
    key: string,
    recoveryAt: string,
  ) =>
    request<Recovery>('recoveries', {
      method: 'POST',
      headers: { 'x-journey-owner': owner, 'idempotency-key': key },
      body: JSON.stringify({
        original_journey_id: journeyId,
        impact_id: impactId,
        recovery_at: recoveryAt,
      }),
    }),
};
