/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/HelmOverview.test.tsx
 *
 * Opens a Helm release's object panel in the full app: its Overview renders the release from the
 * served detail snapshot, and its managed-resource links take the cluster from the open panel
 * (descriptors/helm.tsx reads CurrentObjectPanelContext). Runs the real app shell, object panel,
 * Details tab, and Overview descriptors; only the backend boundary is faked (test-utils/appState).
 */

import type { helm } from '@core/backend-api/models';
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  makeNamespaceWorkloadSnapshotPayload,
  makePodSnapshotPayload,
} from '@/core/refresh/refreshContractTestBuilders';
import { buildRefreshScope } from '@/core/refresh/scopeSelector';
import {
  installAppStateHarness,
  type MountedApp,
  type TestCluster,
} from '@/test-utils/appState/harness';
import { partialModelFixture } from '@/test-utils/partialModelFixture';

const app = installAppStateHarness();

vi.mock('@shared/components/kubernetes/ResourceHeader', () => ({
  ResourceHeader: (props: { kind: string; name: string }) => (
    <div data-testid="resource-header">
      {props.kind}:{props.name}
    </div>
  ),
}));

vi.mock('@shared/components/kubernetes/ResourceStatus', () => ({
  ResourceStatus: (props: { statusPresentation?: string; status?: string }) => (
    <div data-testid="resource-status" data-presentation={props.statusPresentation}>
      {props.status}
    </div>
  ),
}));

vi.mock('@shared/components/kubernetes/ResourceMetadata', () => ({
  ResourceMetadata: () => <div data-testid="resource-metadata" />,
}));

describe('HelmOverview', () => {
  let dev: TestCluster;
  let view: MountedApp;

  // The release panel the tests open.
  const release = (namespace: string, name: string) =>
    app.object(dev, { group: 'helm.sh', version: 'v3', kind: 'HelmRelease', namespace, name });

  // The managed resource a link opens reads its own details in its new panel.
  const serveDetails = (
    identity: { group: string; version: string; kind: string; namespace: string; name: string },
    detailType: string
  ) =>
    app.servePanel(dev, identity, {
      detailType,
      details: { name: identity.name, namespace: identity.namespace },
    } as never);

  // Opens the release's panel with `details` as its served detail snapshot.
  const openRelease = async (details: Partial<helm.HelmReleaseDetails>) => {
    const { ref } = release(details.namespace ?? '', details.name ?? '');
    const panel = app.servePanel(dev, ref, {
      detailType: 'helmrelease',
      details: partialModelFixture<helm.HelmReleaseDetails>(details),
    } as never);
    view = await app.mountApp();
    await act(async () => {
      view.owners().objectPanel.openWithObject(panel.ref);
    });
    await app.settle();
  };

  const getValueForLabel = (label: string) => {
    const labelElement = Array.from(
      view.container.querySelectorAll<HTMLElement>('.overview-label')
    ).find((el) => el.textContent?.trim() === label);
    return labelElement?.parentElement?.querySelector<HTMLElement>('.overview-value') ?? null;
  };

  const resourceLinks = () =>
    Array.from(view.container.querySelectorAll<HTMLElement>('.metadata-pair .object-panel-link'));

  const click = async (element: HTMLElement | undefined) => {
    await act(async () => {
      element?.click();
    });
    await app.settle();
  };

  beforeEach(() => {
    dev = app.cluster({ name: 'dev', context: 'alpha' });
    app.namespaces(dev, ['default', 'prod']);
    app.startScreen(dev);
  });

  it('renders helm release details and supports navigation to managed resources', async () => {
    const deploymentPanel = serveDetails(
      { group: 'apps', version: 'v1', kind: 'Deployment', namespace: 'prod', name: 'api' },
      'deployment'
    );
    // A Deployment panel also reads its pods, its namespace's workload metrics, and whether an
    // HPA manages it (none does).
    app.backend.answer('IsWorkloadHPAManaged', () => false);
    const cluster = { clusterId: dev.clusterId, clusterName: dev.clusterName };
    app.snapshots.serve(
      'pods',
      deploymentPanel.scopes.podsScope ?? '',
      makePodSnapshotPayload(cluster)
    );
    app.snapshots.serve(
      'namespace-workloads',
      buildRefreshScope('namespace-workloads', {
        clusterId: dev.clusterId,
        selector: { kind: 'namespace', namespace: 'prod' },
      }),
      makeNamespaceWorkloadSnapshotPayload(cluster)
    );
    await openRelease({
      name: 'api-release',
      namespace: 'prod',
      chart: 'api-chart',
      version: '1.2.3',
      appVersion: '2.0.0',
      status: 'Deployed',
      statusPresentation: 'ready',
      revision: 5,
      updated: '2024-01-01T00:00:00Z',
      description: 'Upgrade complete',
      resources: [
        {
          kind: 'Deployment',
          apiVersion: 'apps/v1',
          name: 'api',
          namespace: 'prod',
          scope: 'namespaced',
        },
        {
          kind: 'Service',
          apiVersion: 'v1',
          name: 'api-svc',
          namespace: 'prod',
          scope: 'namespaced',
        },
      ],
      history: [
        { revision: 5, status: 'Deployed', updated: '2024-01-01', chart: 'api-chart-1.2.3' },
        { revision: 4, status: 'Superseded', updated: '2023-12-01', chart: 'api-chart-1.1.0' },
        { revision: 3, status: 'Deployed', updated: '2023-11-01', chart: 'api-chart-1.0.0' },
        { revision: 2, status: 'Failed', updated: '2023-10-01', chart: 'api-chart-0.9.0' },
        { revision: 1, status: 'Deployed', updated: '2023-09-01', chart: 'api-chart-0.8.0' },
        { revision: 0, status: 'Pending', updated: '2023-08-01', chart: 'api-chart-0.7.0' },
      ],
      notes: 'Release notes',
    });

    expect(getValueForLabel('Chart')?.textContent).toBe('api-chart');
    expect(
      view.container
        .querySelector('[data-testid="resource-status"]')
        ?.getAttribute('data-presentation')
    ).toBe('ready');
    expect(getValueForLabel('Chart Version')?.textContent).toBe('1.2.3');
    expect(getValueForLabel('App Version')?.textContent).toBe('2.0.0');
    expect(getValueForLabel('Revision')?.textContent).toBe('5');
    expect(view.container.textContent).toContain('Release notes');
    expect(view.container.textContent).toContain('... and 1 more revision(s)');

    const [deployment] = resourceLinks();
    expect(deployment?.textContent).toBe('prod/api');
    await click(deployment);
    expect(view.openPanels()).toContainEqual({
      clusterId: dev.clusterId,
      clusterName: dev.clusterName,
      group: 'apps',
      version: 'v1',
      kind: 'Deployment',
      namespace: 'prod',
      name: 'api',
    });
  });

  it('falls back to basic props when details are absent', async () => {
    await openRelease({
      name: 'fallback',
      namespace: 'default',
      chart: 'fallback-chart',
      status: 'Pending',
      labels: {},
      annotations: {},
    });

    expect(getValueForLabel('Chart')?.textContent).toBe('fallback-chart');
    expect(view.container.textContent).toContain('Pending');
  });

  it('does not link managed resources whose scope is unknown', async () => {
    serveDetails(
      {
        group: 'rbac.authorization.k8s.io',
        version: 'v1',
        kind: 'ClusterRole',
        namespace: '',
        name: 'reader',
      },
      'clusterrole'
    );
    await openRelease({
      name: 'api-release',
      namespace: 'prod',
      status: 'Deployed',
      resources: [
        {
          kind: 'Database',
          apiVersion: 'databases.example.com/v1alpha1',
          name: 'orders',
          namespace: 'prod',
        },
        {
          kind: 'ClusterRole',
          apiVersion: 'rbac.authorization.k8s.io/v1',
          name: 'reader',
          namespace: '',
          scope: 'cluster',
        },
      ],
    });

    const links = resourceLinks();
    expect(links.map((link) => link.textContent)).toEqual(['reader']);
    await click(links[0]);
    expect(view.openPanels()).toContainEqual({
      clusterId: dev.clusterId,
      clusterName: dev.clusterName,
      group: 'rbac.authorization.k8s.io',
      version: 'v1',
      kind: 'ClusterRole',
      namespace: '',
      name: 'reader',
    });
  });
});
