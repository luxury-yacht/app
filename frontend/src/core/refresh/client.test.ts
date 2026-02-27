/**
 * frontend/src/core/refresh/client.test.ts
 *
 * Test suite for client.
 * Covers key behaviors and edge cases for client.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mockGetBaseURL = vi.fn();
const mockGetSelectionDiagnostics = vi.fn(async () => ({}));
vi.mock('@wailsjs/go/backend/App', () => ({
  GetRefreshBaseURL: mockGetBaseURL,
  GetSelectionDiagnostics: mockGetSelectionDiagnostics,
}));

const originalFetch = globalThis.fetch;

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  mockGetBaseURL.mockReset();
  mockGetSelectionDiagnostics.mockReset();
});

afterEach(async () => {
  const { invalidateRefreshBaseURL } = await import('./client');
  invalidateRefreshBaseURL();

  if (originalFetch) {
    globalThis.fetch = originalFetch;
  } else {
    delete (globalThis as any).fetch;
  }
});

describe('refresh client readiness helpers', () => {
  test('ensureRefreshBaseURL caches after first resolution and respects invalidation', async () => {
    mockGetBaseURL.mockResolvedValue('http://127.0.0.1:0');

    const { ensureRefreshBaseURL, invalidateRefreshBaseURL } = await import('./client');

    const first = await ensureRefreshBaseURL();
    expect(first).toBe('http://127.0.0.1:0');
    expect(mockGetBaseURL).toHaveBeenCalledTimes(1);

    const second = await ensureRefreshBaseURL();
    expect(second).toBe('http://127.0.0.1:0');
    expect(mockGetBaseURL).toHaveBeenCalledTimes(1);

    invalidateRefreshBaseURL();
    const third = await ensureRefreshBaseURL();
    expect(third).toBe('http://127.0.0.1:0');
    expect(mockGetBaseURL).toHaveBeenCalledTimes(2);
  });

  test('ensureRefreshBaseURL clears cached promise after failure', async () => {
    mockGetBaseURL
      .mockRejectedValueOnce(new Error('fatal bootstrap failure'))
      .mockResolvedValue('http://127.0.0.1:0');

    const { ensureRefreshBaseURL } = await import('./client');

    await expect(ensureRefreshBaseURL()).rejects.toThrow('fatal bootstrap failure');
    await expect(ensureRefreshBaseURL()).resolves.toBe('http://127.0.0.1:0');
    expect(mockGetBaseURL).toHaveBeenCalledTimes(2);
  });

  test('ensureRefreshBaseURL retries when refresh subsystem is not initialised', async () => {
    vi.useFakeTimers();
    mockGetBaseURL
      .mockRejectedValueOnce(new Error('refresh subsystem not initialised'))
      .mockResolvedValue('http://127.0.0.1:0/');

    const { ensureRefreshBaseURL } = await import('./client');

    const urlPromise = ensureRefreshBaseURL();

    await vi.advanceTimersByTimeAsync(200);
    await expect(urlPromise).resolves.toBe('http://127.0.0.1:0');
    expect(mockGetBaseURL).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });
});

describe('fetchSnapshot', () => {
  test('fetches snapshot data with scope and conditional headers', async () => {
    mockGetBaseURL.mockResolvedValue('http://127.0.0.1:0/');

    const responseBody = {
      domain: 'namespace-workloads',
      version: 2,
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

    (globalThis as any).fetch = fetchMock;
    const { fetchSnapshot } = await import('./client');

    const controller = new AbortController();
    const result = await fetchSnapshot<typeof responseBody.payload>('namespace-workloads', {
      scope: 'team-a',
      ifNoneMatch: 'etag-old',
      signal: controller.signal,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:0/api/v2/snapshots/namespace-workloads?scope=team-a');
    expect(init).toEqual({
      signal: controller.signal,
      headers: { 'If-None-Match': 'etag-old' },
    });

    expect(result).toEqual({
      snapshot: responseBody,
      etag: 'W/"abc123"',
      notModified: false,
    });
  });

  test('returns notModified when server responds with 304', async () => {
    mockGetBaseURL.mockResolvedValue('http://127.0.0.1:0');

    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 304,
      statusText: 'Not Modified',
      json: vi.fn(),
      headers: new Headers(),
    });

    (globalThis as any).fetch = fetchMock;
    const { fetchSnapshot } = await import('./client');

    const result = await fetchSnapshot('catalog');
    expect(result).toEqual({ notModified: true });

    const [, init] = fetchMock.mock.calls[0];
    expect(init?.headers).toBeUndefined();
  });

  test('throws parsed message when snapshot request fails', async () => {
    mockGetBaseURL.mockResolvedValue('http://127.0.0.1:0');

    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: vi.fn().mockResolvedValue({ message: 'catalog sync failed' }),
      headers: new Headers(),
    });

    (globalThis as any).fetch = fetchMock;
    const { fetchSnapshot } = await import('./client');

    await expect(fetchSnapshot('catalog')).rejects.toThrow('catalog sync failed');
  });

  test('throws formatted permission denied message when status payload returned', async () => {
    mockGetBaseURL.mockResolvedValue('http://127.0.0.1:0');

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

    (globalThis as any).fetch = fetchMock;
    const { fetchSnapshot } = await import('./client');

    await expect(fetchSnapshot('nodes')).rejects.toThrow(
      'permission denied for domain nodes (core/nodes)'
    );
  });

  test('falls back to status text when error body cannot be parsed', async () => {
    mockGetBaseURL.mockResolvedValue('http://127.0.0.1:0');

    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      statusText: 'Bad Gateway',
      json: vi.fn().mockRejectedValue(new Error('broken json')),
      headers: new Headers(),
    });

    (globalThis as any).fetch = fetchMock;
    const { fetchSnapshot } = await import('./client');

    await expect(fetchSnapshot('catalog')).rejects.toThrow(
      'Snapshot request failed: 502 Bad Gateway'
    );
  });
});

describe('fetchTelemetrySummary', () => {
  test('returns parsed telemetry summary payload', async () => {
    mockGetBaseURL.mockResolvedValue('http://127.0.0.1:0');

    const summary = { refreshCount: 10, failureCount: 1, uptimeSeconds: 120 };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: vi.fn().mockResolvedValue(summary),
      headers: new Headers(),
    });

    (globalThis as any).fetch = fetchMock;
    const { fetchTelemetrySummary } = await import('./client');

    await expect(fetchTelemetrySummary()).resolves.toEqual(summary);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:0/api/v2/telemetry/summary');
    expect(init).toBeUndefined();
  });

  test('throws when telemetry request fails', async () => {
    mockGetBaseURL.mockResolvedValue('http://127.0.0.1:0');

    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
      json: vi.fn(),
      headers: new Headers(),
    });

    (globalThis as any).fetch = fetchMock;
    const { fetchTelemetrySummary } = await import('./client');

    await expect(fetchTelemetrySummary()).rejects.toThrow(
      'Telemetry request failed: 503 Service Unavailable'
    );
  });
});
