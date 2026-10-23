/**
 * frontend/src/modules/namespace/components/NsViewHelm.test.tsx
 *
 * The namespace Helm view lists the namespace's Helm releases from the
 * backend's namespace-helm query in the visible cluster, opens a release in
 * its panel with full identity (the synthetic helm.sh/v3 HelmRelease kind),
 * and under All Namespaces lists every namespace's releases with a namespace
 * link back to that namespace's Helm view. Runs in the full app, navigated
 * through the sidebar, over a faked backend (test-utils/appState).
 */

import { act } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { NamespaceHelmSummary } from '@/core/refresh/types';
import {
  installAppStateHarness,
  type MountedApp,
  type TestCluster,
} from '@/test-utils/appState/harness';
import { requireValue } from '@/test-utils/requireValue';

const app = installAppStateHarness();
let dev: TestCluster;
let view: MountedApp;

/** A release row as backend/refresh/snapshot/namespace_helm.go mapHelmRelease projects it. */
const release = (name: string, namespace = 'team-a'): NamespaceHelmSummary => ({
  ref: {
    clusterId: dev.clusterId,
    group: 'helm.sh',
    version: 'v3',
    kind: 'HelmRelease',
    resource: 'releases',
    namespace,
    name,
    uid: `${name}-uid`,
  },
  chart: 'nginx-1.2.3',
  appVersion: '1.25.0',
  status: 'deployed',
  statusPresentation: 'ready',
  revision: 3,
  updated: '2026-10-01T10:00:00Z',
  age: '3d',
});

const releaseIdentity = (name: string, namespace = 'team-a') => ({
  group: 'helm.sh',
  version: 'v3',
  kind: 'HelmRelease',
  namespace,
  name,
});

const start = async (rows: NamespaceHelmSummary[]) => {
  app.startScreen(dev);
  app.serveTable(dev, 'namespace-helm', { rows });
  view = await app.mountApp();
  await view.goTo({ namespace: 'team-a', view: 'helm' });
};

const rowOf = (name: string) =>
  requireValue(
    Array.from(view.container.querySelectorAll<HTMLElement>('.gridtable-row')).find((row) =>
      row.textContent?.includes(name)
    ),
    `expected the ${name} row`
  );

beforeEach(() => {
  dev = app.cluster({ name: 'dev', context: 'alpha' });
  app.namespaces(dev, ['team-a', 'team-b']);
  // The sidebar's Extensions group, where Helm lives, as the user left it open.
  app.preferences({ sidebarNamespaceExtensionsExpanded: true });
});

describe('NsViewHelm', () => {
  it('lists the namespace’s releases from the backend query in the visible cluster', async () => {
    await start([release('web')]);

    const rows = Array.from(view.container.querySelectorAll<HTMLElement>('.gridtable-row'));
    expect(rows.map((row) => row.textContent)).toEqual([expect.stringContaining('web')]);
    const read = requireValue(
      app.snapshots.reads('namespace-helm').slice(-1)[0],
      'expected a namespace-helm read'
    );
    expect(read.scope.startsWith(`${dev.clusterId}|namespace:team-a`)).toBe(true);
  });

  it('opens the focused release in its panel with full identity on Enter', async () => {
    app.servePanel(dev, releaseIdentity('web'));
    await start([release('web')]);
    const table = requireValue(
      view.container.querySelector<HTMLElement>('table[tabindex="0"]'),
      'expected the Helm table'
    );

    await act(async () => table.focus());
    await act(async () => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
      );
    });
    await app.settle();

    expect(view.openPanels()).toEqual([
      { clusterId: dev.clusterId, clusterName: dev.clusterName, ...releaseIdentity('web') },
    ]);
  });

  it('lists every namespace’s releases under All Namespaces and opens a release’s namespace in Helm', async () => {
    await start([release('web'), release('db', 'team-b')]);
    await view.goTo({ namespace: 'namespace:all', view: 'helm' });
    expect(
      Array.from(view.container.querySelectorAll<HTMLElement>('.gridtable-row')).map(
        (row) => row.textContent
      )
    ).toEqual([expect.stringMatching(/web.*team-a/), expect.stringMatching(/db.*team-b/)]);
    expect(
      app.snapshots
        .reads('namespace-helm')
        .some((read) => read.scope.startsWith(`${dev.clusterId}|namespace:all`))
    ).toBe(true);

    const namespaceLink = requireValue(
      Array.from(rowOf('db').querySelectorAll<HTMLButtonElement>('button')).find(
        (button) => button.textContent === 'team-b'
      ),
      'expected the db release’s namespace link'
    );
    await act(async () => namespaceLink.click());
    await app.settle();

    const owners = view.owners();
    expect(owners.namespace.selectedNamespace).toBe('team-b');
    expect(owners.viewState?.viewType).toBe('namespace');
    expect(owners.viewState?.activeNamespaceTab).toBe('helm');
  });
});
