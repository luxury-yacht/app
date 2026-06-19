/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/WorkloadOverview.test.tsx
 *
 * Behavioural coverage for the workload Overview descriptors (X1). Each case renders the
 * descriptor-driven OverviewRenderer with a RAW per-kind DTO and the panel context, exercising the
 * same presentation the legacy WorkloadOverview component produced. Values are read straight off the
 * DTO (e.g. pod counts come from podMetricsSummary.pods); the hpaManaged flag is threaded through
 * `context`, not the DTO.
 */

import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { daemonset, deployment, replicaset, statefulset } from '@wailsjs/go/models';
import { OverviewRenderer } from './OverviewRenderer';
import type { OverviewContext, OverviewDescriptor } from './schema';
import {
  daemonSetDescriptor,
  deploymentDescriptor,
  replicaSetDescriptor,
  statefulSetDescriptor,
} from './descriptors/workload';

const openWithObjectMock = vi.fn();
const defaultClusterId = 'alpha:ctx';
const defaultClusterName = 'alpha';

vi.mock('@modules/object-panel/hooks/useObjectPanel', () => ({
  useObjectPanel: () => ({
    openWithObject: openWithObjectMock,
    objectData: { clusterId: defaultClusterId, clusterName: defaultClusterName },
  }),
}));

vi.mock('@shared/components/Tooltip', () => ({
  __esModule: true,
  default: ({ children }: any) => <>{children}</>,
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
    <div
      data-testid="resource-status"
      data-state={props.statusState}
      data-presentation={props.statusPresentation}
    >
      {props.ready ?? props.status}
    </div>
  ),
}));

vi.mock('@shared/components/kubernetes/ResourceMetadata', () => ({
  ResourceMetadata: () => <div data-testid="resource-metadata" />,
}));

vi.mock('@shared/hooks/useNavigateToView', () => ({
  useNavigateToView: () => ({ navigateToView: vi.fn() }),
}));

describe('WorkloadOverview', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  const defaultContext: OverviewContext = {
    clusterId: defaultClusterId,
    clusterName: defaultClusterName,
  };

  const renderDescriptor = async <T,>(
    descriptor: OverviewDescriptor<T>,
    data: T,
    context: OverviewContext = defaultContext
  ) => {
    await act(async () => {
      root.render(<OverviewRenderer descriptor={descriptor} data={data} context={context} />);
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
    await renderDescriptor(
      deploymentDescriptor,
      new deployment.DeploymentDetails({
        kind: 'Deployment',
        name: 'frontend',
        namespace: 'default',
        ready: '1/3',
        replicas: '3/3',
        desiredReplicas: 3,
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
        currentReplicaSet: 'frontend-abc123',
        currentRevision: '7',
        selector: { app: 'frontend' },
      })
    );

    // Pod-state bar replaces the Replicas / Up-to-date / Available rows.
    expect(container.textContent).toContain('Pods');
    expect(container.textContent).toContain('1 of 3 available');
    // Up-to-date row only renders when upToDate < created — here 2 < 3.
    expect(container.textContent).toContain('Up-to-date');
    expect(container.textContent).toContain('2 of 3');
    expect(container.textContent).toContain('Paused');
    expect(container.textContent).toContain('Rollout Status');
    expect(container.textContent).toContain('Degraded');
    expect(container.textContent).toContain('Progress deadline exceeded');
    // Strategy renders as a chip + mono params now.
    expect(container.textContent).toContain('RollingUpdate');
    expect(container.textContent).toContain('surge 50%');
    expect(container.textContent).toContain('unavailable 25%');
    expect(container.textContent).toContain('Min Ready');
    expect(container.textContent).toContain('30s');
    expect(container.textContent).toContain('Deadline');
    expect(container.textContent).toContain('120s');
    // ReplicaSet block — current RS link + non-default history-limit chip.
    expect(container.textContent).toContain('frontend-abc123');
    expect(container.textContent).toContain('Limit 5');
  });

  it('renders backend workload status presentation', async () => {
    await renderDescriptor(
      deploymentDescriptor,
      new deployment.DeploymentDetails({
        kind: 'Deployment',
        name: 'frontend',
        namespace: 'default',
        status: 'Updating',
        statusState: '1/3',
        statusPresentation: 'warning',
        ready: '1/3',
        replicas: '3/3',
        desiredReplicas: 3,
        available: 1,
      })
    );

    const status = container.querySelector('[data-testid="resource-status"]');
    expect(status?.textContent).toBe('Updating');
    expect(status?.getAttribute('data-state')).toBe('1/3');
    expect(status?.getAttribute('data-presentation')).toBe('warning');
  });

  it('uses owned pod summary counts for the pod-state bar', async () => {
    await renderDescriptor(
      deploymentDescriptor,
      new deployment.DeploymentDetails({
        kind: 'Deployment',
        name: 'frontend',
        namespace: 'default',
        ready: '3/3',
        replicas: '3/3',
        desiredReplicas: 3,
        available: 3,
        // podCount -> podMetricsSummary.pods, readyPodCount -> podMetricsSummary.readyPods.
        podMetricsSummary: { pods: 4, readyPods: 3 },
      })
    );

    expect(container.textContent).toContain('Pods');
    expect(container.textContent).toContain('3 of 4 ready');
    expect(container.textContent).toContain('1 not ready');
  });

  it('omits rollout details when the deployment is effectively complete', async () => {
    await renderDescriptor(
      deploymentDescriptor,
      new deployment.DeploymentDetails({
        kind: 'Deployment',
        name: 'api',
        strategy: 'RollingUpdate',
        rolloutStatus: 'progressing',
        rolloutMessage: 'Deployment successfully progressed',
      })
    );

    expect(getElementByText('Rollout Status')).toBeUndefined();
    expect(getElementByText('Message')).toBeUndefined();
  });

  it('renders daemonset pod-state bar and highlights misscheduled pods', async () => {
    await renderDescriptor(
      daemonSetDescriptor,
      new daemonset.DaemonSetDetails({
        kind: 'DaemonSet',
        name: 'logs-agent',
        ready: 8,
        desired: 10,
        current: 9,
        available: 8,
        updateStrategy: 'RollingUpdate',
        maxUnavailable: '10%',
        numberMisscheduled: 2,
      })
    );

    // Pod-state bar replaces Desired/Current rows.
    expect(container.textContent).toContain('Pods');
    expect(container.textContent).toContain('8 of 10 available');
    // 1 unscheduled (10 desired - 9 current).
    expect(container.textContent).toContain('1 unscheduled');
    // DaemonSet strategy renders as chip + surge/unavailable params (matching Deployment).
    expect(container.textContent).toContain('RollingUpdate');
    expect(container.textContent).toContain('surge 0 / unavailable 10%');
    expect(container.textContent).toContain('Misscheduled');
    expect(container.textContent).toContain('2');
  });

  it('renders replicaset pod-state bar and min-ready', async () => {
    await renderDescriptor(
      replicaSetDescriptor,
      new replicaset.ReplicaSetDetails({
        kind: 'ReplicaSet',
        name: 'web-rs',
        ready: '2/2',
        replicas: '2/3',
        desiredReplicas: 3,
        available: 2,
        minReadySeconds: 10,
      })
    );

    // Pod-state bar replaces the Replicas/Available rows.
    expect(container.textContent).toContain('Pods');
    expect(container.textContent).toContain('2 of 3 available');
    expect(container.textContent).toContain('1 unscheduled');
    expect(container.textContent).toContain('Min Ready');
    expect(container.textContent).toContain('10s');
  });

  it('renders statefulset service-account link and invokes navigation on click', async () => {
    await renderDescriptor(
      statefulSetDescriptor,
      new statefulset.StatefulSetDetails({
        kind: 'StatefulSet',
        name: 'db',
        namespace: 'data',
        serviceAccount: 'db-sa',
        updateStrategy: 'RollingUpdate',
        maxUnavailable: '1',
        podManagementPolicy: 'Parallel',
        minReadySeconds: 15,
      })
    );

    const saLink = getLinkByText('db-sa') ?? getElementByText('db-sa');
    expect(saLink).not.toBeUndefined();
    act(() => {
      saLink?.click();
    });

    expect(openWithObjectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'ServiceAccount',
        name: 'db-sa',
        namespace: 'data',
        clusterId: defaultClusterId,
      })
    );
    expect(container.textContent).toContain('Pod Mgmt');
    expect(container.textContent).toContain('Parallel');
    expect(container.textContent).toContain('Min Ready');
    expect(container.textContent).toContain('15s');
  });

  it('surfaces deployment Available=False and ReplicaFailure conditions', async () => {
    await renderDescriptor(
      deploymentDescriptor,
      new deployment.DeploymentDetails({
        kind: 'Deployment',
        name: 'broken',
        ready: '0/3',
        replicas: '0/3',
        desiredReplicas: 3,
        available: 0,
        conditions: [
          'Available: False (MinimumReplicasUnavailable) - Deployment does not have minimum availability.',
          'ReplicaFailure: True (FailedCreate) - pods "broken-7c..." is forbidden: exceeded quota',
          'Progressing: False (ProgressDeadlineExceeded)',
        ],
      })
    );

    expect(container.textContent).toContain('Availability');
    expect(container.textContent).toContain('Unavailable');
    expect(container.textContent).toContain('Replica Failure');
    expect(container.textContent).toContain('FailedCreate');
  });

  it('omits availability/replica-failure rows when conditions are healthy', async () => {
    await renderDescriptor(
      deploymentDescriptor,
      new deployment.DeploymentDetails({
        kind: 'Deployment',
        name: 'ok',
        ready: '3/3',
        replicas: '3/3',
        desiredReplicas: 3,
        available: 3,
        conditions: [
          'Available: True (MinimumReplicasAvailable)',
          'Progressing: True (NewReplicaSetAvailable)',
        ],
      })
    );

    expect(getElementByText('Availability')).toBeUndefined();
    expect(getElementByText('Replica Failure')).toBeUndefined();
  });
});
