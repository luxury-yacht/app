/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/PolicyOverview.test.tsx
 *
 * Behavioral coverage for the Autoscaling & Policy Overview descriptors (HPA, PDB, ResourceQuota,
 * LimitRange) rendered through the generic OverviewRenderer.
 */

import type React from 'react';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  hpaDescriptor,
  limitRangeDescriptor,
  pdbDescriptor,
  resourceQuotaDescriptor,
} from './descriptors/policy';
import { OverviewRenderer } from './OverviewRenderer';
import type { OverviewContext, OverviewDescriptor } from './schema';

type DeepPartial<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer Item)[]
    ? DeepPartial<Item>[]
    : T extends object
      ? { [Key in keyof T]?: DeepPartial<T[Key]> }
      : T;

const openWithObjectMock = vi.fn();
const defaultClusterId = 'alpha:ctx';
const context: OverviewContext = { clusterId: defaultClusterId, clusterName: 'alpha' };

vi.mock('@shared/components/Tooltip', () => ({
  __esModule: true,
  default: ({ children }: React.PropsWithChildren) => <>{children}</>,
}));

vi.mock('@shared/components/kubernetes/ResourceHeader', () => ({
  ResourceHeader: (props: { kind: string; name: string }) => (
    <div data-testid="resource-header">
      {props.kind}:{props.name}
    </div>
  ),
}));

vi.mock('@modules/object-panel/hooks/useObjectPanel', () => ({
  useObjectPanel: () => ({
    openWithObject: openWithObjectMock,
    objectData: { clusterId: defaultClusterId, clusterName: 'alpha' },
  }),
}));

vi.mock('@shared/hooks/useNavigateToView', () => ({
  useNavigateToView: () => ({ navigateToView: vi.fn() }),
}));

const getValueForLabel = (container: HTMLElement, label: string) => {
  const labelElement = Array.from(container.querySelectorAll<HTMLElement>('.overview-label')).find(
    (el) => el.textContent?.trim() === label
  );
  return labelElement?.parentElement?.querySelector<HTMLElement>('.overview-value') ?? null;
};

describe('Policy Overview descriptors', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  const renderDescriptor = async <T,>(
    descriptor: OverviewDescriptor<T>,
    fixture: DeepPartial<T>
  ) => {
    const data = fixture as T;
    await act(async () => {
      root.render(<OverviewRenderer<T> descriptor={descriptor} data={data} context={context} />);
      await Promise.resolve();
    });
  };

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

  it('renders HPA details and links to scale target', async () => {
    await renderDescriptor(hpaDescriptor, {
      kind: 'HorizontalPodAutoscaler',
      name: 'hpa',
      namespace: 'prod',
      scaleTargetRef: { kind: 'Deployment', name: 'api', apiVersion: 'apps/v1' },
      minReplicas: 2,
      maxReplicas: 10,
      currentReplicas: 5,
      metrics: [
        {
          kind: 'Resource',
          target: { resource: 'cpu', averageUtilization: '80' },
        },
        {
          kind: 'Object',
          target: { metric: 'requests-per-second', value: '100' },
        },
      ],
      currentMetrics: [
        {
          kind: 'Resource',
          current: { resource: 'cpu', averageUtilization: '60' },
        },
        {
          kind: 'Object',
          current: { metric: 'requests-per-second', value: '90' },
        },
      ],
      behavior: {
        scaleUp: {
          stabilizationWindowSeconds: 0,
          selectPolicy: 'Max',
        },
        scaleDown: {
          stabilizationWindowSeconds: 60,
        },
      },
    });

    const targetLink = getValueForLabel(container, 'Target')?.querySelector('.object-panel-link');
    expect(targetLink).toBeTruthy();
    act(() => {
      targetLink?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(openWithObjectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'Deployment',
        name: 'api',
        namespace: 'prod',
        clusterId: defaultClusterId,
      })
    );
    // New format shows Current, Min, Max on separate lines
    const replicasContent = getValueForLabel(container, 'Replicas');
    expect(replicasContent?.textContent).toContain('Current:');
    expect(replicasContent?.textContent).toContain('5');
    expect(replicasContent?.textContent).toContain('Min:');
    expect(replicasContent?.textContent).toContain('2');
    expect(replicasContent?.textContent).toContain('Max:');
    expect(replicasContent?.textContent).toContain('10');
    expect(container.textContent).toContain('Metrics');
    expect(container.textContent).toContain('Scale Up');
    expect(container.textContent).toContain('Scale Down');
  });

  it('renders PDB specific fields', async () => {
    await renderDescriptor(pdbDescriptor, {
      kind: 'PodDisruptionBudget',
      minAvailable: '50%',
      maxUnavailable: '1',
      currentHealthy: 4,
      desiredHealthy: 5,
      disruptionsAllowed: 2,
      selector: { app: 'web' },
    });

    expect(getValueForLabel(container, 'Min Available')?.textContent).toBe('50%');
    expect(getValueForLabel(container, 'Disruptions Allowed')?.textContent).toBe('2');
    const selectorChip = container.querySelector('.status-chip--info');
    expect(selectorChip?.textContent).toBe('Selector');
  });

  it('renders ResourceQuota hard and used limits', async () => {
    await renderDescriptor(resourceQuotaDescriptor, {
      kind: 'ResourceQuota',
      hard: { cpu: '4', memory: '8Gi' },
      used: { cpu: '2', memory: '4Gi' },
    });

    expect(getValueForLabel(container, 'Hard Limits')?.textContent).toContain('cpu: 4');
    expect(getValueForLabel(container, 'Used')?.textContent).toContain('memory: 4Gi');
  });

  it('renders LimitRange summary', async () => {
    await renderDescriptor(limitRangeDescriptor, {
      kind: 'LimitRange',
      limits: [{}, {}, {}],
    });

    expect(getValueForLabel(container, 'Limits')?.textContent).toBe('3 limit(s)');
  });

  it('handles missing scale target and renders extra current metrics', async () => {
    await renderDescriptor(hpaDescriptor, {
      kind: 'HorizontalPodAutoscaler',
      name: 'hpa',
      metrics: [
        {
          kind: 'Resource',
          target: { resource: 'memory', averageValue: '200Mi' },
        },
      ],
      currentMetrics: [
        {
          kind: 'Resource',
          current: { resource: 'memory', averageValue: '150Mi' },
        },
        {
          kind: 'Object',
          current: { metric: 'queue-depth', value: '3' },
        },
      ],
      behavior: {
        scaleUp: {
          stabilizationWindowSeconds: 30,
          policies: ['type:Pods, value:4'],
        },
        scaleDown: {
          policies: ['invalid-policy-entry'],
        },
      },
    });

    expect(container.querySelector('.object-panel-link')).toBeNull();
    const metricsContent = getValueForLabel(container, 'Metrics');
    // New format shows detailed targets
    expect(metricsContent?.textContent).toContain('MEMORY');
    expect(metricsContent?.textContent).toContain('Target:');
    expect(metricsContent?.textContent).toContain('200Mi');
    expect(metricsContent?.textContent).toContain('Current:');
    expect(metricsContent?.textContent).toContain('150Mi');
    // Behavior shows structured display with rules
    expect(container.textContent).toContain('Stabilization:');
    expect(container.textContent).toContain('30s');
    expect(container.textContent).toContain('4 pods');
  });

  it('renders resource quota with only hard limits defined', async () => {
    await renderDescriptor(resourceQuotaDescriptor, {
      kind: 'ResourceQuota',
      hard: { pods: '10' },
    });

    expect(getValueForLabel(container, 'Hard Limits')?.textContent).toContain('pods: 10');
    expect(getValueForLabel(container, 'Used')).toBeNull();
  });
});
