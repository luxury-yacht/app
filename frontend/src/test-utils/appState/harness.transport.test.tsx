/**
 * frontend/src/test-utils/appState/harness.transport.test.tsx
 *
 * The faked backend keeps the answers a test gives it. Holding a method parks
 * its calls without changing what the backend says afterwards; otherwise a
 * test that re-answers during a hold would assert against a stale backend.
 * Snapshot answers apply in the order a test adds them, ahead of served
 * payloads, until removed; otherwise a suite's own answer could be shadowed or
 * outlive the test step that set it.
 */

import { describe, expect, it } from 'vitest';
import { DiscoverNodeLogs } from '@/core/backend-api';
import { fetchSnapshot } from '@/core/refresh/client';
import { installAppStateHarness } from './harness';

const app = installAppStateHarness();

const node = {
  clusterId: 'dev:alpha',
  group: '',
  version: 'v1',
  kind: 'Node',
  namespace: '',
  name: 'worker-1',
};
const discovery = (reason: string) => ({ supported: false, sources: [], reason });

// Reads a snapshot through the app's refresh client.
const readSnapshot = async (scope: string) =>
  (await fetchSnapshot('namespace-config', { scope })).snapshot?.payload;

describe('snapshot answers', () => {
  it('answer reads in the order added, ahead of served payloads, until removed', async () => {
    app.snapshots.serve('namespace-config', 'dev:alpha|namespace:team-a', {
      served: true,
    } as never);
    const first = app.snapshots.answer(({ scope }) =>
      scope.includes('team-a') ? { answer: 'first' } : undefined
    );
    app.snapshots.answer(() => ({ answer: 'second' }));

    expect(await readSnapshot('dev:alpha|namespace:team-a')).toEqual({
      answer: 'first',
    });
    expect(await readSnapshot('dev:alpha|namespace:team-b')).toEqual({
      answer: 'second',
    });

    first();

    expect(await readSnapshot('dev:alpha|namespace:team-a')).toEqual({
      answer: 'second',
    });
  });
});

describe('an aborted snapshot read', () => {
  it('rejects a read the backend is still holding, as a real fetch does', async () => {
    // The backend never answers this read.
    app.snapshots.respond(() => new Promise<Response>(() => undefined));
    const controller = new AbortController();

    const read = fetchSnapshot('namespace-config', {
      scope: 'dev:alpha|namespace:team-a',
      signal: controller.signal,
    });
    controller.abort();

    await expect(read).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('a held backend method', () => {
  it('answers parked calls as held, and later calls with the answer given meanwhile', async () => {
    app.backend.answer('DiscoverNodeLogs', () => discovery('before'));
    const release = app.backend.hold('DiscoverNodeLogs');
    const parked = DiscoverNodeLogs(node);

    app.backend.answer('DiscoverNodeLogs', () => discovery('after'));
    release();

    expect((await parked).reason).toBe('before');
    expect((await DiscoverNodeLogs(node)).reason).toBe('after');
  });
});
