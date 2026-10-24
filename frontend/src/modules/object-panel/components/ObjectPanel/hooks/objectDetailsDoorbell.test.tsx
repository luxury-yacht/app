/**
 * frontend/src/modules/object-panel/components/ObjectPanel/hooks/objectDetailsDoorbell.test.tsx
 *
 * The Details tab's change signal, through the real panel hook, providers,
 * orchestrator, store, and stream manager. Only the refresh HTTP API and the
 * named-stream sockets are faked (test-utils/appState).
 */

import { act, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  installAppStateHarness,
  type MountedApp,
  setAutoRefresh,
  type TestCluster,
} from '@/test-utils/appState/harness';
import { type SnapshotRequest, snapshotResponse, streamKey } from '@/test-utils/appState/transport';
import { useObjectPanelRefresh } from './useObjectPanelRefresh';

const app = installAppStateHarness({ streams: 'manual' });

let snapshotVersion = 0;
const answerDetailReads = () => {
  app.snapshots.respond(({ domain, scope }: SnapshotRequest) => {
    if (domain !== 'object-details') {
      return undefined;
    }
    snapshotVersion += 1;
    return snapshotResponse({
      domain,
      scope,
      version: snapshotVersion,
      payload: { kind: 'Deployment', details: { replicas: snapshotVersion } },
    });
  });
};

const detailReads = (detailScope: string): number =>
  app.snapshots.reads('object-details').filter((read) => read.scope === detailScope).length;

const settle = async () => {
  await app.settle();
};

const advance = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
  await app.settle();
};

// isOpen is false for a panel behind another tab of its dock group.
const DetailsHarness = ({
  detailScope,
  isOpen = true,
}: {
  detailScope: string;
  isOpen?: boolean;
}) => {
  useObjectPanelRefresh({ detailScope, isOpen, resourceDeleted: false });
  return null;
};

const deploymentScope = (cluster: TestCluster, name: string): string =>
  app.object(cluster, {
    group: 'apps',
    version: 'v1',
    kind: 'Deployment',
    namespace: 'team-a',
    name,
  }).scopes.detailScope ?? '';

describe('object-details change signal', () => {
  let view: MountedApp;
  let scope: string;
  let otherScope: string;

  beforeEach(async () => {
    vi.useFakeTimers();
    setAutoRefresh(true);
    answerDetailReads();
    const dev = app.cluster({ name: 'dev', context: 'alpha' });
    app.namespaces(dev, ['team-a']);
    scope = deploymentScope(dev, 'api');
    otherScope = deploymentScope(dev, 'worker');
    view = await app.render(null);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const renderPanels = async (panels: ReactNode) => {
    await view.show(panels);
  };

  it('refetches an open panel’s details when its object rings, without waiting for a poll', async () => {
    await renderPanels(<DetailsHarness detailScope={scope} />);
    await settle();
    expect(app.streams.active()).toContain(streamKey('object-details', scope));
    app.streams.acknowledge('object-details', scope);
    await settle();
    const readsBeforeSignal = detailReads(scope);

    app.streams.ring('object-details', scope, 'object', '42');
    await advance(500);

    // The next poll is 10 s out; this read is the signal's.
    expect(detailReads(scope)).toBe(readsBeforeSignal + 1);
  });

  it('refreshes each open panel on its own signal and every 10 s, and keeps the other after one closes', async () => {
    await renderPanels(
      <>
        <DetailsHarness detailScope={scope} />
        <DetailsHarness detailScope={otherScope} />
      </>
    );
    await settle();
    app.streams.acknowledge('object-details', scope);
    app.streams.acknowledge('object-details', otherScope);
    await settle();
    const before = { first: detailReads(scope), other: detailReads(otherScope) };

    app.streams.ring('object-details', scope, 'object', '7');
    await advance(500);
    expect(detailReads(scope)).toBe(before.first + 1);
    expect(detailReads(otherScope)).toBe(before.other);

    // A healthy stream does not stop the 10 s backstop, and nothing polls sooner.
    app.snapshots.clearReads();
    await advance(9_000);
    expect(detailReads(scope)).toBe(0);
    expect(detailReads(otherScope)).toBe(0);
    await advance(1_500);
    expect(detailReads(scope)).toBe(1);
    expect(detailReads(otherScope)).toBe(1);

    await renderPanels(<DetailsHarness detailScope={otherScope} />);
    app.snapshots.clearReads();
    await advance(10_500);
    expect(detailReads(scope)).toBe(0);
    expect(detailReads(otherScope)).toBe(1);
  });

  it('polls nothing for a panel hidden behind another dock tab', async () => {
    await renderPanels(<DetailsHarness detailScope={scope} isOpen={false} />);
    await settle();
    await advance(30_000);

    expect(detailReads(scope)).toBe(0);
    expect(app.streams.active()).not.toContain(streamKey('object-details', scope));
  });
});
