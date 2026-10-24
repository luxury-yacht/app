/**
 * frontend/src/test-utils/appState/harness.isolation.test.tsx
 *
 * Module state survives between tests in one file. These tests reuse the same
 * identities with different boundary answers; each must see only its own
 * answers, in file order and shuffled. A leak here would let later tests pass
 * or fail on an earlier test's state.
 */

import { act } from 'react';
import { describe, expect, it } from 'vitest';
import { useUserPermission } from '@/core/capabilities';
import { useRefreshScopedDomain } from '@/core/refresh';
import { buildClusterRefreshScope } from '@/core/refresh/scopeSelector';
import { getPreference } from '@/core/settings/appPreferences';
import {
  getHelmValuesView,
  setHelmValuesView,
} from '@/modules/object-panel/components/ObjectPanel/Helm/helmValuesViewCache';
import { useObjectPanelRefresh } from '@/modules/object-panel/components/ObjectPanel/hooks/useObjectPanelRefresh';
import { discoverNodeLogs } from '@/modules/object-panel/components/ObjectPanel/NodeLogs/nodeLogsApi';
import { objectPanelId } from '@/modules/object-panel/objectPanelRef';
import {
  getRequestedObjectPanelTab,
  requestObjectPanelTab,
} from '@/modules/object-panel/objectPanelTabRequests';
import {
  peekPendingFocusRequest,
  setPendingFocusRequest,
} from '@/shared/components/tables/hooks/useGridTableExternalFocus';
import { makeErrorStatus } from '@/test-utils/errorStatusFixtures';
import { installAppStateHarness, type MountedApp, type TestCluster } from './harness';

const app = installAppStateHarness();

const namespaceNames = (view: MountedApp) =>
  view
    .owners()
    .namespace.namespaces.filter((namespace) => !namespace.isSynthetic)
    .map((namespace) => namespace.name);

let namespaceUpdatePermission: ReturnType<typeof useUserPermission>;

function NamespaceUpdatePermission({ cluster }: Readonly<{ cluster: TestCluster }>) {
  namespaceUpdatePermission = useUserPermission(
    'Namespace',
    'update',
    null,
    null,
    cluster.clusterId,
    '',
    'v1'
  );
  return null;
}

describe('a reused cluster identity', () => {
  it('lists the namespaces the backend answers', async () => {
    const dev = app.cluster({ name: 'dev', context: 'alpha' });
    app.namespaces(dev, ['team-a']);

    const view = await app.render(null);

    expect(namespaceNames(view)).toEqual(['team-a']);
  });

  it('lists nothing when the backend denies the same cluster’s namespace list', async () => {
    const dev = app.cluster({ name: 'dev', context: 'alpha' });
    const scope = buildClusterRefreshScope('namespaces', dev.clusterId);
    const forbidden = makeErrorStatus('Forbidden', 'namespaces is forbidden');
    app.snapshots.fail('namespaces', scope, forbidden);
    app.snapshots.fail('namespace-metrics', scope, forbidden);

    const view = await app.render(null);

    expect(view.owners().namespace.namespacesPermissionDenied).toBe(true);
    expect(namespaceNames(view)).toEqual([]);
  });

  it('allows namespace updates the backend allows', async () => {
    const dev = app.cluster({ name: 'dev', context: 'alpha' });
    app.namespaces(dev, ['team-a']);

    await app.render(<NamespaceUpdatePermission cluster={dev} />);

    expect(namespaceUpdatePermission?.allowed).toBe(true);
  });

  it('refuses namespace updates when the backend denies them for the same cluster', async () => {
    const dev = app.cluster({ name: 'dev', context: 'alpha' });
    app.namespaces(dev, ['team-a']);
    app.denyPermissions([{ verb: 'update', resourceKind: 'Namespace' }]);

    await app.render(<NamespaceUpdatePermission cluster={dev} />);

    expect(namespaceUpdatePermission?.pending).toBe(false);
    expect(namespaceUpdatePermission?.allowed).toBe(false);
  });

  it('opens both clusters the workspace selects', async () => {
    const alpha = app.cluster({ name: 'dev', context: 'alpha' });
    const beta = app.cluster({ name: 'dev', context: 'beta' });
    app.namespaces(alpha, ['team-a']);
    app.namespaces(beta, ['team-b']);

    const view = await app.render(null);

    expect(view.owners().kubeconfig.selectedClusterIds).toEqual([alpha.clusterId, beta.clusterId]);
  });

  it('opens only the cluster the workspace selects when the same cluster opens alone', async () => {
    const alpha = app.cluster({ name: 'dev', context: 'alpha' });
    app.cluster({ name: 'dev', context: 'beta', open: false });
    app.namespaces(alpha, ['team-a']);

    const view = await app.render(null);

    expect(view.owners().kubeconfig.selectedClusterIds).toEqual([alpha.clusterId]);
  });
});

// The refresh layer reports a scope's failure once until a read succeeds; a
// later test failing the same way must still get its report.
describe('a reused failing scope', () => {
  const namespaceListReports = async () => {
    const dev = app.cluster({ name: 'dev', context: 'alpha' });
    const scope = buildClusterRefreshScope('namespaces', dev.clusterId);
    const timeout = makeErrorStatus('ServerTimeout', 'apiserver timeout');
    app.snapshots.fail('namespaces', scope, timeout);
    app.snapshots.fail('namespace-metrics', scope, timeout);
    await app.render(null);
    return app.errors
      .take((record) => record.context?.source === 'refresh-orchestrator')
      .filter((record) => record.context?.domain === 'namespaces');
  };

  it('reports the namespace list failure', async () => {
    expect(await namespaceListReports()).toHaveLength(1);
  });

  it('reports the same failure of the same cluster again', async () => {
    expect(await namespaceListReports()).toHaveLength(1);
  });
});

let shownReplicas: unknown;

function OpenDetails({ detailScope }: Readonly<{ detailScope: string }>) {
  useObjectPanelRefresh({ detailScope, isOpen: true, resourceDeleted: false });
  const details = useRefreshScopedDomain('object-details', detailScope);
  shownReplicas = (details.data as { details?: { replicas?: number } } | null)?.details?.replicas;
  return null;
}

describe('a reused object identity', () => {
  const identity = {
    group: 'apps',
    version: 'v1',
    kind: 'Deployment',
    namespace: 'team-a',
    name: 'api',
  };

  const showDetails = async (replicas: number) => {
    const dev = app.cluster({ name: 'dev', context: 'alpha' });
    app.namespaces(dev, ['team-a']);
    const api = app.object(dev, identity);
    const detailScope = api.scopes.detailScope ?? '';
    app.snapshots.serve('object-details', detailScope, {
      kind: 'Deployment',
      details: { replicas },
    } as never);
    const view = await app.render(null);
    await view.show(<OpenDetails detailScope={detailScope} />);
  };

  it('shows the details the backend answers for one replica', async () => {
    await showDetails(1);

    expect(shownReplicas).toBe(1);
  });

  it('shows the details the backend answers for three replicas of the same object', async () => {
    await showDetails(3);

    expect(shownReplicas).toBe(3);
  });
});

describe('a reused window', () => {
  it('starts paused when auto-refresh was persisted off', async () => {
    app.preferences({ autoRefreshEnabled: false });

    await app.render(null);

    expect(getPreference('autoRefreshEnabled')).toBe(false);
  });

  it('starts refreshing when the same window has no persisted pause', async () => {
    await app.render(null);

    expect(getPreference('autoRefreshEnabled')).toBe(true);
  });
});

describe('a reused panel-window transfer', () => {
  const openPanelWindow = async () => {
    const dev = app.cluster({ name: 'dev', context: 'alpha' });
    app.namespaces(dev, ['team-a']);
    app.panelWindow(dev, { transferId: 't-1' });
    await app.render(null);
  };

  it('acknowledges the window ready for its transfer', async () => {
    await openPanelWindow();

    expect(app.backend.calls('AcknowledgePanelWindowReady')).toEqual([['panel-1', 't-1']]);
  });

  it('acknowledges again when a new window opens for the same transfer id', async () => {
    await openPanelWindow();

    expect(app.backend.calls('AcknowledgePanelWindowReady')).toEqual([['panel-1', 't-1']]);
  });
});

describe('a reused panel publication queue', () => {
  const podRef = (cluster: TestCluster) => ({
    clusterId: cluster.clusterId,
    group: '',
    version: 'v1',
    kind: 'Pod',
    namespace: 'default',
    name: 'pod',
  });

  it('reports a panel close the backend refuses', async () => {
    const dev = app.cluster({ name: 'dev', context: 'alpha' });
    app.namespaces(dev, ['default']);
    app.backend.answer('ClosePanelWorkspaceObject', () => {
      throw new Error('close refused');
    });
    const view = await app.render(null);
    await act(async () => {
      view.owners().objectPanel.openWithObject(podRef(dev));
    });
    await app.settle();

    await act(async () => {
      view.owners().objectPanels.closePanel(dev.clusterId, objectPanelId(podRef(dev)));
    });
    await app.settle();

    expect(
      app.errors
        .take((record) => record.kinds.includes('operational'))
        .map(({ context }) => context?.action)
    ).toEqual(['close-panel']);
  });

  it('retries no earlier close when the same window flushes before closing', async () => {
    const dev = app.cluster({ name: 'dev', context: 'alpha' });
    app.namespaces(dev, ['default']);
    app.backend.answer('AcknowledgeWorkspaceWindowClose', () => undefined);
    await app.render(null);

    await act(async () => {
      app.events.emit(
        'workspace-window:close-requested',
        { windowName: app.windowName },
        { sender: app.windowName }
      );
    });
    await app.settle();

    expect(app.backend.calls('AcknowledgeWorkspaceWindowClose')).toEqual([[app.windowName]]);
    expect(app.backend.calls('ClosePanelWorkspaceObject')).toEqual([]);
  });
});

describe('a reused Helm release panel', () => {
  const releasePanelId = () => {
    const dev = app.cluster({ name: 'dev', context: 'alpha' });
    return objectPanelId({
      clusterId: dev.clusterId,
      group: 'helm.sh',
      version: 'v3',
      kind: 'HelmRelease',
      namespace: 'team-a',
      name: 'my-app',
    });
  };

  it('remembers the values view the user picked for the release', () => {
    setHelmValuesView(releasePanelId(), 'merged');

    expect(getHelmValuesView(releasePanelId())).toBe('merged');
  });

  it('starts the same release on the default values view', () => {
    expect(getHelmValuesView(releasePanelId())).toBeUndefined();
  });
});

describe('a reused object panel’s tab request', () => {
  const podPanelId = () => {
    const dev = app.cluster({ name: 'dev', context: 'alpha' });
    return objectPanelId({
      clusterId: dev.clusterId,
      group: '',
      version: 'v1',
      kind: 'Pod',
      namespace: 'team-a',
      name: 'api',
    });
  };

  it('holds the shell tab a session asks for until the panel opens', () => {
    requestObjectPanelTab(podPanelId(), 'shell');

    expect(getRequestedObjectPanelTab(podPanelId())).toBe('shell');
  });

  it('holds no tab request for the same panel when nothing asked', () => {
    expect(getRequestedObjectPanelTab(podPanelId())).toBeUndefined();
  });
});

describe('a reused node', () => {
  const discover = async (supported: boolean) => {
    const dev = app.cluster({ name: 'dev', context: 'alpha' });
    app.namespaces(dev, ['default']);
    app.backend.answer('DiscoverNodeLogs', () => ({
      supported,
      sources: supported
        ? [{ id: 'journal', label: 'Journal', kind: 'journal', path: 'journal' }]
        : [],
      reason: supported ? '' : 'node log query is not enabled',
    }));
    await app.render(null);
    return discoverNodeLogs(dev.clusterId, 'worker-1');
  };

  it('discovers the log sources the backend reports for the node', async () => {
    expect((await discover(true)).supported).toBe(true);
  });

  it('discovers again when the same node reports no log sources', async () => {
    expect((await discover(false)).supported).toBe(false);
  });
});

describe('a reused navigation target', () => {
  const podRequest = () => {
    const dev = app.cluster({ name: 'dev', context: 'alpha' });
    return {
      clusterId: dev.clusterId,
      group: '',
      version: 'v1',
      kind: 'Pod',
      namespace: 'team-a',
      name: 'api',
      destinationViewId: 'namespace-pods',
    };
  };

  it('holds the row a navigation asked to reveal until a table shows it', () => {
    setPendingFocusRequest(podRequest());

    expect(peekPendingFocusRequest()).toEqual(podRequest());
  });

  it('holds no reveal for the same row when nothing navigated', () => {
    podRequest();

    expect(peekPendingFocusRequest()).toBeNull();
  });
});
