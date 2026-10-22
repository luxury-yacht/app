/**
 * frontend/src/test-utils/appState/harness.transport.test.tsx
 *
 * The faked backend keeps the answers a test gives it. Holding a method parks
 * its calls without changing what the backend says afterwards; otherwise a
 * test that re-answers during a hold would assert against a stale backend.
 */

import { describe, expect, it } from 'vitest';
import { DiscoverNodeLogs } from '@/core/backend-api';
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
