/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/PodOverview.test.tsx
 *
 * Exercises the Pod Overview through the descriptor-driven renderer (X1).
 */

import { types } from '@wailsjs/go/models';
import type React from 'react';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { podDescriptor } from './descriptors/pod';
import { OverviewRenderer } from './OverviewRenderer';

const openWithObjectMock = vi.fn();
const defaultClusterId = 'alpha:ctx';
const defaultClusterName = 'alpha';

vi.mock('@modules/object-panel/hooks/useObjectPanel', () => ({
  useObjectPanel: () => ({
    openWithObject: openWithObjectMock,
    objectData: { clusterId: defaultClusterId, clusterName: defaultClusterName },
  }),
}));

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

vi.mock('@shared/hooks/useNavigateToView', () => ({
  useNavigateToView: () => ({ navigateToView: vi.fn() }),
}));

describe('PodOverview', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  // Build a PodDetailInfo-shaped DTO from the fields a test cares about. The
  // generated constructor fills the rest from the source object.
  const makeDto = (overrides: Record<string, unknown>): types.PodDetailInfo =>
    types.PodDetailInfo.createFrom(overrides);

  const renderComponent = async (overrides: Record<string, unknown>) => {
    await act(async () => {
      root.render(
        <OverviewRenderer
          descriptor={podDescriptor}
          data={makeDto(overrides)}
          context={{ clusterId: defaultClusterId, clusterName: defaultClusterName }}
        />
      );
      await Promise.resolve();
    });
  };

  const getElementByText = (text: string) =>
    Array.from(container.querySelectorAll<HTMLElement>('*')).find((el) =>
      el.textContent?.trim()?.includes(text)
    );

  const getLinkByText = (text: string) =>
    Array.from(container.querySelectorAll<HTMLElement>('.object-panel-link')).find(
      (el) => el.textContent?.trim() === text
    );

  beforeEach(() => {
    openWithObjectMock.mockReset();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
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

  it('navigates to owner resources when owner link is clicked', async () => {
    await renderComponent({
      name: 'worker-0',
      namespace: 'cluster',
      ownerKind: 'StatefulSet',
      ownerName: 'worker',
    });

    const ownerLink = getLinkByText('StatefulSet/worker') ?? getElementByText('StatefulSet/worker');
    expect(ownerLink).not.toBeUndefined();
    act(() => {
      ownerLink?.click();
    });

    expect(openWithObjectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'statefulset',
        name: 'worker',
        namespace: 'cluster',
        clusterId: defaultClusterId,
      })
    );
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
    act(() => {
      nodeLink?.click();
    });
    expect(openWithObjectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'node',
        name: 'node-b',
        clusterId: defaultClusterId,
      })
    );

    const serviceAccountLink = getLinkByText('cache-sa') ?? getElementByText('cache-sa');
    expect(serviceAccountLink).not.toBeUndefined();
    act(() => {
      serviceAccountLink?.click();
    });
    expect(openWithObjectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'serviceaccount',
        name: 'cache-sa',
        namespace: 'infra',
        clusterId: defaultClusterId,
      })
    );
  });
});
