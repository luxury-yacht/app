/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/EndpointsOverview.test.tsx
 *
 * Test suite for EndpointsOverview.
 * Covers key behaviors and edge cases for EndpointsOverview.
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
        totalReady: 12,
        totalNotReady: 6,
        totalPorts: 4,
        slices: [
          {
            name: 'svc-endpoint-slices-a',
            addressType: 'IPv4',
            age: '30m',
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
          },
        ],
        labels: {},
        annotations: {},
      } as any,
    });

    const slicesSection = container.querySelector('.slices-section');
    expect(slicesSection).not.toBeNull();
    expect(slicesSection?.textContent).toContain('IPv4 (12/18 ready)');
    expect(slicesSection?.textContent).toContain('Ready');
    expect(slicesSection?.textContent).toContain('Not Ready');
    expect(slicesSection?.textContent).toContain('http:');
  });

  it('omits not ready section when no not-ready addresses', async () => {
    await renderComponent({
      endpointSliceDetails: {
        name: 'healthy-slice',
        namespace: 'dev',
        age: '5m',
        totalReady: 2,
        totalNotReady: 0,
        totalPorts: 1,
        slices: [
          {
            name: 'healthy-slice-a',
            addressType: 'IPv4',
            age: '5m',
            readyAddresses: [
              { ip: '10.0.0.1', targetRef: 'pod-1', nodeName: 'node-1' },
              { ip: '10.0.0.2', targetRef: 'pod-2', nodeName: 'node-2' },
            ],
            notReadyAddresses: [],
            ports: [{ name: 'http', port: 80, protocol: 'TCP' }],
          },
        ],
        labels: {},
        annotations: {},
      } as any,
    });

    const slicesSection = container.querySelector('.slices-section');
    expect(slicesSection?.textContent).toContain('IPv4 (2/2 ready)');
    const notReadyLabels = slicesSection?.querySelectorAll('.addresses-label.not-ready');
    expect(notReadyLabels?.length ?? 0).toBe(0);
  });

  it('displays address with target and node', async () => {
    await renderComponent({
      endpointSliceDetails: {
        name: 'test-slice',
        namespace: 'default',
        age: '1h',
        totalReady: 1,
        totalNotReady: 0,
        totalPorts: 1,
        slices: [
          {
            name: 'test-slice-a',
            addressType: 'IPv6',
            age: '1h',
            readyAddresses: [{ ip: '2001:db8::1', targetRef: 'Pod/my-pod', nodeName: 'worker-1' }],
            notReadyAddresses: [],
            ports: [{ port: 8080, protocol: 'TCP' }],
          },
        ],
        labels: {},
        annotations: {},
      } as any,
    });

    const slicesSection = container.querySelector('.slices-section');
    expect(slicesSection?.textContent).toContain('2001:db8::1');
    expect(slicesSection?.textContent).toContain('Pod/my-pod');
    expect(slicesSection?.textContent).toContain('on');
    expect(slicesSection?.textContent).toContain('worker-1');
    expect(slicesSection?.textContent).toContain('IPv6 (1/1 ready)');
  });
});
