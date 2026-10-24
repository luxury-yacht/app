/**
 * frontend/src/ui/status/SessionsStatus.test.tsx
 *
 * The header sessions indicator lists the visible cluster's shell sessions and
 * port forwards from the backend's runtime lists: opening a shell session opens
 * its object's panel (the pod, or the node of a node shell) on the Shell tab
 * and closes the popover; ending a session or stopping a forward disables its
 * control until the backend answers and reports a failure; a node shell whose
 * debug pod was not deleted shows as failed with the reason; node drains are
 * not listed. Runs in the full app over the faked backend (test-utils/appState).
 */

import { backend, types } from '@core/backend-api/models';
import { act } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { makeClusterNodeSnapshotPayload } from '@/core/refresh/refreshContractTestBuilders';
import {
  buildClusterRefreshScope,
  buildRefreshScope,
  CLUSTER_SELECTOR,
} from '@/core/refresh/scopeSelector';
import {
  installAppStateHarness,
  type MountedApp,
  type TestCluster,
} from '@/test-utils/appState/harness';
import type { BackendResult } from '@/test-utils/appState/transport';
import { partialModelFixture } from '@/test-utils/partialModelFixture';
import { requireValue } from '@/test-utils/requireValue';

type ShellSession = NonNullable<BackendResult<'ListShellSessions'>>[number];
type PortForward = NonNullable<BackendResult<'ListPortForwards'>>[number];
type RuntimeOperation = NonNullable<BackendResult<'ListRuntimeOperations'>>[number];

const app = installAppStateHarness();
let view: MountedApp;
let dev: TestCluster;

const pod = () => ({
  group: '',
  version: 'v1',
  kind: 'Pod',
  namespace: 'default',
  name: 'web-abc',
});
const node = () => ({ group: '', version: 'v1', kind: 'Node', namespace: '', name: 'worker-1' });

const shellSession = (fields: Partial<ShellSession> = {}) =>
  partialModelFixture<ShellSession>({
    sessionId: 'shell-1',
    clusterId: dev.clusterId,
    clusterName: dev.clusterName,
    target: { clusterId: dev.clusterId, ...pod() },
    container: 'app',
    command: ['/bin/sh'],
    startedAt: '2026-02-20T00:00:00Z',
    ...fields,
  });

const operation = (id: string, type: backend.RuntimeOperationType) =>
  partialModelFixture<RuntimeOperation>({
    id,
    type,
    clusterId: dev.clusterId,
    clusterName: dev.clusterName,
    status: 'active',
    startedAt: '2026-02-20T00:00:00Z',
  });

/** The backend's runtime lists at startup. */
const runtime = ({
  shells = [],
  forwards = [],
  operations,
}: {
  shells?: ShellSession[];
  forwards?: PortForward[];
  operations?: RuntimeOperation[];
}) => {
  app.backend.answer('ListShellSessions', () => shells);
  app.backend.answer('ListPortForwards', () => forwards);
  app.backend.answer(
    'ListRuntimeOperations',
    () =>
      operations ?? [
        ...shells.map((session) =>
          operation(session.sessionId, backend.RuntimeOperationType.RuntimeOperationShell)
        ),
        ...forwards.map((session) =>
          operation(session.id, backend.RuntimeOperationType.RuntimeOperationPortForward)
        ),
      ]
  );
};

const indicator = () =>
  requireValue(
    view.container.querySelector<HTMLElement>('[role="button"][aria-label^="Sessions:"]'),
    'expected the sessions indicator'
  );
const severity = () =>
  indicator().querySelector('.status-indicator-dot')?.getAttribute('data-status');
const popover = () => document.getElementById(indicator().getAttribute('aria-controls') ?? '');

/** Opens the indicator's popover from the keyboard. */
const openPopover = async () => {
  await act(async () => {
    indicator().dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    );
  });
  await app.settle();
  return requireValue(popover(), 'expected the sessions popover');
};

const click = async (target: HTMLElement) => {
  await act(async () => target.click());
  await app.settle();
};

/** A backend call that answers when the test says so. */
const pendingCall = () => {
  let finish: (failure?: Error) => void = () => undefined;
  const answer = () =>
    new Promise<void>((resolve, reject) => {
      finish = (failure) => (failure ? reject(failure) : resolve());
    });
  return { answer, finish: (failure?: Error) => finish(failure) };
};

/** The selected tabs in the docked object panel: its own tab and its view's. */
const selectedPanelTabs = () =>
  Array.from(
    requireValue(
      document.body.querySelector('[data-dockable-group-key]'),
      'expected the docked panel'
    ).querySelectorAll('[role="tab"][aria-selected="true"]'),
    (tab) => tab.textContent
  );

const start = async () => {
  view = await app.mountApp();
};

beforeEach(() => {
  dev = app.cluster({ name: 'dev', context: 'alpha' });
  app.namespaces(dev, ['default']);
  app.startScreen(dev);
});

describe('SessionsStatus', () => {
  it('opens a pod shell session’s panel on its Shell tab and closes the popover', async () => {
    runtime({ shells: [shellSession()] });
    app.servePanel(dev, pod());
    // The Shell tab lists the pod's containers.
    app.backend.answer('GetPodContainers', () => [
      { name: 'app', isInit: false, isEphemeral: false },
    ]);
    await start();
    const sessions = await openPopover();

    await click(
      requireValue(
        sessions.querySelector<HTMLButtonElement>('.as-shell-session-jump'),
        'expected the shell session'
      )
    );

    expect(view.openPanels()).toEqual([
      { clusterId: dev.clusterId, clusterName: dev.clusterName, ...pod() },
    ]);
    expect(selectedPanelTabs()).toContain('Shell');
    expect(popover()).toBeNull();
  });

  it('identifies a node shell by its node and debug pod and opens the node', async () => {
    runtime({
      shells: [
        shellSession({
          target: { clusterId: dev.clusterId, ...node() },
          debugPod: {
            clusterId: dev.clusterId,
            ...pod(),
            name: 'node-debugger-worker-1-abcde',
          },
          container: 'debugger',
        }),
      ],
    });
    app.servePanel(dev, node());
    // A node's panel reads the cluster's nodes, their maintenance, and its node logs.
    app.snapshots.serve(
      'object-maintenance',
      buildClusterRefreshScope('object-maintenance', dev.clusterId),
      { clusterId: dev.clusterId, clusterName: dev.clusterName, drains: [] }
    );
    app.snapshots.serve(
      'nodes',
      buildRefreshScope('nodes', { clusterId: dev.clusterId, selector: CLUSTER_SELECTOR }),
      makeClusterNodeSnapshotPayload({ clusterId: dev.clusterId, clusterName: dev.clusterName })
    );
    app.backend.answer('DiscoverNodeLogs', () => ({
      supported: false,
      sources: [],
      reason: 'node log query is not enabled',
    }));
    await start();
    const sessions = await openPopover();

    const fields = Object.fromEntries(
      Array.from(sessions.querySelectorAll('.as-shell-session .ss-field-row')).map((row) => [
        row.querySelector('.ss-field-label')?.textContent?.replace(':', ''),
        row.querySelector('.ss-field-value')?.textContent,
      ])
    );
    expect(fields).toMatchObject({
      node: 'worker-1',
      namespace: 'default',
      pod: 'node-debugger-worker-1-abcde',
    });

    await click(
      requireValue(
        sessions.querySelector<HTMLButtonElement>('.as-shell-session-jump'),
        'expected the node shell session'
      )
    );

    expect(view.openPanels()).toEqual([
      { clusterId: dev.clusterId, clusterName: dev.clusterName, ...node() },
    ]);
    expect(selectedPanelTabs()).toContain('Shell');
  });

  it('shows a node shell whose debug pod was not deleted as failed, with the reason', async () => {
    const reason =
      'debug pod default/node-debugger-worker-1-abcde was not deleted: dial tcp: connection refused';
    runtime({
      shells: [
        shellSession({
          target: { clusterId: dev.clusterId, ...node() },
          debugPod: { clusterId: dev.clusterId, ...pod(), name: 'node-debugger-worker-1-abcde' },
          container: 'debugger',
          status: types.ShellSessionStatus.ShellSessionStatusCleanupFailed,
          statusReason: reason,
        }),
      ],
    });
    await start();

    expect(severity()).toBe('unhealthy');
    const row = requireValue(
      (await openPopover()).querySelector('.as-shell-session'),
      'expected the node shell row'
    );
    expect(row.querySelector('.pf-status-error')).not.toBeNull();
    expect(row.textContent).toContain(reason);
    // Ending the session again retries the delete.
    expect(row.querySelector('[aria-label="End shell session"]')).not.toBeNull();
  });

  it.each([false, true])(
    'ends the selected shell session without opening it, and restores its control (failed: %s)',
    async (fails) => {
      const close = pendingCall();
      app.backend.answer('CloseShellSession', close.answer);
      runtime({ shells: [shellSession()] });
      await start();
      const end = requireValue(
        (await openPopover()).querySelector<HTMLButtonElement>('[aria-label="End shell session"]'),
        'expected the End shell session control'
      );

      await click(end);
      expect(app.backend.calls('CloseShellSession')).toEqual([['shell-1']]);
      expect(view.openPanels()).toEqual([]);
      expect(end.disabled).toBe(true);

      const failure = new Error(`end failed (${fails})`);
      await act(async () => close.finish(fails ? failure : undefined));
      await app.settle();

      expect(end.disabled).toBe(false);
      expect(
        app.errors.take(
          (record) =>
            record.error === failure &&
            record.context?.action === 'closeShellSession' &&
            record.context.sessionId === 'shell-1'
        )
      ).toHaveLength(fails ? 1 : 0);
    }
  );

  it.each([false, true])(
    'stops the selected port forward and restores its control (failed: %s)',
    async (fails) => {
      const stop = pendingCall();
      app.backend.answer('StopPortForward', stop.answer);
      runtime({
        forwards: [
          partialModelFixture<PortForward>({
            id: 'pf-1',
            clusterId: dev.clusterId,
            clusterName: dev.clusterName,
            target: { clusterId: dev.clusterId, ...pod() },
            podName: 'web-abc',
            containerPort: 8080,
            localPort: 18080,
            status: backend.PortForwardStatus.PortForwardStatusActive,
            startedAt: '2026-02-20T00:00:00Z',
          }),
        ],
      });
      await start();
      const button = requireValue(
        (await openPopover()).querySelector<HTMLButtonElement>('[aria-label="Stop port forward"]'),
        'expected the Stop port forward control'
      );

      await click(button);
      expect(app.backend.calls('StopPortForward')).toEqual([['pf-1']]);
      expect(button.disabled).toBe(true);

      const failure = new Error(`stop failed (${fails})`);
      await act(async () => stop.finish(fails ? failure : undefined));
      await app.settle();

      expect(button.disabled).toBe(false);
      expect(
        app.errors.take(
          (record) =>
            record.error === failure &&
            record.context?.action === 'stopPortForward' &&
            record.context.sessionId === 'pf-1'
        )
      ).toHaveLength(fails ? 1 : 0);
    }
  );

  it('does not list node drains with shell sessions and port forwards', async () => {
    runtime({
      operations: [operation('drain-1', backend.RuntimeOperationType.RuntimeOperationDrain)],
    });
    await start();

    expect(severity()).toBe('inactive');
    const sessions = await openPopover();
    expect(sessions.textContent).not.toContain('Node Drains');
    expect(sessions.textContent).toContain('No active shell sessions or port forwards');
  });
});
