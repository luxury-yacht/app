/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/ConfigMapOverview.test.tsx
 *
 * Renders the ConfigMap overview inside the real app shell, so its consumer
 * links open panels through the real panel owners (test-utils/appState).
 */

import type React from 'react';
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  installAppStateHarness,
  type MountedApp,
  type TestCluster,
} from '@/test-utils/appState/harness';
import { configMapDescriptor } from './descriptors/configmap';
import { OverviewRenderer } from './OverviewRenderer';

const app = installAppStateHarness();

const podRef = (cluster: TestCluster, name: string, namespace: string) => ({
  clusterId: cluster.clusterId,
  group: '',
  version: 'v1',
  kind: 'Pod',
  resource: 'pods',
  namespace,
  name,
});

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

vi.mock('@shared/components/kubernetes/ResourceMetadata', () => ({
  ResourceMetadata: () => <div data-testid="resource-metadata" />,
}));

const getLinkByText = (container: HTMLElement, text: string) =>
  Array.from(container.querySelectorAll<HTMLElement>('.object-panel-link')).find(
    (el) => el.textContent?.trim() === text
  );

describe('ConfigMapOverview', () => {
  let view: MountedApp;
  let dev: TestCluster;
  let container: HTMLElement;

  const renderComponent = async (props: { configMapDetails: unknown }) => {
    await view.show(
      <OverviewRenderer descriptor={configMapDescriptor} data={props.configMapDetails as never} />
    );
  };

  const getValueForLabel = (label: string) => {
    const labelElement = Array.from(
      container.querySelectorAll<HTMLElement>('.overview-label')
    ).find((el) => el.textContent?.trim() === label);
    return labelElement?.parentElement?.querySelector<HTMLElement>('.overview-value') ?? null;
  };

  beforeEach(async () => {
    dev = app.cluster({ name: 'dev', context: 'alpha' });
    app.namespaces(dev, ['default', 'team']);
    view = await app.render(null);
    container = view.container;
  });

  it('shows pod usage links', async () => {
    await renderComponent({
      configMapDetails: {
        name: 'app-config',
        namespace: 'default',
        data: { key1: 'value', key2: 'value' },
        binaryData: { bin: 'AAAA' },
        usedBy: [podRef(dev, 'pod-a', 'default'), podRef(dev, 'pod-b', 'default')],
        labels: {},
        annotations: {},
      } as unknown,
    });

    // Data/Binary key counts are intentionally not surfaced in the overview —
    // the DataSection below covers the actual keys.
    expect(getValueForLabel('Data Keys')).toBeNull();
    expect(getValueForLabel('Binary Data')).toBeNull();

    const podLink = getLinkByText(container, 'pod-a');
    expect(podLink).not.toBeUndefined();
    await act(async () => {
      podLink?.click();
    });
    await app.settle();
    expect(view.openPanels()).toEqual([
      {
        clusterId: dev.clusterId,
        clusterName: dev.clusterName,
        group: '',
        version: 'v1',
        kind: 'Pod',
        namespace: 'default',
        name: 'pod-a',
      },
    ]);
  });

  it('renders not-in-use message when no consumers', async () => {
    await renderComponent({
      configMapDetails: {
        name: 'unused-config',
        namespace: 'team',
        data: {},
        binaryData: {},
        usedBy: [],
        labels: {},
        annotations: {},
      } as unknown,
    });

    const usedByValue = getValueForLabel('Used By');
    expect(usedByValue?.textContent).toContain('Not in use');
    expect(view.openPanels()).toEqual([]);
  });
});
