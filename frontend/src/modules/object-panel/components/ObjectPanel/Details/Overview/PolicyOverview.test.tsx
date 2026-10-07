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

  describe('PodDisruptionBudget', () => {
    const pdb = { kind: 'PodDisruptionBudget', name: 'web', namespace: 'prod' } as const;
    const section = (title: string) =>
      container.querySelector<HTMLElement>(`section[aria-label="${title}"]`);

    // Each blocked cause needs a different fix (wait for pods, relax the budget, fix the selector, or
    // fix what the controller rejected), so the Health section must tell them apart.
    it.each([
      {
        state: 'evictions allowed',
        status: { expectedPods: 4, currentHealthy: 4, desiredHealthy: 2, disruptionsAllowed: 2 },
        verdict: '2 allowed',
        reason: null,
      },
      {
        state: 'blocked by unhealthy pods',
        status: { expectedPods: 5, currentHealthy: 4, desiredHealthy: 4, disruptionsAllowed: 0 },
        verdict: 'Blocked',
        reason: /1 of 5 pods not healthy/,
      },
      {
        state: 'blocked by a budget that requires every pod',
        status: { expectedPods: 3, currentHealthy: 3, desiredHealthy: 3, disruptionsAllowed: 0 },
        verdict: 'Blocked',
        reason: /all 3 pods/,
      },
      {
        state: 'no matching pods',
        status: { expectedPods: 0, currentHealthy: 0, desiredHealthy: 1, disruptionsAllowed: 0 },
        verdict: 'No pods',
        reason: /matches no pods/,
      },
      {
        state: 'controller sync failure',
        status: {
          expectedPods: 3,
          currentHealthy: 3,
          desiredHealthy: 1,
          disruptionsAllowed: 0,
          conditions: [
            {
              type: 'DisruptionAllowed',
              status: 'False',
              reason: 'SyncFailed',
              message: 'found no controllers for pod web-0',
            },
          ],
        },
        verdict: 'Blocked',
        reason: /found no controllers for pod web-0/,
      },
    ])('explains eviction state: $state', async ({ status, verdict, reason }) => {
      await renderDescriptor(pdbDescriptor, { ...pdb, maxUnavailable: '1', ...status });

      const disruptions = getValueForLabel(section('Health') ?? container, 'Disruptions');
      expect(disruptions?.querySelector('.status-chip')?.textContent).toBe(verdict);
      if (reason) {
        expect(disruptions?.textContent).toMatch(reason);
      }
    });

    // A missing selector matches no pods, an empty one matches every pod in the namespace, and
    // match expressions narrow the match — all three change what the budget protects.
    it.each([
      { case: 'missing', selector: undefined, expected: [/matches no pods/] },
      { case: 'empty', selector: {}, expected: [/All pods in the namespace/] },
      {
        case: 'labels and expressions',
        selector: {
          matchLabels: { app: 'web' },
          matchExpressions: [{ key: 'tier', operator: 'In', values: ['frontend', 'web'] }],
        },
        expected: [/app=web/, /tier In frontend, web/],
      },
    ])('shows which pods a $case selector covers', async ({ selector, expected }) => {
      await renderDescriptor(pdbDescriptor, { ...pdb, minAvailable: '1', selector });

      const value = getValueForLabel(section('Budget') ?? container, 'Selector');
      for (const pattern of expected) {
        expect(value?.textContent).toMatch(pattern);
      }
    });

    it('shows the effective unhealthy-pod eviction policy', async () => {
      await renderDescriptor(pdbDescriptor, { ...pdb, minAvailable: '1' });
      expect(
        getValueForLabel(section('Budget') ?? container, 'Unhealthy Pods')?.textContent
      ).toMatch(/IfHealthyBudget.*default/);

      await renderDescriptor(pdbDescriptor, {
        ...pdb,
        minAvailable: '1',
        unhealthyPodEvictionPolicy: 'AlwaysAllow',
      });
      expect(
        getValueForLabel(section('Budget') ?? container, 'Unhealthy Pods')?.textContent
      ).toMatch(/^AlwaysAllow/);
    });

    it('opens a disrupted pod in its own cluster', async () => {
      await renderDescriptor(pdbDescriptor, {
        ...pdb,
        maxUnavailable: '1',
        expectedPods: 3,
        currentHealthy: 2,
        desiredHealthy: 2,
        disruptedPods: [
          {
            pod: {
              ref: {
                clusterId: 'beta:ctx',
                group: '',
                version: 'v1',
                kind: 'Pod',
                resource: 'pods',
                namespace: 'prod',
                name: 'web-0',
              },
            },
            disruptionTime: '2026-10-06T12:00:00Z',
          },
        ],
      });

      const link = getValueForLabel(section('Health') ?? container, 'Disrupted')?.querySelector(
        '.object-panel-link'
      );
      expect(link?.textContent).toBe('web-0');
      act(() => {
        link?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      expect(openWithObjectMock).toHaveBeenCalledWith(
        expect.objectContaining({
          clusterId: 'beta:ctx',
          group: '',
          version: 'v1',
          kind: 'Pod',
          namespace: 'prod',
          name: 'web-0',
        })
      );
    });
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
