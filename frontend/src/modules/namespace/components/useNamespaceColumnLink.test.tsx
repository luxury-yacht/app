/**
 * frontend/src/modules/namespace/components/useNamespaceColumnLink.test.tsx
 *
 * The Namespace column link shared by resource tables: clicking a row's
 * namespace selects that namespace in the row's cluster and opens the
 * consumer's namespace view, with the sidebar following. Runs inside the
 * production shell with the real kubeconfig, view-state, sidebar, and
 * namespace owners over a faked backend (test-utils/appState).
 */

import { useNamespaceColumnLink } from '@modules/namespace/components/useNamespaceColumnLink';
import { act } from 'react';
import { describe, expect, it } from 'vitest';
import {
  installAppStateHarness,
  type MountedApp,
  type TestCluster,
} from '@/test-utils/appState/harness';
import { makeResourceRef } from '@/test-utils/makeResourceRef';
import { requireValue } from '@/test-utils/requireValue';

const app = installAppStateHarness();

type Row = { ref: ReturnType<typeof makeResourceRef>; objectNamespace?: string };

let link: ReturnType<typeof useNamespaceColumnLink<Row>> | undefined;

function DefaultLink() {
  link = useNamespaceColumnLink<Row>('autoscaling');
  return null;
}

// The accessor NsViewEvents passes: an event links to its involved object's namespace.
const involvedObjectNamespace = (row: Row) => row.objectNamespace || row.ref.namespace;
function EventsLink() {
  link = useNamespaceColumnLink<Row>('events', involvedObjectNamespace);
  return null;
}

const rowIn = (cluster: TestCluster, namespace: string, objectNamespace?: string): Row => ({
  ref: makeResourceRef({
    clusterId: cluster.clusterId,
    kind: 'Event',
    resource: 'events',
    namespace,
    name: 'event-1',
  }),
  objectNamespace,
});

const start = async (probe: React.ReactNode) => {
  const dev = app.cluster({ name: 'dev', context: 'alpha' });
  app.namespaces(dev, ['team-a', 'team-b']);
  const view = await app.render(null);
  await view.show(probe);
  return { dev, view };
};

const click = async (row: Row) => {
  await act(async () => {
    requireValue(link, 'mounted namespace link').onClick(row);
  });
  await app.settle();
};

const navigation = (view: MountedApp) => {
  const { namespace, viewState } = view.owners();
  return {
    namespace: namespace.selectedNamespace,
    clusterId: namespace.selectedNamespaceClusterId,
    view: viewState?.viewType,
    tab: viewState?.activeNamespaceTab,
    sidebar: viewState?.sidebarSelection,
  };
};

describe('useNamespaceColumnLink', () => {
  it('opens the consumer’s view of the clicked row’s namespace in the row’s cluster', async () => {
    const { dev, view } = await start(<DefaultLink />);

    await click(rowIn(dev, 'team-a'));

    expect(navigation(view)).toEqual({
      namespace: 'team-a',
      clusterId: dev.clusterId,
      view: 'namespace',
      tab: 'autoscaling',
      sidebar: { type: 'namespace', value: 'team-a' },
    });
  });

  it('opens the namespace the consumer’s accessor names instead of the row’s own', async () => {
    const { dev, view } = await start(<EventsLink />);

    await click(rowIn(dev, 'team-a', 'team-b'));

    expect(navigation(view)).toEqual({
      namespace: 'team-b',
      clusterId: dev.clusterId,
      view: 'namespace',
      tab: 'events',
      sidebar: { type: 'namespace', value: 'team-b' },
    });
  });
});
