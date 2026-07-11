/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/NodeOverview.test.tsx
 *
 * Exercises the Node Overview through the descriptor-driven renderer (X1). The presentation moved
 * from NodeOverview.tsx into descriptors/node.tsx; the renderer owns the frame and threads the
 * drain affordance through OverviewContext, so the test drives `OverviewRenderer` with a
 * NodeDetails-shaped DTO and a context object.
 */

import { nodes } from '@wailsjs/go/models';
import type React from 'react';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nodeDescriptor } from './descriptors/node';
import { OverviewRenderer } from './OverviewRenderer';
import type { OverviewContext } from './schema';

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
  }) => (
    <div
      data-testid="resource-status"
      data-state={props.statusState}
      data-presentation={props.statusPresentation}
    >
      {props.status}
    </div>
  ),
}));

vi.mock('@shared/components/kubernetes/ResourceMetadata', () => ({
  ResourceMetadata: () => <div data-testid="resource-metadata" />,
}));

vi.mock('@shared/components/Tooltip', () => ({
  __esModule: true,
  default: ({ children }: React.PropsWithChildren) => <>{children}</>,
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

  const renderNode = async (dto: nodes.NodeDetails, context: OverviewContext = {}) => {
    await act(async () => {
      root.render(<OverviewRenderer descriptor={nodeDescriptor} data={dto} context={context} />);
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
    await renderNode(
      nodes.NodeDetails.createFrom({
        name: 'node-a',
        status: 'Ready',
        statusState: 'True',
        statusPresentation: 'ready',
        roles: 'control-plane,master',
        internalIP: '10.0.0.10',
        externalIP: '34.1.1.1',
        hostname: 'node-host',
        podsCapacity: '100',
        podsCount: 80,
        kubeletVersion: 'v1.28.0',
        os: 'linux',
        architecture: 'amd64',
        osImage: 'Ubuntu 22.04',
        containerRuntime: 'containerd://1.7.0',
        kernelVersion: '5.15.0',
        storageCapacity: '500Gi',
        taints: [{ key: 'node-role.kubernetes.io/control-plane', effect: 'NoSchedule' }],
        conditions: [
          { kind: 'MemoryPressure', status: 'True' },
          { kind: 'Ready', status: 'False' },
        ],
        labels: {},
        annotations: {},
      })
    );

    const rolesValue = getValueForLabel(container, 'Roles');
    expect(rolesValue?.textContent).toContain('control-plane');
    expect(rolesValue?.textContent).toContain('master');
    const roleChips = rolesValue?.querySelectorAll('.status-chip');
    expect(roleChips?.length).toBe(2);
    roleChips?.forEach((chip) => {
      expect(chip.className).toContain('status-chip--info');
    });
    expect(getValueForLabel(container, 'Internal IP')?.textContent).toBe('10.0.0.10');
    expect(getValueForLabel(container, 'Pods')?.textContent).toContain('80/100');
    expect(getValueForLabel(container, 'OS')?.textContent).toContain('linux/amd64');
    expect(getValueForLabel(container, 'Runtime')?.textContent).toBe('containerd://1.7.0');
    expect(container.textContent).toContain('NoSchedule');
    expect(container.textContent).toContain('MemoryPressure');
    expect(
      container.querySelector('[data-testid="resource-status"]')?.getAttribute('data-state')
    ).toBe('True');
    expect(
      container.querySelector('[data-testid="resource-status"]')?.getAttribute('data-presentation')
    ).toBe('ready');
  });

  it('renders every condition as a status chip with the correct variant', async () => {
    await renderNode(
      nodes.NodeDetails.createFrom({
        name: 'node-b',
        conditions: [
          { kind: 'Ready', status: 'True' },
          { kind: 'MemoryPressure', status: 'False' },
          { kind: 'DiskPressure', status: 'True', message: 'disk full' },
          { kind: 'PIDPressure', status: 'Unknown' },
        ],
      })
    );

    const chips = Array.from(container.querySelectorAll<HTMLElement>('.status-chip'));
    expect(chips.map((el) => el.textContent)).toEqual([
      'Ready',
      'MemoryPressure',
      'DiskPressure',
      'PIDPressure',
    ]);
    expect(chips[0].className).toContain('status-chip--healthy');
    expect(chips[1].className).toContain('status-chip--healthy');
    expect(chips[2].className).toContain('status-chip--unhealthy');
    expect(chips[3].className).toContain('status-chip--warning');
  });

  it('renders the inline drain affordance when a drain is in progress', async () => {
    const onOpenDrain = vi.fn();
    await renderNode(nodes.NodeDetails.createFrom({ name: 'node-c', status: 'Ready' }), {
      onOpenDrain,
      drainInProgress: true,
      clusterId: 'cluster-1',
      clusterName: 'Cluster One',
    });

    const drainButton = container.querySelector<HTMLButtonElement>('.node-overview-drain-icon');
    expect(drainButton).not.toBeNull();
    act(() => {
      drainButton?.click();
    });
    expect(onOpenDrain).toHaveBeenCalledTimes(1);
  });
});
