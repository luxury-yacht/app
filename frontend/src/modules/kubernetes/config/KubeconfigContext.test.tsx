/**
 * frontend/src/modules/kubernetes/config/KubeconfigContext.test.tsx
 *
 * The kubeconfig owner: which cluster tabs a workspace window has open, which
 * one is active, and how opens, switches, and closes reach the backend. Tabs
 * change at once; the backend admits membership writes one at a time; a close
 * hides its tab until the backend's native close accepts or refuses it, and an
 * accepted close is adopted without another membership write. Runs inside the
 * production shell: the real kubeconfig, namespace, cluster-lifecycle, panel
 * lifecycle (its native close participant), and refresh owners, over a faked
 * backend (test-utils/appState). Inputs come through the boundary: discovery
 * (GetKubeconfigs), the window's workspace (GetClusterWorkspaceStateForWindow,
 * ApplyClusterWorkspace, CloseClusterView), and backend events. `backend.hold`
 * keeps a command in flight to observe the window meanwhile; a test answers a
 * command itself where the backend must decide one call differently from
 * another. Startup of the selected clusters is also covered by
 * test-utils/appState/harness.isolation.test.tsx and
 * core/contexts/inactiveClusterDemand.test.tsx.
 */

import { backend } from '@core/backend-api/models';
import ClusterTabs from '@ui/layout/ClusterTabs';
import { act, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { GetClusterWorkspaceStateForWindow } from '@/core/backend-api';
import { eventBus } from '@/core/events';
import { clusterReadiness } from '@/core/refresh/clusterReadiness';
import {
  installAppStateHarness,
  type MountedApp,
  type TestCluster,
} from '@/test-utils/appState/harness';
import type { BackendArgs, BackendResult } from '@/test-utils/appState/transport';
import { makeErrorStatus } from '@/test-utils/errorStatusFixtures';
import { requireValue } from '@/test-utils/requireValue';
import { errorStatusOf } from '@/utils/errorStatus';

const app = installAppStateHarness();
let view: MountedApp;

type Name = 'alpha' | 'beta' | 'gamma';
const NAMES: Name[] = ['alpha', 'beta', 'gamma'];
let clusters: Record<Name, TestCluster>;
const sel = (name: Name) => clusters[name].selection;
const id = (name: Name) => clusters[name].clusterId;
const sels = (...names: Name[]) => names.map(sel);

type Owner = ReturnType<MountedApp['owners']>['kubeconfig'];
const kube = (): Owner => view.owners().kubeconfig;

/**
 * Opens the window with alpha, beta, and gamma available (contexts of one
 * kubeconfig file) and `open` as its tabs; `surface` is shown after startup.
 */
const start = async (open: Name[], surface?: ReactNode) => {
  clusters = Object.fromEntries(
    NAMES.map((name) => {
      const cluster = app.cluster({ name: 'dev', context: name, open: open.includes(name) });
      app.namespaces(cluster, ['default']);
      return [name, cluster];
    })
  ) as Record<Name, TestCluster>;
  view = await app.render(null);
  if (surface) {
    await view.show(surface);
  }
};

/** Starts an owner action as the user would, without waiting for the backend. */
const begin = <T,>(action: (owner: Owner) => Promise<T>): Promise<T> => {
  let pending!: Promise<T>;
  act(() => {
    pending = action(kube());
  });
  return pending;
};

const switchTo = (name: Name) => {
  act(() => {
    kube().setActiveKubeconfig(sel(name));
  });
};

const finish = async (...pending: Promise<unknown>[]) => {
  await act(async () => {
    await Promise.allSettled(pending);
  });
  await app.settle();
};

const release = async (held: () => void) => {
  await act(async () => held());
  await app.settle();
};

/** The window's workspace as the backend holds it. */
const backendWorkspace = () => GetClusterWorkspaceStateForWindow(app.windowName);

type WorkspaceCommand = NonNullable<BackendArgs<'ApplyClusterWorkspace'>[0]>;
const workspaceCommands = (): WorkspaceCommand[] =>
  app.backend.calls('ApplyClusterWorkspace').map(([command]) => command);
/** The tab sets the window sent the backend, in order. */
const membershipWrites = () =>
  workspaceCommands()
    .filter((command) => command.updateSelectedKubeconfigs)
    .map((command) => command.selectedKubeconfigs);

const lastOf = <T,>(items: T[]): T | undefined => items[items.length - 1];

const nativeCloses = () => app.backend.calls('CloseClusterView');

/**
 * The backend refuses native closes from now on: the cluster's panel windows
 * refuse them (internal/appwindow/cluster_panel_close.go).
 */
const refuseCloses = () => app.backend.answer('CloseClusterView', () => false);

const namespaceReads = (name: Name) =>
  app.snapshots.reads('namespaces').filter((read) => read.scope.startsWith(`${id(name)}|`));

const closeButton = (label: string) =>
  view.container.querySelector<HTMLButtonElement>(`button[aria-label="Close ${label}"]`);
const tabLabels = () =>
  Array.from(view.container.querySelectorAll('[role="tab"]')).map((tab) => tab.textContent);
const clickClose = async (label: string) => {
  const button = requireValue(closeButton(label), `expected the ${label} tab's close button`);
  await act(async () => button.click());
};

describe('startup and discovery', () => {
  it('reports the cluster selection as loading until discovery answers', async () => {
    const discover = app.backend.hold('GetKubeconfigs');
    await start(['alpha']);

    expect(kube().kubeconfigsLoading).toBe(true);
    await release(discover);
    expect(kube().kubeconfigsLoading).toBe(false);
    expect(kube().selectedKubeconfigs).toEqual(sels('alpha'));
  });

  it('lists discovered kubeconfigs and the selected tab while the backend activates it', async () => {
    const activate = app.backend.hold('ApplyClusterWorkspace');
    await start(['alpha']);

    expect(kube().kubeconfigs.map((config) => config.context)).toEqual(NAMES);
    expect(kube().selectedKubeconfigs).toEqual(sels('alpha'));
    expect(kube().selectedClusterId).toBe(id('alpha'));
    expect(kube().kubeconfigsLoading).toBe(false);
    expect(lastOf(workspaceCommands())).toEqual({
      windowId: app.windowName,
      selectedKubeconfigs: [],
      updateSelectedKubeconfigs: false,
      visibleClusterId: id('alpha'),
    });
    await release(activate);
  });

  it.each([
    [backend.KubeconfigDiscoveryState.KubeconfigDiscoveryStateSearchPathsMissing, ['~/.kube']],
    [
      backend.KubeconfigDiscoveryState.KubeconfigDiscoveryStateNoKubeconfigs,
      ['~/.kube', '/etc/kubernetes'],
    ],
  ])('exposes %s discovery without reporting an error', async (state, searchPaths) => {
    app.backend.answer('GetKubeconfigs', () => ({ kubeconfigs: [], state, searchPaths }));
    view = await app.render(null);

    expect(kube().kubeconfigDiscoveryState).toBe(state);
    expect(kube().kubeconfigSearchPaths).toEqual(searchPaths);
    expect(app.errors.records()).toEqual([]);
  });

  it('keeps a Windows drive letter out of a selection’s context', async () => {
    const selection = 'C:\\Users\\John\\.kube\\config:minikube';
    app.backend.answer('GetKubeconfigs', () => ({
      kubeconfigs: [
        {
          name: 'config',
          path: 'C:\\Users\\John\\.kube\\config',
          context: 'minikube',
          isDefault: true,
          isCurrentContext: true,
          invalid: false,
          invalidReason: '',
        },
      ],
      state: backend.KubeconfigDiscoveryState.KubeconfigDiscoveryStateAvailable,
      searchPaths: ['C:\\Users\\John\\.kube'],
    }));
    app.backend.answer('GetClusterWorkspaceStateForWindow', () => ({
      selectedKubeconfigs: [selection],
      visibleClusterId: '',
      clusters: {},
    }));
    view = await app.render(null);

    expect(kube().selectedClusterId).toBe('config:minikube');
    expect(lastOf(workspaceCommands())?.visibleClusterId).toBe('config:minikube');
  });
});

describe('switching tabs', () => {
  it('shows a switched tab at once and serves its requests once the backend shows it', async () => {
    await start(['alpha', 'beta']);
    const show = app.backend.hold('ApplyClusterWorkspace');

    switchTo('beta');
    await app.settle();

    expect({
      selection: kube().selectedKubeconfig,
      clusterId: kube().selectedClusterId,
      open: kube().selectedClusterIds,
    }).toEqual({ selection: sel('beta'), clusterId: id('beta'), open: [id('alpha'), id('beta')] });
    expect(lastOf(workspaceCommands())?.visibleClusterId).toBe(id('beta'));
    expect(clusterReadiness.isServiceable(id('beta'))).toBe(false);

    await release(show);

    expect(clusterReadiness.isServiceable(id('beta'))).toBe(true);
    // A switch among open tabs keeps the other tab's data subscribed.
    expect(app.streams.active()).toContain(`namespaces ${id('alpha')}|`);
  });

  it('keeps the switched tab and resumes its data when the backend fails to show it', async () => {
    await start(['alpha', 'beta']);
    app.backend.answer('ApplyClusterWorkspace', () => {
      throw new Error('binding unavailable');
    });

    switchTo('beta');
    await app.settle();

    expect(kube().selectedKubeconfig).toBe(sel('beta'));
    expect(kube().selectedClusterId).toBe(id('beta'));
    expect(clusterReadiness.isServiceable(id('beta'))).toBe(true);
  });

  it('keeps this window’s active tab when the available kubeconfigs change', async () => {
    await start(['alpha', 'beta']);
    switchTo('beta');
    await app.settle();

    await act(async () => {
      app.events.emit('kubeconfig:available-changed');
    });
    await app.settle();

    expect(kube().selectedKubeconfig).toBe(sel('beta'));
  });
});

describe('opening tabs', () => {
  it('opens a cluster as the active tab after the open ones', async () => {
    await start(['beta']);

    await finish(begin((owner) => owner.openKubeconfig(sel('alpha'))));

    expect(membershipWrites()).toEqual([sels('beta', 'alpha')]);
    expect(kube().selectedKubeconfigs).toEqual(sels('beta', 'alpha'));
    expect(kube().selectedKubeconfig).toBe(sel('alpha'));
    expect((await backendWorkspace()).selectedKubeconfigs).toEqual(sels('beta', 'alpha'));
  });

  it('keeps one tab per kubeconfig file and context', async () => {
    // The same context name in two kubeconfig files is two clusters.
    const one = app.cluster({ name: 'one', context: 'dev', open: false });
    const two = app.cluster({ name: 'two', context: 'dev', open: false });
    view = await app.render(null);

    await finish(
      begin((owner) => owner.setSelectedKubeconfigs([one.selection, two.selection, one.selection]))
    );

    expect(membershipWrites()).toEqual([[one.selection, two.selection]]);
    expect(kube().selectedClusterIds).toEqual([one.clusterId, two.clusterId]);
  });

  it('announces when the window loses its last tab or gains its first', async () => {
    await start(['alpha']);
    const announced: string[] = [];
    const stop = [
      eventBus.on('kubeconfig:changing', () => announced.push('changing')),
      eventBus.on('kubeconfig:changed', () => announced.push('changed')),
      eventBus.on('kubeconfig:selection-changed', () => announced.push('selection-changed')),
    ];
    try {
      await finish(begin((owner) => owner.setSelectedKubeconfigs([])));
      expect(announced).toEqual(['changing']);

      announced.length = 0;
      await finish(begin((owner) => owner.setSelectedKubeconfigs(sels('alpha'))));
      expect(announced).toEqual(['selection-changed', 'changed']);
    } finally {
      stop.forEach((unsubscribe) => {
        unsubscribe();
      });
    }
  });

  it('sends one membership write at a time while showing the latest tabs at once', async () => {
    await start(['alpha']);
    const admit = app.backend.hold('ApplyClusterWorkspace');

    const first = begin((owner) => owner.setSelectedKubeconfigs(sels('alpha', 'beta')));
    const second = begin((owner) => owner.setSelectedKubeconfigs(sels('alpha', 'beta', 'gamma')));
    await app.settle();

    expect(membershipWrites()).toEqual([sels('alpha', 'beta')]);
    expect(kube().selectedKubeconfigs).toEqual(sels('alpha', 'beta', 'gamma'));

    await release(admit);
    await finish(first, second);

    expect(membershipWrites()).toEqual([sels('alpha', 'beta'), sels('alpha', 'beta', 'gamma')]);
    expect((await backendWorkspace()).selectedKubeconfigs).toEqual(sels('alpha', 'beta', 'gamma'));
  });

  it('shows an opening tab at once and keeps the readiness its cluster reports during admission', async () => {
    await start(['alpha']);
    const admit = app.backend.hold('ApplyClusterWorkspace');

    const opening = begin((owner) => owner.openKubeconfig(sel('beta')));
    // The cluster connects while its admission is in flight.
    await act(async () => {
      app.events.emit('cluster:lifecycle', { clusterId: id('beta'), state: 'ready' });
    });
    await app.settle();

    expect(kube().selectedKubeconfig).toBe(sel('beta'));
    expect(kube().selectedClusterIds).toEqual([id('alpha'), id('beta')]);

    await release(admit);
    await finish(opening);

    // The admission's workspace answer predates the event; the readiness stays.
    expect(clusterReadiness.isServiceable(id('beta'))).toBe(true);
    expect(namespaceReads('beta')).not.toEqual([]);
  });

  it('keeps backend membership aligned after overlapping opens settle', async () => {
    await start(['alpha']);
    const admit = app.backend.hold('ApplyClusterWorkspace');

    const opens = (['beta', 'gamma'] as const).map((name) =>
      begin((owner) => owner.openKubeconfig(sel(name)))
    );
    await release(admit);
    await finish(...opens);

    expect(kube().selectedKubeconfigs).toEqual(sels('alpha', 'beta', 'gamma'));
    expect(await backendWorkspace()).toMatchObject({
      selectedKubeconfigs: sels('alpha', 'beta', 'gamma'),
      visibleClusterId: id('gamma'),
    });
  });

  it('keeps a newer tab switch when an earlier open finishes', async () => {
    await start(['alpha']);
    const admit = app.backend.hold('ApplyClusterWorkspace');

    const opening = begin((owner) => owner.openKubeconfig(sel('beta')));
    switchTo('alpha');
    expect(kube().selectedKubeconfig).toBe(sel('alpha'));
    await release(admit);
    await finish(opening);

    expect(kube().selectedKubeconfig).toBe(sel('alpha'));
    expect((await backendWorkspace()).visibleClusterId).toBe(id('alpha'));
  });

  it('reports a refused selection with the reason the backend gave', async () => {
    await start(['alpha']);
    // The backend's errorstatus.Status: the same wire shape, with generated enum types.
    const refusal = makeErrorStatus(
      'BadRequest',
      'kubeconfig selection missing path'
    ) as unknown as NonNullable<BackendResult<'ApplyClusterWorkspace'>['error']>;
    app.backend.answer('ApplyClusterWorkspace', async (command) => ({
      state: await backendWorkspace(),
      ...(command.updateSelectedKubeconfigs ? { error: refusal } : {}),
    }));

    const opening = begin((owner) => owner.openKubeconfig(sel('gamma')));
    await act(async () => {
      await expect(opening).rejects.toThrow('kubeconfig selection missing path');
    });
    await app.settle();

    const reports = app.errors.take((record) => record.context?.context === 'openKubeconfig');
    expect(reports.map(({ error }) => errorStatusOf(error)?.reason)).toEqual(['BadRequest']);
    expect(kube().selectedKubeconfigs).toEqual(sels('alpha'));
  });
});

describe('closing tabs', () => {
  it.each(['close', 'replace'] as const)(
    'activates the tab to the right when the active middle tab closes (%s)',
    async (how) => {
      await start(['alpha', 'beta', 'gamma']);
      switchTo('beta');

      await finish(
        begin((owner) =>
          how === 'close'
            ? owner.closeKubeconfig(sel('beta'))
            : owner.setSelectedKubeconfigs(sels('alpha', 'gamma'))
        )
      );

      expect(kube().selectedKubeconfigs).toEqual(sels('alpha', 'gamma'));
      expect(kube().selectedKubeconfig).toBe(sel('gamma'));
    }
  );

  it('activates the next tab in the user’s tab order when the active tab closes', async () => {
    app.backend.answer('GetClusterTabOrder', () => sels('gamma', 'beta', 'alpha'));
    await start(['alpha', 'beta', 'gamma']);
    switchTo('beta');

    await finish(begin((owner) => owner.closeKubeconfig(sel('beta'))));

    expect(kube().selectedKubeconfigs).toEqual(sels('alpha', 'gamma'));
    expect(kube().selectedKubeconfig).toBe(sel('alpha'));
  });

  it.each([[['alpha'] as Name[]], [['alpha', 'beta'] as Name[]]])(
    'hides a closing tab until the backend refuses the close, then restores it (%j)',
    async (open) => {
      await start(open);
      refuseCloses();
      const decide = app.backend.hold('CloseClusterView');

      const closing = begin((owner) => owner.closeKubeconfig(sel('alpha')));
      await app.settle();

      expect(kube().selectedKubeconfigs).toEqual(sels(...open.filter((name) => name !== 'alpha')));
      expect(kube().selectedClusterId).toBe(open.length > 1 ? id('beta') : '');
      expect(kube().managedClusterIds).toContain(id('alpha'));

      await release(decide);
      await finish(closing);

      expect(kube().selectedKubeconfigs).toEqual(sels(...open));
      expect(kube().selectedClusterId).toBe(id('alpha'));
    }
  );

  it('restores a refused tab in its place in the tab strip', async () => {
    app.backend.answer('GetClusterTabOrder', () => sels('gamma', 'alpha', 'beta'));
    await start(['alpha', 'beta', 'gamma'], <ClusterTabs />);
    refuseCloses();
    const decide = app.backend.hold('CloseClusterView');

    await clickClose('gamma');
    expect(closeButton('gamma')).toBeNull();
    await release(decide);
    await app.settle();

    expect(tabLabels().filter((label) => label !== 'Global')).toEqual(['gamma', 'alpha', 'beta']);
  });

  it('restores a refused tab, then hides a retried close at once while the backend decides', async () => {
    await start(['alpha', 'beta'], <ClusterTabs />);
    refuseCloses();

    await clickClose('alpha');
    await app.settle();
    expect(closeButton('alpha')).not.toBeNull();

    // The backend accepts the retry; its membership is not read back here.
    app.backend.answer('CloseClusterView', () => true);
    const decide = app.backend.hold('CloseClusterView');
    await clickClose('alpha');

    expect(closeButton('alpha')).toBeNull();
    expect(view.container.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe(
      'beta'
    );
    expect(kube().selectedKubeconfigs).toEqual(sels('beta'));
    await release(decide);
    await app.settle();

    expect(nativeCloses()).toEqual([
      [app.windowName, id('alpha')],
      [app.windowName, id('alpha')],
    ]);
    expect(kube().managedKubeconfigs).toEqual(sels('beta'));
    expect(membershipWrites()).toEqual([]);
  });

  it('closes a tab whose open the backend is still admitting', async () => {
    await start(['alpha']);
    const admit = app.backend.hold('ApplyClusterWorkspace');

    const opening = begin((owner) => owner.openKubeconfig(sel('beta')));
    const closing = begin((owner) => owner.closeKubeconfig(sel('beta')));

    expect(kube().selectedKubeconfigs).toEqual(sels('alpha'));
    expect(kube().selectedClusterId).toBe(id('alpha'));
    await release(admit);
    await finish(opening, closing);

    expect((await backendWorkspace()).selectedKubeconfigs).toEqual(sels('alpha'));
    expect(kube().managedKubeconfigs).toEqual(sels('alpha'));
  });

  it('shares one close per cluster and ignores a close of a tab that is not open', async () => {
    await start(['alpha']);
    const decide = app.backend.hold('CloseClusterView');

    const bySelection = begin((owner) => owner.closeKubeconfig(sel('alpha')));
    const byClusterId = begin((owner) => owner.closeKubeconfig(id('alpha')));
    const notOpen = begin((owner) => owner.closeKubeconfig(sel('beta')));
    await app.settle();

    expect(byClusterId).toBe(bySelection);
    await finish(notOpen);
    expect(nativeCloses()).toEqual([[app.windowName, id('alpha')]]);
    await release(decide);
    await finish(bySelection);
  });

  it('restores a tab whose close fails, reporting once and keeping a newer switch', async () => {
    await start(['alpha', 'beta', 'gamma']);
    const failure = new Error('close failed');
    app.backend.answer('CloseClusterView', () => {
      throw failure;
    });
    const decide = app.backend.hold('CloseClusterView');

    const closing = begin((owner) => owner.closeKubeconfig(sel('alpha')));
    const duplicate = begin((owner) => owner.closeKubeconfig(id('alpha')));
    switchTo('gamma');
    expect(duplicate).toBe(closing);
    expect(kube().selectedKubeconfigs).toEqual(sels('beta', 'gamma'));

    const failed = expect(closing).rejects.toBe(failure);
    await release(decide);
    await act(async () => {
      await failed;
    });
    await app.settle();

    expect(kube().selectedKubeconfigs).toEqual(sels('alpha', 'beta', 'gamma'));
    expect(kube().selectedKubeconfig).toBe(sel('gamma'));
    expect((await backendWorkspace()).selectedKubeconfigs).toEqual(kube().selectedKubeconfigs);
    expect(nativeCloses()).toEqual([[app.windowName, id('alpha')]]);
    expect(app.errors.take((record) => record.context?.context === 'closeKubeconfig')).toEqual([
      expect.objectContaining({ error: failure, kinds: ['toast'] }),
    ]);
  });

  it.each([[['alpha', 'beta'] as Name[]], [['beta', 'alpha'] as Name[]]])(
    'adopts sibling closes without a membership write, whichever the backend answers first (%j)',
    async (order) => {
      await start(['alpha', 'beta', 'gamma']);
      const accept = app.backend.hold('CloseClusterView');

      const closes = order.map((name) => begin((owner) => owner.closeKubeconfig(sel(name))));
      await app.settle();
      expect(nativeCloses()).toHaveLength(2);
      // The backend commits both closes before either answer reaches the window.
      await release(accept);
      await finish(...closes);

      expect(membershipWrites()).toEqual([]);
      expect(kube().managedKubeconfigs).toEqual(sels('gamma'));
      expect((await backendWorkspace()).selectedKubeconfigs).toEqual(sels('gamma'));
    }
  );

  it.each(['admitted', 'opening'] as const)(
    'keeps rapidly closed %s tabs closed while the panel lifecycle follows the switches',
    async (state) => {
      await start(state === 'admitted' ? ['alpha', 'beta', 'gamma'] : ['alpha']);
      const accept = app.backend.hold('CloseClusterView');
      const admit =
        state === 'opening' ? app.backend.hold('ApplyClusterWorkspace') : () => undefined;
      const opens =
        state === 'opening'
          ? (['beta', 'gamma'] as const).map((name) =>
              begin((owner) => owner.openKubeconfig(sel(name)))
            )
          : [];

      const closes = NAMES.map((name) => begin((owner) => owner.closeKubeconfig(sel(name))));
      const settled = Promise.allSettled(closes);
      expect(kube().selectedKubeconfigs).toEqual([]);

      await release(admit);
      await finish(...opens);
      await release(accept);
      await finish(...closes);

      expect(kube().selectedKubeconfigs).toEqual([]);
      expect(kube().managedKubeconfigs).toEqual([]);
      expect((await backendWorkspace()).selectedKubeconfigs).toEqual([]);
      expect(await settled).toEqual(closes.map(() => ({ status: 'fulfilled', value: undefined })));
      expect(nativeCloses()).toHaveLength(3);
    }
  );

  it('keeps the remaining tab active when a later close is accepted first', async () => {
    await start(['alpha', 'beta', 'gamma']);
    // The backend accepts gamma's close while it still decides beta's.
    let acceptBeta!: () => void;
    app.backend.answer('CloseClusterView', (_window, clusterId) =>
      clusterId === id('beta')
        ? new Promise<boolean>((resolve) => {
            acceptBeta = () => resolve(true);
          })
        : true
    );

    const first = begin((owner) => owner.closeKubeconfig(sel('beta')));
    await finish(begin((owner) => owner.closeKubeconfig(sel('gamma'))));

    expect(kube().selectedKubeconfigs).toEqual(sels('alpha'));
    expect(kube().managedClusterIds).toEqual([id('alpha'), id('beta')]);
    expect(kube().selectedClusterId).toBe(id('alpha'));

    await release(acceptBeta);
    await finish(first);

    expect(kube().managedClusterIds).toEqual([id('alpha')]);
    expect(kube().selectedClusterId).toBe(id('alpha'));
    expect(membershipWrites()).toEqual([]);
  });

  it('reopens a tab the user reopened while its close was pending', async () => {
    await start(['alpha', 'beta']);
    const accept = app.backend.hold('CloseClusterView');

    const closing = begin((owner) => owner.closeKubeconfig(sel('alpha')));
    const reopening = begin((owner) => owner.openKubeconfig(sel('alpha')));
    await release(accept);
    await finish(closing, reopening);

    expect(kube().selectedKubeconfigs).toEqual(sels('beta', 'alpha'));
    expect(kube().selectedKubeconfig).toBe(sel('alpha'));
    expect((await backendWorkspace()).selectedKubeconfigs).toEqual(sels('beta', 'alpha'));
  });

  it.each(['close', 'replace'] as const)(
    'honors a final %s made after a reopen queued behind the first close',
    async (how) => {
      await start(['alpha', 'beta']);
      const accept = app.backend.hold('CloseClusterView');

      const closing = begin((owner) => owner.closeKubeconfig(sel('alpha')));
      const reopening = begin((owner) => owner.openKubeconfig(sel('alpha')));
      const final = begin((owner) =>
        how === 'close'
          ? owner.closeKubeconfig(sel('alpha'))
          : owner.setSelectedKubeconfigs(sels('beta'))
      );
      await release(accept);
      await finish(closing, reopening, final);

      expect(kube().selectedKubeconfigs).toEqual(sels('beta'));
      expect((await backendWorkspace()).selectedKubeconfigs).toEqual(sels('beta'));
      expect(nativeCloses()).toHaveLength(1);
    }
  );

  it('keeps a tab switch made after a reopen that waits for the close', async () => {
    await start(['alpha', 'beta']);
    const accept = app.backend.hold('CloseClusterView');

    const closing = begin((owner) => owner.closeKubeconfig(sel('alpha')));
    const reopening = begin((owner) => owner.openKubeconfig(sel('alpha')));
    switchTo('beta');
    await release(accept);
    await finish(closing, reopening);

    expect(kube().selectedKubeconfig).toBe(sel('beta'));
    expect(await backendWorkspace()).toMatchObject({
      selectedKubeconfigs: sels('beta', 'alpha'),
      visibleClusterId: id('beta'),
    });
  });

  it('waits for tab admission before closing and keeps the close through it', async () => {
    await start(['alpha', 'beta']);
    const admit = app.backend.hold('ApplyClusterWorkspace');

    const adding = begin((owner) => owner.setSelectedKubeconfigs(sels('alpha', 'beta', 'gamma')));
    expect(kube().selectedKubeconfigs).toEqual(sels('alpha', 'beta', 'gamma'));
    switchTo('alpha');
    const closing = begin((owner) => owner.closeKubeconfig(sel('alpha')));
    await app.settle();

    expect(nativeCloses()).toEqual([]);
    await release(admit);
    await finish(adding, closing);

    expect(membershipWrites()).toEqual([sels('alpha', 'beta', 'gamma')]);
    expect((await backendWorkspace()).selectedKubeconfigs).toEqual(sels('beta', 'gamma'));
    expect(kube().selectedKubeconfigs).toEqual(sels('beta', 'gamma'));
    expect(kube().selectedKubeconfig).toBe(sel('beta'));
  });

  it('holds only the closing cluster’s requests and resumes them when the close is refused', async () => {
    await start(['alpha', 'beta']);
    refuseCloses();
    let serviceableDuringClose: Record<string, boolean> = {};
    const decide = app.backend.hold('CloseClusterView');

    const closing = begin((owner) => owner.closeKubeconfig(sel('alpha')));
    await app.settle();
    serviceableDuringClose = {
      alpha: clusterReadiness.isServiceable(id('alpha')),
      beta: clusterReadiness.isServiceable(id('beta')),
    };
    await release(decide);
    await finish(closing);

    expect(serviceableDuringClose).toEqual({ alpha: false, beta: true });
    expect(clusterReadiness.isServiceable(id('alpha'))).toBe(true);
    expect(kube().selectedKubeconfigs).toEqual(sels('alpha', 'beta'));
  });

  it('leaves the backend showing no cluster when the last tabs close during a switch', async () => {
    await start(['alpha', 'beta']);
    const workspace = await backendWorkspace();
    let selections = [...(workspace.selectedKubeconfigs ?? [])];
    let shown = workspace.visibleClusterId;
    // The backend applies the switch to beta only after the window has closed every tab.
    let showBeta!: () => void;
    const betaShown = new Promise<void>((resolve) => {
      showBeta = resolve;
    });
    app.backend.answer('ApplyClusterWorkspace', async (command) => {
      if (!command.updateSelectedKubeconfigs && command.visibleClusterId === id('beta')) {
        await betaShown;
      }
      if (command.updateSelectedKubeconfigs) {
        selections = [...(command.selectedKubeconfigs ?? [])];
      }
      shown = command.visibleClusterId;
      return { state: { ...workspace, selectedKubeconfigs: selections, visibleClusterId: shown } };
    });

    switchTo('beta');
    await finish(begin((owner) => owner.setSelectedKubeconfigs([])));
    await release(showBeta);

    expect(kube().selectedKubeconfigs).toEqual([]);
    expect(selections).toEqual([]);
    expect(shown).toBe('');
  });

  it('converges window and backend membership through repeated overlapping tab bursts', async () => {
    await start(['alpha']);

    for (let burst = 0; burst < 10; burst++) {
      const pending = [
        begin((owner) => owner.openKubeconfig(sel('beta'))),
        begin((owner) => owner.openKubeconfig(sel('gamma'))),
        begin((owner) => owner.closeKubeconfig(sel('beta'))),
        begin((owner) => owner.openKubeconfig(sel('beta'))),
      ];
      switchTo('alpha');
      await finish(...pending);

      expect(kube().selectedKubeconfigs).toEqual(sels('alpha', 'gamma', 'beta'));
      expect(await backendWorkspace()).toMatchObject({
        selectedKubeconfigs: kube().selectedKubeconfigs,
        visibleClusterId: id('alpha'),
      });

      await finish(
        begin((owner) => owner.closeKubeconfig(sel('beta'))),
        begin((owner) => owner.closeKubeconfig(sel('gamma')))
      );
      expect(kube().selectedKubeconfigs).toEqual(sels('alpha'));
      expect((await backendWorkspace()).selectedKubeconfigs).toEqual(sels('alpha'));
    }
  });

  it('applies a kubeconfig removal that arrives during a pending close once the close settles', async () => {
    await start(['alpha', 'beta']);
    refuseCloses();
    const decide = app.backend.hold('CloseClusterView');
    const closing = begin((owner) => owner.closeKubeconfig(sel('alpha')));
    await app.settle();

    // beta's kubeconfig context disappears: the backend rediscovers, deselects
    // beta, and announces it (backend/workspace_kubeconfigs.go).
    const workspace = await backendWorkspace();
    const remaining = kube().kubeconfigs.filter((config) => config.context !== 'beta');
    app.backend.answer('GetKubeconfigs', () => ({
      kubeconfigs: remaining,
      state: backend.KubeconfigDiscoveryState.KubeconfigDiscoveryStateAvailable,
      searchPaths: ['/kube'],
    }));
    app.backend.answer('GetClusterWorkspaceStateForWindow', () => ({
      ...workspace,
      selectedKubeconfigs: sels('alpha'),
    }));
    await act(async () => {
      app.events.emit('kubeconfig:available-changed');
    });
    await app.settle();
    expect(kube().managedKubeconfigs).toEqual(sels('alpha', 'beta'));

    await release(decide);
    await finish(closing);

    expect(kube().managedKubeconfigs).toEqual(sels('alpha'));
    expect(kube().selectedKubeconfigs).toEqual(sels('alpha'));
  });

  it('keeps a closed cluster that moves back into the window when another opens', async () => {
    await start(['alpha', 'beta']);
    await finish(begin((owner) => owner.closeKubeconfig(sel('beta'))));

    // Another window moves beta back here; this window refreshes its membership
    // as the tab-transfer coordinator does (ClusterTabTransferCoordinator.tsx).
    const workspace = await backendWorkspace();
    app.backend.answer('GetClusterWorkspaceStateForWindow', () => ({
      ...workspace,
      selectedKubeconfigs: sels('alpha', 'beta'),
    }));
    await finish(begin((owner) => owner.loadKubeconfigs(true)));
    expect(kube().selectedKubeconfigs).toEqual(sels('alpha', 'beta'));

    await finish(begin((owner) => owner.openKubeconfig(sel('gamma'))));

    expect(lastOf(membershipWrites())).toEqual(sels('alpha', 'beta', 'gamma'));
    expect(kube().selectedKubeconfigs).toEqual(sels('alpha', 'beta', 'gamma'));
  });
});
