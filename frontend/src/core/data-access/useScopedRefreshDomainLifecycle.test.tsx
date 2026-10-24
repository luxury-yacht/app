/**
 * frontend/src/core/data-access/useScopedRefreshDomainLifecycle.test.tsx
 *
 * A mounted, enabled consumer keeps its scope refreshing: the backend is
 * polled for that scope (and read at once when the consumer asks to fetch on
 * enable) until the consumer unmounts, is disabled, or moves to another scope.
 * Only preserveState keeps a released scope's snapshot for a remount, and a
 * paused app skips the startup fetch without leaking the lease. Runs the real
 * orchestrator inside the production shell over a faked backend
 * (test-utils/appState).
 */

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getScopedDomainState } from '@/core/refresh/store';
import type { RefreshDomain } from '@/core/refresh/types';
import { setAutoRefreshEnabled } from '@/core/settings/appPreferences';
import {
  installAppStateHarness,
  type MountedApp,
  type TestCluster,
} from '@/test-utils/appState/harness';
import { useScopedRefreshDomainLifecycle } from './useScopedRefreshDomainLifecycle';

const app = installAppStateHarness();

// object-yaml is a polled snapshot domain (every 5 s): a lease alone reads
// nothing until its first poll, so an immediate read is the enable fetch.
const DOMAIN: RefreshDomain = 'object-yaml';
const POLL_INTERVAL_MS = 5_000;

interface ProbeProps {
  scope: string;
  enabled: boolean;
  preserveState?: boolean;
  fetchOnEnable?: 'startup' | false;
}

function Probe(props: ProbeProps) {
  useScopedRefreshDomainLifecycle({ domain: DOMAIN, ...props });
  return null;
}

let dev: TestCluster;
let view: MountedApp;
let apiScope: string;
let webScope: string;

const deploymentScope = (name: string) =>
  app.object(dev, { group: 'apps', version: 'v1', kind: 'Deployment', namespace: 'team-a', name })
    .scopes.detailScope ?? '';

const serveYaml = (scope: string, name: string) => {
  app.snapshots.serve(DOMAIN, scope, {
    clusterId: dev.clusterId,
    clusterName: dev.clusterName,
    yaml: `apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: ${name}\n`,
  });
};

const show = (props: ProbeProps) => view.show(<Probe {...props} />);

const reads = () => app.snapshots.reads(DOMAIN).map((read) => read.scope);

const advance = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

beforeEach(async () => {
  vi.useFakeTimers();
  dev = app.cluster({ name: 'dev', context: 'alpha' });
  app.namespaces(dev, ['team-a']);
  apiScope = deploymentScope('api');
  webScope = deploymentScope('web');
  serveYaml(apiScope, 'api');
  serveYaml(webScope, 'web');
  view = await app.render(null);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useScopedRefreshDomainLifecycle', () => {
  it('polls the scope while mounted and enabled, and stops when the consumer unmounts', async () => {
    await show({ scope: apiScope, enabled: true });
    await advance(POLL_INTERVAL_MS);
    expect(reads()).toEqual([apiScope]);

    view.clear();
    app.snapshots.clearReads();
    await advance(POLL_INTERVAL_MS * 4);

    expect(reads()).toEqual([]);
  });

  it('reads nothing while disabled, and starts polling once enabled', async () => {
    await show({ scope: apiScope, enabled: false });
    await advance(POLL_INTERVAL_MS * 2);
    expect(reads()).toEqual([]);

    await show({ scope: apiScope, enabled: true });
    await advance(POLL_INTERVAL_MS);

    expect(reads()).toEqual([apiScope]);
  });

  it('moves polling to the new scope when the scope changes', async () => {
    await show({ scope: apiScope, enabled: true });
    await show({ scope: webScope, enabled: true });
    await advance(POLL_INTERVAL_MS * 2);

    expect(new Set(reads())).toEqual(new Set([webScope]));
  });

  it.each([
    { preserveState: true, outcome: 'keeps' },
    { preserveState: false, outcome: 'drops' },
  ])(
    'with preserveState $preserveState, $outcome the released scope’s snapshot',
    async ({ preserveState }) => {
      await show({ scope: apiScope, enabled: true, preserveState, fetchOnEnable: 'startup' });
      expect(getScopedDomainState(DOMAIN, apiScope).data?.yaml).toContain('name: api');

      await show({ scope: webScope, enabled: true, preserveState, fetchOnEnable: 'startup' });

      expect(getScopedDomainState(DOMAIN, webScope).data?.yaml).toContain('name: web');
      expect(Boolean(getScopedDomainState(DOMAIN, apiScope).data)).toBe(preserveState);
    }
  );

  it('reads the scope at once when the consumer asks to fetch on enable', async () => {
    await show({ scope: apiScope, enabled: true, fetchOnEnable: 'startup' });

    expect(reads()).toEqual([apiScope]);
  });

  it('skips the startup fetch while auto-refresh is paused and still releases on unmount', async () => {
    // Mirrors backend/preferences_settings.go UpdateAppPreferences.
    app.backend.answer('UpdateAppPreferences', (request) => ({
      settings: null,
      changedKeys: (request.changes ?? []).map(({ key }) => key),
    }));
    await act(async () => {
      setAutoRefreshEnabled(false);
    });
    await show({ scope: apiScope, enabled: true, fetchOnEnable: 'startup' });
    await advance(POLL_INTERVAL_MS * 2);
    expect(reads()).toEqual([]);

    view.clear();
    // Resuming re-arms polls only for scopes still leased.
    await act(async () => {
      setAutoRefreshEnabled(true);
    });
    await advance(POLL_INTERVAL_MS * 2);

    expect(reads()).toEqual([]);
  });
});
