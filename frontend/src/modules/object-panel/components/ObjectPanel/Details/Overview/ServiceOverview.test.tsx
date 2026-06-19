/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/ServiceOverview.test.tsx
 */

import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OverviewRenderer } from './OverviewRenderer';
import { serviceDescriptor } from './descriptors/service';

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

const getValueForLabel = (container: HTMLElement, label: string) => {
  const labelElement = Array.from(container.querySelectorAll<HTMLElement>('.overview-label')).find(
    (el) => el.textContent?.trim() === label
  );
  return labelElement?.parentElement?.querySelector<HTMLElement>('.overview-value') ?? null;
};

describe('ServiceOverview', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  const renderComponent = async (props: { serviceDetails: unknown }) => {
    await act(async () => {
      root.render(
        <OverviewRenderer descriptor={serviceDescriptor} data={props.serviceDetails as never} />
      );
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

  it('renders load balancer service details including ports and endpoints', async () => {
    await renderComponent({
      serviceDetails: {
        name: 'web-lb',
        namespace: 'prod',
        status: 'LoadBalancer active',
        statusState: 'LoadBalancer',
        statusPresentation: 'ready',
        serviceType: 'LoadBalancer',
        clusterIP: '10.0.0.1',
        clusterIPs: ['10.0.0.1', '10.0.0.2'],
        externalIPs: ['35.1.2.3'],
        loadBalancerIP: '35.1.2.3',
        loadBalancerStatus: 'Ready',
        sessionAffinity: 'ClientIP',
        sessionAffinityTimeout: 10800,
        healthStatus: 'Healthy',
        endpointCount: 2,
        endpoints: ['10.244.0.10:80', '10.244.0.11:80'],
        ports: [
          { name: 'http', port: 80, protocol: 'TCP', targetPort: 8080, nodePort: 30080 },
          { port: 443, protocol: 'TCP' },
        ],
        labels: {},
        annotations: {},
        selector: { app: 'web' },
      } as any,
    });

    expect(getValueForLabel(container, 'Type')?.textContent).toBe('LoadBalancer');
    // Multi-IP services use the plural label and join the values.
    expect(getValueForLabel(container, 'IP addresses')?.textContent).toContain('10.0.0.1');
    expect(getValueForLabel(container, 'IP addresses')?.textContent).toContain('10.0.0.2');
    expect(getValueForLabel(container, 'External IPs')?.textContent).toContain('35.1.2.3');
    expect(getValueForLabel(container, 'Load Balancer IP')?.textContent).toBe('35.1.2.3');
    const lbStatus = getValueForLabel(container, 'LB Status');
    expect(lbStatus?.textContent).toBe('Ready');
    const status = getValueForLabel(container, 'Status');
    expect(status?.textContent).toBe('LoadBalancer active');
    expect(status?.querySelector('.status-text.ready')).not.toBeNull();
    expect(getValueForLabel(container, 'Session Timeout')?.textContent).toBe('10800 seconds');
    // Endpoints row now shows the IP list directly (≤5 endpoints).
    expect(getValueForLabel(container, 'Endpoints')?.textContent).toContain('10.244.0.10:80');

    const portsValue = getValueForLabel(container, 'Ports');
    expect(portsValue?.textContent).toContain('http');
    expect(portsValue?.textContent).toContain('80/TCP → 8080 (NodePort: 30080)');
    expect(portsValue?.textContent).toContain('443/TCP');
  });

  it('handles ExternalName services and omits optional fields when absent', async () => {
    await renderComponent({
      serviceDetails: {
        name: 'external-svc',
        namespace: 'default',
        serviceType: 'ExternalName',
        clusterIP: 'None',
        sessionAffinity: 'None',
        healthStatus: 'Unknown',
        endpointCount: 0,
        endpoints: [],
        ports: [],
        externalName: 'api.example.com',
        labels: {},
        annotations: {},
        selector: {},
      } as any,
    });

    expect(getValueForLabel(container, 'External Name')?.textContent).toBe('api.example.com');
    expect(container.textContent).not.toContain('Load Balancer IP');
    expect(container.textContent).not.toContain('External IPs');
    // Session Affinity "None" is hidden as clutter.
    expect(container.textContent).not.toContain('Session Affinity');
    // Zero endpoints surface as an unhealthy status chip rather than a count.
    const endpoints = getValueForLabel(container, 'Endpoints');
    expect(endpoints?.querySelector('.status-chip--unhealthy')).not.toBeNull();
  });
});
