/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/ConfigMapOverview.test.tsx
 */

import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OverviewRenderer } from './OverviewRenderer';
import { configMapDescriptor } from './descriptors/configmap';

const openWithObjectMock = vi.fn();
const defaultClusterId = 'alpha:ctx';
const podRef = (name: string, namespace: string) => ({
  clusterId: defaultClusterId,
  group: '',
  version: 'v1',
  kind: 'Pod',
  resource: 'pods',
  namespace,
  name,
});

vi.mock('@modules/object-panel/hooks/useObjectPanel', () => ({
  useObjectPanel: () => ({
    openWithObject: openWithObjectMock,
    objectData: { clusterId: defaultClusterId, clusterName: 'alpha' },
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

vi.mock('@shared/components/kubernetes/ResourceMetadata', () => ({
  ResourceMetadata: () => <div data-testid="resource-metadata" />,
}));

vi.mock('@shared/hooks/useNavigateToView', () => ({
  useNavigateToView: () => ({ navigateToView: vi.fn() }),
}));

const getLinkByText = (container: HTMLElement, text: string) =>
  Array.from(container.querySelectorAll<HTMLElement>('.object-panel-link')).find(
    (el) => el.textContent?.trim() === text
  );

describe('ConfigMapOverview', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  const renderComponent = async (props: { configMapDetails: unknown }) => {
    await act(async () => {
      root.render(
        <OverviewRenderer descriptor={configMapDescriptor} data={props.configMapDetails as never} />
      );
      await Promise.resolve();
    });
  };

  const getValueForLabel = (label: string) => {
    const labelElement = Array.from(
      container.querySelectorAll<HTMLElement>('.overview-label')
    ).find((el) => el.textContent?.trim() === label);
    return labelElement?.parentElement?.querySelector<HTMLElement>('.overview-value') ?? null;
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

  it('shows pod usage links', async () => {
    await renderComponent({
      configMapDetails: {
        name: 'app-config',
        namespace: 'default',
        data: { key1: 'value', key2: 'value' },
        binaryData: { bin: 'AAAA' },
        usedBy: [podRef('pod-a', 'default'), podRef('pod-b', 'default')],
        labels: {},
        annotations: {},
      } as any,
    });

    // Data/Binary key counts are intentionally not surfaced in the overview —
    // the DataSection below covers the actual keys.
    expect(getValueForLabel('Data Keys')).toBeNull();
    expect(getValueForLabel('Binary Data')).toBeNull();

    const podLink = getLinkByText(container, 'pod-a');
    expect(podLink).not.toBeUndefined();
    act(() => {
      podLink?.click();
    });
    expect(openWithObjectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'Pod',
        name: 'pod-a',
        namespace: 'default',
        clusterId: defaultClusterId,
        group: '',
        version: 'v1',
      })
    );
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
      } as any,
    });

    const usedByValue = getValueForLabel('Used By');
    expect(usedByValue?.textContent).toContain('Not in use');
    expect(openWithObjectMock).not.toHaveBeenCalled();
  });
});
