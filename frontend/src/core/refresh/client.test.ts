/**
 * frontend/src/core/refresh/client.test.ts
 *
 * Test suite for client.
 * Covers key behaviors and edge cases for client.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { makeTelemetrySummary } from './refreshContractTestBuilders';

const mockGetSelectionDiagnostics = vi.fn(async () => ({}));
const mockGetKubernetesAPIClientDiagnostics = vi.fn(async () => []);
vi.mock('@core/backend-api', () => ({
  GetSelectionDiagnostics: mockGetSelectionDiagnostics,
  GetKubernetesAPIClientDiagnostics: mockGetKubernetesAPIClientDiagnostics,
}));

const originalFetch = globalThis.fetch;

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  mockGetSelectionDiagnostics.mockReset();
  mockGetKubernetesAPIClientDiagnostics.mockReset();
});

afterEach(async () => {
  vi.useRealTimers();

  if (originalFetch) {
    globalThis.fetch = originalFetch;
  } else {
    Reflect.deleteProperty(globalThis, 'fetch');
  }
});

describe('fetchSnapshot', () => {
  test('retries transient network failures with backoff and preserves request context', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new TypeError('Load failed'))
      .mockResolvedValueOnce({ status: 304 });
    globalThis.fetch = fetchMock;
    const { fetchSnapshot } = await import('./client');
    const controller = new AbortController();
    const request = fetchSnapshot('catalog', {
      scope: 'cluster-a|namespace:default',
      signal: controller.signal,
      ifNoneMatch: 'previous-version',
      correlationId: 'broker-read-10',
    });

    await vi.advanceTimersByTimeAsync(199);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(399);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    await expect(request).resolves.toEqual({ notModified: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const call of fetchMock.mock.calls) {
      expect(call).toEqual([
        '/api/v2/snapshots/catalog?scope=cluster-a%7Cnamespace%3Adefault',
        {
          signal: controller.signal,
          headers: {
            'X-Correlation-ID': 'broker-read-10',
            'If-None-Match': 'previous-version',
          },
        },
      ]);
    }
  });

  test('stops after three network attempts and preserves the final failure', async () => {
    vi.useFakeTimers();
    const failure = new TypeError('Failed to fetch');
    const fetchMock = vi.fn().mockRejectedValue(failure);
    globalThis.fetch = fetchMock;
    const { fetchSnapshot } = await import('./client');
    const outcome = fetchSnapshot('catalog').catch((error: unknown) => error);

    await vi.runAllTimersAsync();

    expect(await outcome).toBe(failure);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  test.each([
    { failure: new DOMException('Cancelled', 'AbortError'), aborted: false },
    { failure: new TypeError('Invalid request'), aborted: false },
    { failure: new TypeError('Failed to fetch'), aborted: true },
  ])('does not retry $failure when aborted=$aborted', async ({ failure, aborted }) => {
    const controller = new AbortController();
    if (aborted) {
      controller.abort();
    }
    const fetchMock = vi.fn().mockRejectedValue(failure);
    globalThis.fetch = fetchMock;
    const { fetchSnapshot } = await import('./client');

    await expect(fetchSnapshot('catalog', { signal: controller.signal })).rejects.toBe(failure);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('cancels manual job polling without reading a snapshot or leaving timers', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ jobId: 'job-1', state: 'running' }),
    });
    globalThis.fetch = fetchMock;
    const { fetchSnapshot } = await import('./client');
    const controller = new AbortController();
    const outcome = fetchSnapshot('object-details', {
      scope: 'cluster-a|object',
      manual: true,
      signal: controller.signal,
      correlationId: 'broker-read-11',
    }).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    controller.abort();

    expect(await outcome).toMatchObject({ name: 'AbortError' });
    expect(vi.getTimerCount()).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [, init] of fetchMock.mock.calls) {
      expect(init.signal.aborted).toBe(true);
      expect(init.headers['X-Correlation-ID']).toBe('broker-read-11');
    }
  });

  test('manual refresh carries correlation through the job and ignores the previous etag', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ jobId: 'job-1', state: 'queued' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ jobId: 'job-1', state: 'succeeded' }),
      })
      .mockResolvedValueOnce({ status: 304 });
    globalThis.fetch = fetchMock;
    const { fetchSnapshot } = await import('./client');

    await fetchSnapshot('object-details', {
      scope: 'cluster-a|object',
      manual: true,
      correlationId: 'broker-read-12',
      ifNoneMatch: 'old-version',
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const [, init] of fetchMock.mock.calls) {
      expect(init.headers['X-Correlation-ID']).toBe('broker-read-12');
      expect(init.headers['If-None-Match']).toBeUndefined();
    }
  });

  test('fetches snapshot data with scope and conditional headers', async () => {
    const responseBody = {
      domain: 'namespace-workloads',
      version: 2,
      checksum: 'abc123',
      generatedAt: 1700000000000,
      sequence: 5,
      payload: { items: ['pod-a'] },
      stats: { itemCount: 1, buildDurationMs: 12 },
    };

    const headers = new Headers({ ETag: 'W/"abc123"' });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue(responseBody),
      headers,
    });

    globalThis.fetch = fetchMock;
    const { fetchSnapshot } = await import('./client');

    const controller = new AbortController();
    const result = await fetchSnapshot<typeof responseBody.payload>('namespace-workloads', {
      scope: 'team-a',
      ifNoneMatch: 'etag-old',
      signal: controller.signal,
      correlationId: 'broker-read-9',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/v2/snapshots/namespace-workloads?scope=team-a');
    expect(init).toEqual({
      signal: controller.signal,
      headers: {
        'If-None-Match': 'etag-old',
        'X-Correlation-ID': 'broker-read-9',
      },
    });

    expect(result).toEqual({
      snapshot: responseBody,
      etag: 'W/"abc123"',
      notModified: false,
    });
  });

  test('manual refresh waits for the uncached backend job before reading the snapshot', async () => {
    const snapshot = {
      domain: 'object-details',
      version: 2,
      checksum: 'fresh',
      generatedAt: 1700000000000,
      sequence: 2,
      payload: { details: { name: 'pod-a' } },
      stats: { itemCount: 1, buildDurationMs: 1 },
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 202,
        json: vi.fn().mockResolvedValue({ jobId: 'job-1', state: 'queued' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ jobId: 'job-1', state: 'succeeded' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue(snapshot),
        headers: new Headers({ ETag: 'fresh' }),
      });
    globalThis.fetch = fetchMock;
    const { fetchSnapshot } = await import('./client');

    await expect(
      fetchSnapshot('object-details', { scope: 'cluster-a|object', manual: true })
    ).resolves.toMatchObject({ snapshot, notModified: false });

    expect(fetchMock.mock.calls[0]).toEqual([
      '/api/v2/refresh/object-details',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ scope: 'cluster-a|object', reason: 'user' }),
      }),
    ]);
    expect(fetchMock.mock.calls[1][0]).toBe('/api/v2/jobs/job-1');
    expect(fetchMock.mock.calls[2][0]).toBe(
      '/api/v2/snapshots/object-details?scope=cluster-a%7Cobject'
    );
  });

  test('manual refresh stops when the backend job is cancelled', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 202,
        json: vi.fn().mockResolvedValue({ jobId: 'job-1', state: 'queued' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          jobId: 'job-1',
          state: 'cancelled',
          error: 'cluster closed',
        }),
      });
    globalThis.fetch = fetchMock;
    const { fetchSnapshot } = await import('./client');

    await expect(
      fetchSnapshot('object-details', { scope: 'cluster-a|object', manual: true })
    ).rejects.toThrow('cluster closed');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('manual refresh times out with bounded backoff when a job never finishes', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ jobId: 'job-1', state: 'running' }),
    });
    globalThis.fetch = fetchMock;
    const { fetchSnapshot } = await import('./client');

    let outcome: unknown;
    void fetchSnapshot('object-details', {
      scope: 'cluster-a|object',
      manual: true,
    }).then(
      (value) => {
        outcome = value;
      },
      (error) => {
        outcome = error;
      }
    );

    await vi.advanceTimersByTimeAsync(60_000);

    expect(outcome).toEqual(
      new Error('Manual refresh timed out after 60 seconds for object-details')
    );
    expect(fetchMock.mock.calls.length).toBeLessThan(100);
  });

  test('rejects a successful response without a snapshot payload', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        domain: 'catalog',
        version: 1,
        checksum: 'abc123',
        generatedAt: 1700000000000,
        sequence: 1,
        stats: { itemCount: 0, buildDurationMs: 1 },
      }),
      headers: new Headers(),
    });

    const { fetchSnapshot } = await import('./client');

    await expect(fetchSnapshot('catalog')).rejects.toThrow(
      'Invalid refresh snapshot for catalog: missing payload'
    );
  });

  test('rejects a snapshot returned for a different domain', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        domain: 'nodes',
        version: 1,
        checksum: 'abc123',
        generatedAt: 1700000000000,
        sequence: 1,
        payload: {},
        stats: { itemCount: 0, buildDurationMs: 1 },
      }),
      headers: new Headers(),
    });

    const { fetchSnapshot } = await import('./client');

    await expect(fetchSnapshot('catalog')).rejects.toThrow(
      'Invalid refresh snapshot for catalog: received domain nodes'
    );
  });

  test('returns notModified when server responds with 304', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 304,
      statusText: 'Not Modified',
      json: vi.fn(),
      headers: new Headers(),
    });

    globalThis.fetch = fetchMock;
    const { fetchSnapshot } = await import('./client');

    const result = await fetchSnapshot('catalog');
    expect(result).toEqual({ notModified: true });

    const [, init] = fetchMock.mock.calls[0];
    expect(init?.headers).toBeUndefined();
  });

  test('throws parsed message when snapshot request fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: vi.fn().mockResolvedValue({ message: 'catalog sync failed' }),
      headers: new Headers(),
    });

    globalThis.fetch = fetchMock;
    const { fetchSnapshot } = await import('./client');

    await expect(fetchSnapshot('catalog')).rejects.toThrow('catalog sync failed');
  });

  test('throws formatted permission denied message when status payload returned', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
      json: vi.fn().mockResolvedValue({
        kind: 'Status',
        apiVersion: 'v1',
        message: 'permission denied for domain nodes (core/nodes)',
        reason: 'Forbidden',
        details: { domain: 'nodes', resource: 'core/nodes' },
        code: 403,
      }),
      headers: new Headers(),
    });

    globalThis.fetch = fetchMock;
    const { fetchSnapshot, SnapshotPermissionDeniedError } = await import('./client');

    // Typed, not just a message: the orchestrator marks the scope
    // permissionDenied structurally so it can stop background retries
    // (permission is checked ONCE per session — restart to recover).
    const error = await fetchSnapshot('nodes').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SnapshotPermissionDeniedError);
    expect((error as Error).message).toBe('permission denied for domain nodes (core/nodes)');
  });

  test('falls back to status text when error body cannot be parsed', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      statusText: 'Bad Gateway',
      json: vi.fn().mockRejectedValue(new Error('broken json')),
      headers: new Headers(),
    });

    globalThis.fetch = fetchMock;
    const { fetchSnapshot } = await import('./client');

    await expect(fetchSnapshot('catalog')).rejects.toThrow(
      'Snapshot request failed: 502 Bad Gateway'
    );
  });
});

describe('fetchTelemetrySummary', () => {
  test('returns parsed telemetry summary payload', async () => {
    const summary = makeTelemetrySummary({
      metrics: {
        lastCollected: 1,
        lastDurationMs: 2,
        consecutiveFailures: 0,
        successCount: 10,
        failureCount: 1,
        active: true,
      },
      connection: {
        retryAttempts: 0,
        retrySuccesses: 0,
        retryExhausted: 0,
        transportRebuilds: 0,
      },
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: vi.fn().mockResolvedValue(summary),
      headers: new Headers(),
    });

    globalThis.fetch = fetchMock;
    const { fetchTelemetrySummary } = await import('./client');

    await expect(fetchTelemetrySummary()).resolves.toEqual(summary);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/v2/telemetry/summary');
    expect(init).toBeUndefined();
  });

  test('rejects a successful response that does not match the telemetry contract', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: vi.fn().mockResolvedValue({ refreshCount: 10 }),
      headers: new Headers(),
    });

    const { fetchTelemetrySummary } = await import('./client');

    await expect(fetchTelemetrySummary()).rejects.toThrow(
      'Invalid telemetry summary: missing snapshots'
    );
  });

  test('rejects nested telemetry fields that do not match the backend DTO', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: vi.fn().mockResolvedValue({
        snapshots: [
          {
            domain: 42,
            lastStatus: 'success',
            lastDurationMs: 1,
            lastUpdated: 2,
            successCount: 1,
            failureCount: 0,
          },
        ],
        metrics: {
          lastCollected: 1,
          lastDurationMs: 2,
          consecutiveFailures: 0,
          successCount: 1,
          failureCount: 0,
          active: true,
        },
        streams: [],
        connection: {
          retryAttempts: 0,
          retrySuccesses: 0,
          retryExhausted: 0,
          transportRebuilds: 0,
        },
      }),
      headers: new Headers(),
    });

    const { fetchTelemetrySummary } = await import('./client');

    await expect(fetchTelemetrySummary()).rejects.toThrow(
      'Invalid telemetry summary: invalid snapshots[0].domain'
    );
  });

  test('normalizes nullable telemetry collections for frontend consumers', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: vi.fn().mockResolvedValue({
        snapshots: null,
        metrics: {
          lastCollected: 0,
          lastDurationMs: 0,
          consecutiveFailures: 0,
          successCount: 0,
          failureCount: 0,
          active: false,
        },
        streams: null,
        connection: {
          retryAttempts: 0,
          retrySuccesses: 0,
          retryExhausted: 0,
          transportRebuilds: 0,
        },
      }),
      headers: new Headers(),
    });

    const { fetchTelemetrySummary } = await import('./client');

    await expect(fetchTelemetrySummary()).resolves.toMatchObject({ snapshots: [], streams: [] });
  });

  test('throws when telemetry request fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
      json: vi.fn(),
      headers: new Headers(),
    });

    globalThis.fetch = fetchMock;
    const { fetchTelemetrySummary } = await import('./client');

    await expect(fetchTelemetrySummary()).rejects.toThrow(
      'Telemetry request failed: 503 Service Unavailable'
    );
  });
});
