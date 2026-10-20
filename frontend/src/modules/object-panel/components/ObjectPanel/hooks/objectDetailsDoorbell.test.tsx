/**
 * frontend/src/modules/object-panel/components/ObjectPanel/hooks/objectDetailsDoorbell.test.tsx
 *
 * The Details tab's change signal, through the real panel hook, orchestrator,
 * store, and stream manager. Only snapshot reads and the named-stream sockets
 * are faked (test-utils/refreshHarness).
 */

import { act, type ReactNode } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchSnapshotMock } = vi.hoisted(() => ({ fetchSnapshotMock: vi.fn() }));

vi.mock('@/core/refresh/client', () => ({
  fetchSnapshot: (...args: unknown[]) => fetchSnapshotMock(...args),
  setMetricsActive: () => Promise.resolve(),
}));

vi.mock('@/core/logging/appLogsClient', () => ({
  APP_LOG_SOURCES: new Proxy({}, { get: (_target, key) => String(key) }),
  logAppLogsDebug: () => undefined,
  logAppLogsInfo: () => undefined,
  logAppLogsWarn: () => undefined,
  logAppLogsError: () => undefined,
}));

import type { RefreshDomain } from '@/core/refresh/types';
import {
  resetAppPreferencesCacheForTesting,
  setAppPreferencesForTesting,
} from '@/core/settings/appPreferences';
import {
  acknowledgeStream,
  activeStreamSubscriptions,
  flushRefreshWork,
  installFakeStreamSockets,
  markClusterReady,
  resetRefreshHarness,
  ringStream,
  setAutoRefresh,
  streamKey,
} from '@/test-utils/refreshHarness';
import { testScope } from '@/test-utils/refreshScope';
import { useObjectPanelRefresh } from './useObjectPanelRefresh';

const CLUSTER = 'details-doorbell';
const scope = testScope(CLUSTER, 'team-a:apps/v1:Deployment:api');
const otherScope = testScope(CLUSTER, 'team-a:apps/v1:Deployment:worker');

let snapshotVersion = 0;
const answerReads = () => {
  fetchSnapshotMock.mockImplementation(
    async (domain: RefreshDomain, options: { scope: string }) => {
      snapshotVersion += 1;
      return {
        notModified: false,
        etag: `v${snapshotVersion}`,
        snapshot: {
          domain,
          scope: options.scope,
          version: snapshotVersion,
          checksum: `c${snapshotVersion}`,
          generatedAt: Date.now(),
          sequence: snapshotVersion,
          payload: { kind: 'Deployment', details: { replicas: snapshotVersion } },
          stats: { itemCount: 1, buildDurationMs: 0 },
        },
      };
    }
  );
};

const detailReads = (detailScope: string = scope): number =>
  fetchSnapshotMock.mock.calls.filter(
    ([domain, options]) =>
      domain === 'object-details' && (options as { scope: string }).scope === detailScope
  ).length;

const settle = async () => {
  await act(async () => {
    await flushRefreshWork();
    await vi.advanceTimersByTimeAsync(0);
    await flushRefreshWork();
  });
};

const advance = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
    await flushRefreshWork();
  });
};

// isOpen is false for a panel behind another tab of its dock group.
const DetailsHarness = ({
  detailScope = scope,
  isOpen = true,
}: {
  detailScope?: string;
  isOpen?: boolean;
}) => {
  useObjectPanelRefresh({ detailScope, isOpen, resourceDeleted: false });
  return null;
};

describe('object-details change signal', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeAll(() => {
    installFakeStreamSockets();
  });

  beforeEach(() => {
    vi.useFakeTimers();
    resetAppPreferencesCacheForTesting();
    setAppPreferencesForTesting({ autoRefreshEnabled: true });
    setAutoRefresh(true);
    fetchSnapshotMock.mockReset();
    answerReads();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
  });

  afterEach(async () => {
    act(() => root.unmount());
    container.remove();
    resetRefreshHarness();
    await vi.runOnlyPendingTimersAsync();
    vi.useRealTimers();
  });

  const renderPanels = async (panels: ReactNode) => {
    await act(async () => {
      root.render(panels);
    });
  };

  it('refetches an open panel’s details when its object rings, without waiting for a poll', async () => {
    markClusterReady(CLUSTER);
    await renderPanels(<DetailsHarness />);
    await settle();
    expect(activeStreamSubscriptions()).toContain(streamKey('object-details', scope));
    acknowledgeStream('object-details', scope);
    await settle();
    const readsBeforeSignal = detailReads();

    ringStream('object-details', scope, 'object', '42');
    await advance(500);

    // The next poll is 10 s out; this read is the signal's.
    expect(detailReads()).toBe(readsBeforeSignal + 1);
  });

  it('refreshes each open panel on its own signal and every 10 s, and keeps the other after one closes', async () => {
    markClusterReady(CLUSTER);
    await renderPanels(
      <>
        <DetailsHarness detailScope={scope} />
        <DetailsHarness detailScope={otherScope} />
      </>
    );
    await settle();
    acknowledgeStream('object-details', scope);
    acknowledgeStream('object-details', otherScope);
    await settle();
    const before = { first: detailReads(scope), other: detailReads(otherScope) };

    ringStream('object-details', scope, 'object', '7');
    await advance(500);
    expect(detailReads(scope)).toBe(before.first + 1);
    expect(detailReads(otherScope)).toBe(before.other);

    // A healthy stream does not stop the 10 s backstop, and nothing polls sooner.
    fetchSnapshotMock.mockClear();
    await advance(9_000);
    expect(detailReads(scope)).toBe(0);
    expect(detailReads(otherScope)).toBe(0);
    await advance(1_500);
    expect(detailReads(scope)).toBe(1);
    expect(detailReads(otherScope)).toBe(1);

    await renderPanels(<DetailsHarness detailScope={otherScope} />);
    fetchSnapshotMock.mockClear();
    await advance(10_500);
    expect(detailReads(scope)).toBe(0);
    expect(detailReads(otherScope)).toBe(1);
  });

  it('polls nothing for a panel hidden behind another dock tab', async () => {
    markClusterReady(CLUSTER);
    await renderPanels(<DetailsHarness isOpen={false} />);
    await settle();
    await advance(30_000);

    expect(detailReads(scope)).toBe(0);
    expect(activeStreamSubscriptions()).not.toContain(streamKey('object-details', scope));
  });
});
