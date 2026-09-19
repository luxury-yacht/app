/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/EndpointsOverview.test.tsx
 *
 * Parity oracle for the EndpointSlice Overview migrated onto the descriptor renderer. Renders
 * <OverviewRenderer descriptor={endpointSliceDescriptor} ...> with EndpointSliceDetails-shaped
 * fixtures; the cluster identity for building target-pod/node links comes from the context (matching
 * the old useObjectPanel mock). The frame components are mocked; ObjectPanelLink/StatusChip are real.
 */

import type { endpointslice } from '@core/backend-api/models';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { partialModelFixture } from '@/test-utils/partialModelFixture';
import { endpointSliceDescriptor } from './descriptors/endpointslice';
import { OverviewRenderer } from './OverviewRenderer';

const openWithObject = vi.hoisted(() => vi.fn());
const resolveCatalogObjectByUID = vi.hoisted(() => vi.fn());

vi.mock('@shared/utils/resourceLinkIdentity', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shared/utils/resourceLinkIdentity')>()),
  resolveCatalogObjectByUID,
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

vi.mock('@modules/object-panel/hooks/useObjectPanel', () => ({
  useObjectPanel: () => ({
    openWithObject,
    objectData: { clusterId: 'test-cluster', clusterName: 'test' },
  }),
}));

vi.mock('@shared/hooks/useNavigateToView', () => ({
  useNavigateToView: () => ({ navigateToView: vi.fn() }),
}));

// Cluster identity threaded via the OverviewContext, matching the old useObjectPanel mock.
const context = { clusterId: 'test-cluster', clusterName: 'test' };

describe('EndpointSliceOverview', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  const renderComponent = async (fixture: Record<string, unknown>) => {
    const dto = partialModelFixture<endpointslice.EndpointSliceDetails>(fixture);
    await act(async () => {
      root.render(
        <OverviewRenderer descriptor={endpointSliceDescriptor} data={dto} context={context} />
      );
      await Promise.resolve();
    });
  };

  beforeEach(() => {
    openWithObject.mockClear();
    resolveCatalogObjectByUID.mockReset().mockResolvedValue(undefined);
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

  it('renders slice details with address counts', async () => {
    await renderComponent({
      name: 'svc-endpoint-slices',
      namespace: 'default',
      addressType: 'IPv4',
      readyAddresses: Array.from({ length: 12 }, (_, index) => ({
        ip: `10.0.0.${index + 1}`,
        hostname: `pod-${index + 1}`,
        nodeName: `node-${index % 3}`,
        targetRef: {
          display: { clusterId: context.clusterId, kind: 'Pod', name: `pod-${index + 1}` },
        },
      })),
      notReadyAddresses: Array.from({ length: 6 }, (_, index) => ({
        ip: `10.0.1.${index + 1}`,
      })),
      ports: [
        { name: 'http', port: 80, protocol: 'TCP', appProtocol: 'http' },
        { name: 'https', port: 443, protocol: 'TCP' },
      ],
      labels: {},
      annotations: {},
    });

    const overview = container;
    expect(overview.textContent).toContain('IPv4');
    // The Status row reports "12 ready" and "6 not ready" via chips.
    expect(overview.textContent).toContain('12 ready');
    expect(overview.textContent).toContain('6 not ready');
    // Section labels are unadorned; counts live in the Status row chips.
    expect(overview.textContent).toContain('Ready');
    expect(overview.textContent).toContain('Not Ready');
    // Ports render as label/value rows: name on the left, port/protocol on the right.
    expect(overview.textContent).toContain('http');
    expect(overview.textContent).toContain('80/TCP (http)');
  });

  it('omits not ready section when no not-ready addresses', async () => {
    await renderComponent({
      name: 'healthy-slice',
      namespace: 'dev',
      addressType: 'IPv4',
      readyAddresses: [
        {
          ip: '10.0.0.1',
          targetRef: { display: { clusterId: context.clusterId, kind: 'Pod', name: 'pod-1' } },
          nodeName: 'node-1',
        },
        {
          ip: '10.0.0.2',
          targetRef: { display: { clusterId: context.clusterId, kind: 'Pod', name: 'pod-2' } },
          nodeName: 'node-2',
        },
      ],
      notReadyAddresses: [],
      ports: [{ name: 'http', port: 80, protocol: 'TCP' }],
      labels: {},
      annotations: {},
    });

    expect(container.textContent).toContain('IPv4');
    expect(container.textContent).toContain('2 ready');
    // No "Not Ready" chip and no Not Ready section when there are none.
    const unhealthyChips = container.querySelectorAll('.status-chip--unhealthy');
    expect(unhealthyChips.length).toBe(0);
    expect(container.textContent).not.toContain('Not Ready');
  });

  it('displays address with target and node', async () => {
    await renderComponent({
      name: 'test-slice',
      namespace: 'default',
      addressType: 'IPv6',
      readyAddresses: [
        {
          ip: '2001:db8::1',
          targetRef: {
            ref: {
              clusterId: context.clusterId,
              group: '',
              version: 'v1',
              kind: 'Pod',
              namespace: 'default',
              name: 'my-pod',
            },
          },
          nodeName: 'worker-1',
        },
      ],
      notReadyAddresses: [],
      ports: [{ port: 8080, protocol: 'TCP' }],
      labels: {},
      annotations: {},
    });

    expect(container.textContent).toContain('2001:db8::1');
    expect(container.textContent).toContain('Pod/my-pod');
    expect(container.textContent).toContain('on');
    expect(container.textContent).toContain('worker-1');
    expect(container.textContent).toContain('IPv6');
    expect(container.textContent).toContain('1 ready');
  });

  it('opens the exact target identity and leaves an unresolved target as text', async () => {
    const ref = {
      clusterId: 'Cluster-A',
      group: 'custom.example.com',
      version: 'v2',
      kind: 'Pod',
      namespace: 'target-ns',
      name: 'target',
      uid: 'target-uid',
    };
    await renderComponent({
      name: 'slice',
      namespace: 'slice-ns',
      readyAddresses: [{ ip: '10.0.0.1', targetRef: { ref } }],
      notReadyAddresses: [
        { ip: '10.0.0.2', targetRef: { display: { ...ref, version: '', name: 'unresolved' } } },
      ],
    });
    const target = container.querySelector<HTMLElement>('.address-target.object-panel-link');
    expect(target).not.toBeNull();
    await act(async () => target?.click());
    expect(openWithObject).toHaveBeenCalledWith(expect.objectContaining(ref));
    const unresolved = Array.from(container.querySelectorAll('.address-target')).find(
      (element) => element.textContent === 'Pod/unresolved'
    );
    expect(unresolved).toBeDefined();
    expect(unresolved?.classList.contains('object-panel-link')).toBe(false);
  });

  it('resolves a versionless target by cluster and UID before enabling navigation', async () => {
    const ref = {
      clusterId: 'Cluster-A',
      group: '',
      version: 'v1',
      kind: 'Pod',
      namespace: 'target-ns',
      name: 'target',
      uid: 'target-uid',
    };
    let finish!: (value: typeof ref) => void;
    resolveCatalogObjectByUID.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    await renderComponent({
      name: 'slice',
      namespace: 'slice-ns',
      readyAddresses: [{ ip: '10.0.0.1', targetRef: { display: { ...ref, version: '' } } }],
    });
    expect(resolveCatalogObjectByUID).toHaveBeenCalledWith('Cluster-A', 'target-uid');
    expect(container.querySelector('.address-target.object-panel-link')).toBeNull();
    await act(async () => {
      finish(ref);
    });
    const target = container.querySelector<HTMLElement>('.address-target.object-panel-link');
    expect(target).not.toBeNull();
    await act(async () => target?.click());
    expect(openWithObject).toHaveBeenCalledWith(expect.objectContaining(ref));
  });

  it('ignores an obsolete UID lookup after the target changes', async () => {
    const first = {
      clusterId: 'Cluster-A',
      group: '',
      version: 'v1',
      kind: 'Pod',
      namespace: 'target-ns',
      name: 'first',
      uid: 'first-uid',
    };
    let finish!: (value: typeof first) => void;
    resolveCatalogObjectByUID.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    const fixture = (ref: typeof first) => ({
      name: 'slice',
      namespace: 'slice-ns',
      readyAddresses: [{ ip: '10.0.0.1', targetRef: { display: { ...ref, version: '' } } }],
    });
    await renderComponent(fixture(first));
    const second = { ...first, clusterId: 'cluster-a', name: 'second', uid: 'second-uid' };
    resolveCatalogObjectByUID.mockResolvedValueOnce(second);
    await renderComponent(fixture(second));
    await act(async () => {
      finish(first);
    });
    const target = container.querySelector<HTMLElement>('.address-target.object-panel-link');
    expect(target).not.toBeNull();
    await act(async () => target?.click());
    expect(openWithObject).toHaveBeenCalledWith(expect.objectContaining(second));
  });
});
