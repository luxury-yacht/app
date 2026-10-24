/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/PodOverview.test.tsx
 *
 * Exercises the Pod Overview through the descriptor-driven renderer (X1),
 * inside the real app shell: related-object links open panels through the
 * real panel owners (test-utils/appState).
 */

import type { types } from '@core/backend-api/models';
import type React from 'react';
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  installAppStateHarness,
  type MountedApp,
  type TestCluster,
} from '@/test-utils/appState/harness';
import { partialModelFixture } from '@/test-utils/partialModelFixture';
import { buildObjectPanelPodsSelector } from '../../Pods/objectPanelPodsScope';
import { podDescriptor } from './descriptors/pod';
import { OverviewRenderer } from './OverviewRenderer';

const app = installAppStateHarness();

vi.mock('@shared/components/kubernetes/ResourceHeader', () => ({
  ResourceHeader: (props: { kind: string; name: string }) => (
    <div data-testid="resource-header">
      {props.kind}:{props.name}
    </div>
  ),
}));

vi.mock('@shared/components/kubernetes/ResourceStatus', () => ({
  ResourceStatus: (props: {
    statusState?: string;
    statusPresentation?: string;
    status?: string;
    ready?: string;
  }) => (
    <div
      data-testid="resource-status"
      data-state={props.statusState}
      data-presentation={props.statusPresentation}
    >
      {props.status ?? props.ready}
    </div>
  ),
}));

vi.mock('@shared/components/Tooltip', () => ({
  __esModule: true,
  default: ({ children }: React.PropsWithChildren) => <>{children}</>,
}));

vi.mock('@shared/components/kubernetes/ResourceMetadata', () => ({
  ResourceMetadata: () => <div data-testid="resource-metadata" />,
}));

describe('PodOverview', () => {
  let view: MountedApp;
  let dev: TestCluster;
  let container: HTMLElement;

  // Build a PodDetailInfo-shaped DTO from the fields a test cares about. The
  // generated constructor fills the rest from the source object.
  const makeDto = (overrides: Record<string, unknown>): types.PodDetailInfo =>
    partialModelFixture<types.PodDetailInfo>(overrides);

  const renderComponent = async (overrides: Record<string, unknown>) => {
    await view.show(
      <OverviewRenderer
        descriptor={podDescriptor}
        data={makeDto(overrides)}
        context={{ clusterId: dev.clusterId, clusterName: dev.clusterName }}
      />
    );
  };

  const click = async (element: HTMLElement | undefined) => {
    await act(async () => {
      element?.click();
    });
    await app.settle();
  };

  const getElementByText = (text: string) =>
    Array.from(container.querySelectorAll<HTMLElement>('*')).find((el) =>
      el.textContent?.trim()?.includes(text)
    );

  const getLinkByText = (text: string) =>
    Array.from(container.querySelectorAll<HTMLElement>('.object-panel-link')).find(
      (el) => el.textContent?.trim() === text
    );

  beforeEach(async () => {
    dev = app.cluster({ name: 'dev', context: 'alpha' });
    app.namespaces(dev, ['default', 'cluster', 'infra']);
    view = await app.render(null);
    container = view.container;
  });

  it('renders restart badge, QoS information, and host network warning when applicable', async () => {
    await renderComponent({
      name: 'web-1',
      namespace: 'default',
      status: 'Running',
      statusState: 'Running',
      statusPresentation: 'warning',
      ready: '1/1',
      restarts: 3,
      qosClass: 'Guaranteed',
      hostNetwork: true,
      node: 'node-a',
      nodeIP: '10.0.0.10',
      podIP: '172.16.0.5',
    });

    expect(container.textContent).toContain('Restarts');
    const restartBadge = container.querySelector('.status-text.warning');
    expect(restartBadge?.textContent?.trim()).toBe('3');
    expect(container.textContent).toContain('QoS');
    expect(container.textContent).toContain('Guaranteed');
    const resourceStatus = container.querySelector('[data-testid="resource-status"]');
    expect(resourceStatus?.getAttribute('data-state')).toBe('Running');
    expect(resourceStatus?.getAttribute('data-presentation')).toBe('warning');
    // Host networking renders as a "Host" row containing a Network chip.
    expect(container.textContent).toContain('Host');
    const hostNetworkChip = Array.from(
      container.querySelectorAll<HTMLElement>('.status-chip--warning')
    ).find((el) => el.textContent?.trim() === 'Network');
    expect(hostNetworkChip).toBeTruthy();
  });

  it('preserves the owner GVK needed by the owner panel Pods scope', async () => {
    await renderComponent({
      name: 'worker-0',
      namespace: 'cluster',
      ownerKind: 'StatefulSet',
      ownerName: 'worker',
      ownerApiVersion: 'apps/v1',
    });

    const ownerLink = getLinkByText('StatefulSet/worker') ?? getElementByText('StatefulSet/worker');
    expect(ownerLink).not.toBeUndefined();
    await click(ownerLink);

    const ownerPanel = {
      clusterId: dev.clusterId,
      clusterName: dev.clusterName,
      group: 'apps',
      version: 'v1',
      kind: 'StatefulSet',
      namespace: 'cluster',
      name: 'worker',
    };
    expect(view.openPanels()).toEqual([ownerPanel]);
    expect(buildObjectPanelPodsSelector(ownerPanel)).toEqual({
      kind: 'workload',
      object: {
        namespace: 'cluster',
        group: 'apps',
        version: 'v1',
        kind: 'StatefulSet',
        name: 'worker',
      },
    });
  });

  it('navigates to related resources for node and service account links', async () => {
    await renderComponent({
      name: 'cache-0',
      namespace: 'infra',
      node: 'node-b',
      serviceAccount: 'cache-sa',
    });

    const nodeLink = getLinkByText('node-b') ?? getElementByText('node-b');
    expect(nodeLink).not.toBeUndefined();
    await click(nodeLink);

    const serviceAccountLink = getLinkByText('cache-sa') ?? getElementByText('cache-sa');
    expect(serviceAccountLink).not.toBeUndefined();
    await click(serviceAccountLink);

    // The links spell the kinds in lowercase; panels take the registry's spelling.
    const cluster = { clusterId: dev.clusterId, clusterName: dev.clusterName };
    expect(view.openPanels()).toEqual([
      { ...cluster, group: '', version: 'v1', kind: 'Node', namespace: '', name: 'node-b' },
      {
        ...cluster,
        group: '',
        version: 'v1',
        kind: 'ServiceAccount',
        namespace: 'infra',
        name: 'cache-sa',
      },
    ]);
  });
});
