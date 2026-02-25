/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/PodOverview.test.tsx
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PodOverview } from './PodOverview';

const openWithObjectMock = vi.fn();
const defaultClusterId = 'alpha:ctx';

vi.mock('@modules/object-panel/hooks/useObjectPanel', () => ({
  useObjectPanel: () => ({
    openWithObject: openWithObjectMock,
    objectData: { clusterId: defaultClusterId, clusterName: 'alpha' },
  }),
}));

vi.mock('@shared/components/kubernetes/ResourceHeader', () => ({
  ResourceHeader: (props: any) => (
    <div data-testid="resource-header">
      {props.kind}:{props.name}
    </div>
  ),
}));

vi.mock('@shared/components/kubernetes/ResourceStatus', () => ({
  ResourceStatus: (props: any) => (
    <div data-testid="resource-status">{props.status ?? props.ready}</div>
  ),
}));

vi.mock('@shared/components/kubernetes/ResourceMetadata', () => ({
  ResourceMetadata: () => <div data-testid="resource-metadata" />,
}));

describe('PodOverview', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  const renderComponent = async (props: React.ComponentProps<typeof PodOverview>) => {
    await act(async () => {
      root.render(<PodOverview {...props} />);
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
      age: '10m',
      status: 'Running',
      statusSeverity: 'info',
      ready: '1/1',
      restarts: 3,
      qosClass: 'Guaranteed',
      hostNetwork: true,
      node: 'node-a',
      nodeIP: '10.0.0.10',
      podIP: '172.16.0.5',
    });

    expect(container.textContent).toContain('Restarts');
    const restartBadge = container.querySelector('.status-badge.warning');
    expect(restartBadge?.textContent?.trim()).toBe('3');
    expect(container.textContent).toContain('QoS');
    expect(container.textContent).toContain('Guaranteed');
    expect(container.textContent).toContain('Host Network');
  });

  it('navigates to owner resources when owner link is clicked', async () => {
    await renderComponent({
      name: 'worker-0',
      namespace: 'cluster',
      age: '5m',
      owner: { kind: 'StatefulSet', name: 'worker' },
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
      age: '2h',
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
