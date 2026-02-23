/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/WorkloadOverview.test.tsx
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WorkloadOverview } from './WorkloadOverview';

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
    <div data-testid="resource-status">{props.ready ?? props.status}</div>
  ),
}));

vi.mock('@shared/components/kubernetes/ResourceMetadata', () => ({
  ResourceMetadata: () => <div data-testid="resource-metadata" />,
}));

describe('WorkloadOverview', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  const renderComponent = async (props: React.ComponentProps<typeof WorkloadOverview>) => {
    await act(async () => {
      root.render(<WorkloadOverview {...props} />);
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

  it('renders deployment-specific status and configuration details', async () => {
    await renderComponent({
      kind: 'Deployment',
      name: 'frontend',
      namespace: 'default',
      age: '5m',
      ready: '1/3',
      replicas: '3',
      upToDate: 2,
      available: 1,
      paused: true,
      rolloutStatus: 'Degraded',
      rolloutMessage: 'Progress deadline exceeded',
      strategy: 'RollingUpdate',
      maxSurge: '50%',
      maxUnavailable: '25%',
      minReadySeconds: 30,
      progressDeadline: 120,
      revisionHistory: 5,
      selector: { app: 'frontend' },
    });

    expect(container.textContent).toContain('Replicas');
    expect(container.textContent).toContain('3');
    expect(container.textContent).toContain('Up-to-date');
    expect(container.textContent).toContain('Available');
    expect(container.textContent).toContain('Paused');
    expect(container.textContent).toContain('Rollout Status');
    expect(container.textContent).toContain('Degraded');
    expect(container.textContent).toContain('Progress deadline exceeded');
    expect(container.textContent).toContain('Rolling (max surge: 50%, max unavailable: 25%)');
    expect(container.textContent).toContain('Min Ready');
    expect(container.textContent).toContain('30s');
    expect(container.textContent).toContain('Deadline');
    expect(container.textContent).toContain('120s');
    expect(container.textContent).toContain('History Limit');
    expect(container.textContent).toContain('5');
  });

  it('omits rollout details when the deployment is effectively complete', async () => {
    await renderComponent({
      kind: 'Deployment',
      name: 'api',
      age: '2h',
      strategy: 'RollingUpdate',
      rolloutStatus: 'progressing',
      rolloutMessage: 'Deployment successfully progressed',
    });

    expect(getElementByText('Rollout Status')).toBeUndefined();
    expect(getElementByText('Message')).toBeUndefined();
  });

  it('renders daemonset fields and highlights misscheduled pods', async () => {
    await renderComponent({
      kind: 'DaemonSet',
      name: 'logs-agent',
      age: '1d',
      desired: 10,
      current: 9,
      updateStrategy: 'RollingUpdate',
      maxUnavailable: '10%',
      numberMisscheduled: 2,
    });

    expect(container.textContent).toContain('Desired');
    expect(container.textContent).toContain('10');
    expect(container.textContent).toContain('Current');
    expect(container.textContent).toContain('9');
    expect(container.textContent).toContain('Rolling (max unavailable: 10%)');
    expect(container.textContent).toContain('Misscheduled');
    expect(container.textContent).toContain('2');
  });

  it('renders replicaset replica and availability details', async () => {
    await renderComponent({
      kind: 'ReplicaSet',
      name: 'web-rs',
      age: '45m',
      replicas: '2/3',
      available: 2,
      minReadySeconds: 10,
    });

    expect(container.textContent).toContain('Replicas');
    expect(container.textContent).toContain('2/3');
    expect(container.textContent).toContain('Available');
    expect(container.textContent).toContain('2');
    expect(container.textContent).toContain('Min Ready');
    expect(container.textContent).toContain('10s');
  });

  it('renders statefulset service link and invokes navigation on click', async () => {
    await renderComponent({
      kind: 'StatefulSet',
      name: 'db',
      namespace: 'data',
      age: '3h',
      serviceName: 'db-primary',
      updateStrategy: 'RollingUpdate',
      maxUnavailable: '1',
      podManagementPolicy: 'Parallel',
      minReadySeconds: 15,
    });

    const serviceLink = getLinkByText('db-primary') ?? getElementByText('db-primary');
    expect(serviceLink).not.toBeUndefined();
    act(() => {
      serviceLink?.click();
    });

    expect(openWithObjectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'Service',
        name: 'db-primary',
        namespace: 'data',
        clusterId: defaultClusterId,
      })
    );
    expect(container.textContent).toContain('Pod Management');
    expect(container.textContent).toContain('Parallel');
    expect(container.textContent).toContain('Min Ready');
    expect(container.textContent).toContain('15s');
  });
});
