/**
 * frontend/src/core/contexts/inactiveClusterDemand.test.tsx
 *
 * A cluster tab the user is not looking at does no refresh work of its own:
 * nothing in the app's provider tree polls it. Only leases (visible views)
 * create demand. The real providers, orchestrator, and runtimes run; only the
 * refresh HTTP API and stream sockets are faked (test-utils/appState).
 */

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installAppStateHarness } from '@/test-utils/appState/harness';

const app = installAppStateHarness();

describe('an inactive cluster tab', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('is never polled while the user looks at another tab', async () => {
    const active = app.cluster({ name: 'tab', context: 'active' });
    const inactive = app.cluster({ name: 'tab', context: 'inactive' });
    app.namespaces(active, ['default']);
    app.namespaces(inactive, ['default']);
    await app.render(null);
    app.snapshots.clearReads();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    await app.settle();

    const inactiveReads = app.snapshots
      .reads()
      .filter((read) => read.scope.startsWith(`${inactive.clusterId}|`));
    expect(inactiveReads).toEqual([]);
  });
});
