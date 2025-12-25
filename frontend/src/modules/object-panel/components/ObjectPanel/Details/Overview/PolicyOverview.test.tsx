/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/PolicyOverview.test.tsx
 *
 * Tests for PolicyOverview.
 */
import React from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PolicyOverview } from './PolicyOverview';

const openWithObjectMock = vi.fn();

vi.mock('@shared/components/kubernetes/ResourceHeader', () => ({
  ResourceHeader: (props: any) => (
    <div data-testid="resource-header">
      {props.kind}:{props.name}
    </div>
  ),
}));

vi.mock('@modules/object-panel/hooks/useObjectPanel', () => ({
  useObjectPanel: () => ({ openWithObject: openWithObjectMock }),
}));

const getValueForLabel = (container: HTMLElement, label: string) => {
  const labelElement = Array.from(container.querySelectorAll<HTMLElement>('.overview-label')).find(
    (el) => el.textContent?.trim() === label
  );
  return labelElement?.parentElement?.querySelector<HTMLElement>('.overview-value') ?? null;
};

describe('PolicyOverview', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  const renderComponent = async (props: React.ComponentProps<typeof PolicyOverview>) => {
    await act(async () => {
      root.render(<PolicyOverview {...props} />);
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
    await renderComponent({
      kind: 'HorizontalPodAutoscaler',
      name: 'hpa',
      namespace: 'prod',
      scaleTargetRef: { kind: 'Deployment', name: 'api', apiVersion: 'apps/v1' } as any,
      minReplicas: 2,
      maxReplicas: 10,
      currentReplicas: 5,
      metrics: [
        {
          kind: 'Resource',
          target: { resource: 'cpu', averageUtilization: '80' } as any,
        },
        {
          kind: 'Object',
          target: { metric: 'requests-per-second', value: '100' } as any,
        },
      ] as any,
      currentMetrics: [
        {
          kind: 'Resource',
          current: { resource: 'cpu', averageUtilization: '60' } as any,
        },
        {
          kind: 'Object',
          current: { metric: 'requests-per-second', value: '90' } as any,
        },
      ] as any,
      behavior: {
        scaleUp: {
          stabilizationWindowSeconds: 0,
          selectPolicy: 'Max',
        },
        scaleDown: {
          stabilizationWindowSeconds: 60,
        },
      } as any,
    });

    const targetLink = getValueForLabel(container, 'Target')?.querySelector('.object-panel-link');
    expect(targetLink).toBeTruthy();
    act(() => {
      targetLink?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(openWithObjectMock).toHaveBeenCalledWith({
      kind: 'Deployment',
      name: 'api',
      namespace: 'prod',
    });
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
    await renderComponent({
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
    const selectorChip = container.querySelector('.metadata-chip--selector');
    expect(selectorChip?.textContent).toBe('Selector');
  });

  it('renders ResourceQuota hard and used limits', async () => {
    await renderComponent({
      kind: 'ResourceQuota',
      hard: { cpu: '4', memory: '8Gi' },
      used: { cpu: '2', memory: '4Gi' },
    });

    expect(getValueForLabel(container, 'Hard Limits')?.textContent).toContain('cpu: 4');
    expect(getValueForLabel(container, 'Used')?.textContent).toContain('memory: 4Gi');
  });

  it('renders LimitRange summary', async () => {
    await renderComponent({
      kind: 'LimitRange',
      limits: [{}, {}, {}] as any,
    });

    expect(getValueForLabel(container, 'Limits')?.textContent).toBe('3 limit(s)');
  });

  it('handles missing scale target and renders extra current metrics', async () => {
    await renderComponent({
      kind: 'HorizontalPodAutoscaler',
      name: 'hpa',
      metrics: [
        {
          kind: 'Resource',
          target: { resource: 'memory', averageValue: '200Mi' } as any,
        },
      ] as any,
      currentMetrics: [
        {
          kind: 'Resource',
          current: { resource: 'memory', averageValue: '150Mi' } as any,
        },
        {
          kind: 'Object',
          current: { metric: 'queue-depth', value: '3' } as any,
        },
      ] as any,
      behavior: {
        scaleUp: {
          stabilizationWindowSeconds: 30,
          policies: ['type:Pods, value:4'],
        },
        scaleDown: {
          policies: ['invalid-policy-entry'],
        },
      } as any,
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
    await renderComponent({
      kind: 'ResourceQuota',
      hard: { pods: '10' },
    });

    expect(getValueForLabel(container, 'Hard Limits')?.textContent).toContain('pods: 10');
    expect(getValueForLabel(container, 'Used')).toBeNull();
  });
});
