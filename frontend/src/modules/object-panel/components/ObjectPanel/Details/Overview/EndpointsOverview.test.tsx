/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/EndpointsOverview.test.tsx
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EndpointSliceOverview } from './EndpointsOverview';

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

vi.mock('@modules/object-panel/hooks/useObjectPanel', () => ({
  useObjectPanel: () => ({
    openWithObject: vi.fn(),
  }),
}));

vi.mock('@shared/hooks/useNavigateToView', () => ({
  useNavigateToView: () => ({ navigateToView: vi.fn() }),
}));

describe('EndpointSliceOverview', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  const renderComponent = async (props: React.ComponentProps<typeof EndpointSliceOverview>) => {
    await act(async () => {
      root.render(<EndpointSliceOverview {...props} />);
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

  it('renders slice details with address counts', async () => {
    await renderComponent({
      endpointSliceDetails: {
        name: 'svc-endpoint-slices',
        namespace: 'default',
        age: '1h',
        addressType: 'IPv4',
        readyAddresses: Array.from({ length: 12 }, (_, index) => ({
          ip: `10.0.0.${index + 1}`,
          hostname: `pod-${index + 1}`,
          nodeName: `node-${index % 3}`,
          targetRef: `pod-${index + 1}`,
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
      } as any,
    });

    const overview = container;
    expect(overview.textContent).toContain('IPv4');
    // The Status row reports "12 ready" and "6 not ready" via chips.
    expect(overview.textContent).toContain('12 ready');
    expect(overview.textContent).toContain('6 not ready');
    // Section labels include the per-state counts.
    expect(overview.textContent).toContain('Ready (12)');
    expect(overview.textContent).toContain('Not Ready (6)');
    expect(overview.textContent).toContain('http:');
  });

  it('omits not ready section when no not-ready addresses', async () => {
    await renderComponent({
      endpointSliceDetails: {
        name: 'healthy-slice',
        namespace: 'dev',
        age: '5m',
        addressType: 'IPv4',
        readyAddresses: [
          { ip: '10.0.0.1', targetRef: 'pod-1', nodeName: 'node-1' },
          { ip: '10.0.0.2', targetRef: 'pod-2', nodeName: 'node-2' },
        ],
        notReadyAddresses: [],
        ports: [{ name: 'http', port: 80, protocol: 'TCP' }],
        labels: {},
        annotations: {},
      } as any,
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
      endpointSliceDetails: {
        name: 'test-slice',
        namespace: 'default',
        age: '1h',
        addressType: 'IPv6',
        readyAddresses: [{ ip: '2001:db8::1', targetRef: 'Pod/my-pod', nodeName: 'worker-1' }],
        notReadyAddresses: [],
        ports: [{ port: 8080, protocol: 'TCP' }],
        labels: {},
        annotations: {},
      } as any,
    });

    expect(container.textContent).toContain('2001:db8::1');
    expect(container.textContent).toContain('Pod/my-pod');
    expect(container.textContent).toContain('on');
    expect(container.textContent).toContain('worker-1');
    expect(container.textContent).toContain('IPv6');
    expect(container.textContent).toContain('1 ready');
  });
});
