/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/NodeOverview.test.tsx
 *
 * Test suite for NodeOverview.
 * Covers key behaviors and edge cases for NodeOverview.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NodeOverview } from './NodeOverview';

vi.mock('@shared/components/kubernetes/ResourceHeader', () => ({
  ResourceHeader: (props: any) => (
    <div data-testid="resource-header">
      {props.kind}:{props.name}
    </div>
  ),
}));

vi.mock('@shared/components/kubernetes/ResourceStatus', () => ({
  ResourceStatus: (props: any) => <div data-testid="resource-status">{props.status}</div>,
}));

vi.mock('@shared/components/kubernetes/ResourceMetadata', () => ({
  ResourceMetadata: () => <div data-testid="resource-metadata" />,
}));

const getValueForLabel = (container: HTMLElement, label: string) => {
  const labelElement = Array.from(container.querySelectorAll<HTMLElement>('.overview-label')).find(
    (el) => el.textContent?.trim() === label
  );
  return labelElement?.parentElement?.querySelector<HTMLElement>('.overview-value') ?? null;
};

describe('NodeOverview', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  const renderComponent = async (props: React.ComponentProps<typeof NodeOverview>) => {
    await act(async () => {
      root.render(<NodeOverview {...props} />);
      await Promise.resolve();
    });
  };

  beforeEach(() => {
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

  it('renders node details including capacity, runtime, and taints', async () => {
    await renderComponent({
      name: 'node-a',
      age: '5d',
      status: 'Ready',
      roles: 'control-plane,master',
      internalIP: '10.0.0.10',
      externalIP: '34.1.1.1',
      hostname: 'node-host',
      podsCapacity: '100',
      podsCount: 80,
      version: 'v1.28.0',
      os: 'linux',
      architecture: 'amd64',
      osImage: 'Ubuntu 22.04',
      containerRuntime: 'containerd://1.7.0',
      kernelVersion: '5.15.0',
      storageCapacity: '500Gi',
      taints: [{ key: 'node-role.kubernetes.io/control-plane', effect: 'NoSchedule' }],
      conditions: [
        { type: 'MemoryPressure', status: 'True' },
        { type: 'Ready', status: 'False' },
      ],
      labels: {},
      annotations: {},
    });

    expect(container.textContent).toContain('control-plane,master');
    expect(getValueForLabel(container, 'Internal IP')?.textContent).toBe('10.0.0.10');
    expect(getValueForLabel(container, 'Pods')?.textContent).toContain('80/100');
    expect(getValueForLabel(container, 'OS')?.textContent).toContain('linux/amd64');
    expect(getValueForLabel(container, 'Runtime')?.textContent).toBe('containerd://1.7.0');
    expect(container.textContent).toContain('NoSchedule');
    expect(container.textContent).toContain('MemoryPressure');
  });

  it('shows all-healthy badge when conditions are healthy', async () => {
    await renderComponent({
      name: 'node-b',
      age: '10d',
      conditions: [
        { type: 'Ready', status: 'True', kind: 'Ready' },
        { type: 'MemoryPressure', status: 'False', kind: 'MemoryPressure' },
      ],
    });

    expect(container.textContent).toContain('All Healthy');
  });
});
