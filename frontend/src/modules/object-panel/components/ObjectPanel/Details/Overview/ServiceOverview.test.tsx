/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/ServiceOverview.test.tsx
 */

import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { serviceDescriptor } from './descriptors/service';
import { OverviewRenderer } from './OverviewRenderer';

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

const getValueForLabel = (container: HTMLElement, label: string) => {
  const labelElement = Array.from(container.querySelectorAll<HTMLElement>('.overview-label')).find(
    (el) => el.textContent?.trim() === label
  );
  return labelElement?.parentElement?.querySelector<HTMLElement>('.overview-value') ?? null;
};

describe('ServiceOverview', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  const portsSection = () =>
    container.querySelector<HTMLElement>('section[aria-label="Ports"]') ?? undefined;
  const listTexts = (label: string) =>
    Array.from(
      portsSection()?.querySelectorAll<HTMLElement>(`ul[aria-label="${label}"] > li`) ?? [],
      (item) => item.textContent ?? ''
    );

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
        readyEndpointCount: 2,
        notReadyEndpointCount: 1,
        endpoints: ['10.244.0.10:80', '10.244.0.11:80'],
        ports: [
          { name: 'http', port: 80, protocol: 'TCP', targetPort: 8080, nodePort: 30080 },
          { port: 443, protocol: 'TCP' },
        ],
        labels: {},
        annotations: {},
        selector: { app: 'web' },
      } as unknown,
    });

    expect(getValueForLabel(container, 'Type')?.textContent).toBe('LoadBalancer');
    // Multi-IP services use the plural label and join the values.
    expect(getValueForLabel(container, 'IP addresses')?.textContent).toContain('10.0.0.1');
    expect(getValueForLabel(container, 'IP addresses')?.textContent).toContain('10.0.0.2');
    expect(getValueForLabel(container, 'External IPs')?.textContent).toContain('35.1.2.3');
    expect(getValueForLabel(container, 'Load Balancer IP')?.textContent).toBe('35.1.2.3');
    const lbStatus = getValueForLabel(container, 'LB Status');
    expect(lbStatus?.textContent).toBe('Ready');
    // A healthy Service has nothing to flag, so the Status row is omitted.
    expect(getValueForLabel(container, 'Status')).toBeNull();
    expect(getValueForLabel(container, 'Session Timeout')?.textContent).toBe('10800 seconds');
    // Endpoints row now shows the IP list directly (≤5 endpoints).
    expect(getValueForLabel(container, 'Endpoints')?.textContent).toContain('10.244.0.10:80');

    // The in-cluster DNS name is shared by every port, so it is a row like the addresses.
    expect(getValueForLabel(container, 'DNS Name')?.textContent).toBe('web-lb.prod.svc');

    // All ports flow to the same pods: one chip per port, the pods once.
    const [httpChip, httpsChip] = listTexts('Ports');
    // A chip names the port, maps Service port to target port, and gives its node port.
    expect(httpChip).toContain('http');
    expect(httpChip).toContain('TCP 80:8080');
    expect(httpChip).toContain('30080');
    // An unset target port is the API default: the Service port itself.
    expect(httpsChip).toBe('TCP 443:443');
    const backends = listTexts('Backend');
    expect(backends).toHaveLength(1);
    expect(backends[0]).toContain('app=web');
    expect(backends[0]).toContain('2 ready');
    expect(backends[0]).toContain('1 not ready');
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
        ports: [{ port: 443, protocol: 'TCP' }],
        externalName: 'api.example.com',
        labels: {},
        annotations: {},
        selector: {},
      } as unknown,
    });

    expect(getValueForLabel(container, 'External Name')?.textContent).toBe('api.example.com');
    expect(container.textContent).not.toContain('Load Balancer IP');
    expect(container.textContent).not.toContain('External IPs');
    // Session Affinity "None" is hidden as clutter.
    expect(container.textContent).not.toContain('Session Affinity');
    // An ExternalName Service has no cluster IP and never has endpoints, so neither row appears
    // (a "No endpoints" warning would read as a fault).
    expect(getValueForLabel(container, 'Endpoints')).toBeNull();
    expect(getValueForLabel(container, 'IP address')).toBeNull();
    expect(getValueForLabel(container, 'IP addresses')).toBeNull();
    // ExternalName is a DNS alias: clients reach the external host, not pods.
    expect(listTexts('Backend')[0]).toContain('api.example.com');
  });

  it('shows the Status row only when the Service needs attention', async () => {
    await renderComponent({
      serviceDetails: {
        name: 'web',
        namespace: 'shop',
        status: 'ClusterIP, no endpoints',
        statusState: 'ClusterIP',
        statusPresentation: 'warning',
        serviceType: 'ClusterIP',
        clusterIP: '10.0.0.5',
        sessionAffinity: 'None',
        healthStatus: 'No endpoints',
        endpointCount: 0,
        readyEndpointCount: 0,
        notReadyEndpointCount: 0,
        endpoints: [],
        ports: [{ name: 'http', port: 80, protocol: 'TCP', targetPort: '8080' }],
        selector: { app: 'web' },
        labels: {},
        annotations: {},
      } as unknown,
    });

    expect(getValueForLabel(container, 'Status')?.textContent).toBe('ClusterIP, no endpoints');
  });

  it('keeps endpoint readiness unknown when the EndpointSlices could not be listed', async () => {
    await renderComponent({
      serviceDetails: {
        name: 'web',
        namespace: 'shop',
        status: 'ClusterIP',
        statusPresentation: 'ready',
        serviceType: 'ClusterIP',
        clusterIP: '10.0.0.5',
        sessionAffinity: 'None',
        healthStatus: 'Unknown',
        endpointCount: 0,
        readyEndpointCount: null,
        notReadyEndpointCount: null,
        endpoints: [],
        ports: [{ name: 'http', port: 80, protocol: 'TCP', targetPort: '8080' }],
        selector: { app: 'web' },
        labels: {},
        annotations: {},
      } as unknown,
    });

    const pods = listTexts('Backend')[0] ?? '';
    expect(pods).toContain('readiness unknown');
    expect(pods).not.toContain('0 ready');
    const endpoints = getValueForLabel(container, 'Endpoints');
    expect(endpoints?.textContent).toBe('Unknown');
    expect(endpoints?.querySelector('.status-chip--unhealthy')).toBeNull();
  });

  it('explains a headless service through its DNS name', async () => {
    await renderComponent({
      serviceDetails: {
        name: 'postgres',
        namespace: 'data',
        serviceType: 'ClusterIP',
        clusterIP: 'None',
        clusterIPs: ['None'],
        sessionAffinity: 'None',
        healthStatus: 'Healthy',
        endpointCount: 1,
        readyEndpointCount: 1,
        notReadyEndpointCount: 0,
        endpoints: ['10.244.5.2:5432'],
        ports: [
          { name: 'pg', port: 5432, protocol: 'TCP', targetPort: '5432' },
          { name: 'stats', port: 9187, protocol: 'UDP', targetPort: 'metrics' },
        ],
        selector: { app: 'postgres' },
        labels: {},
        annotations: {},
      } as unknown,
    });

    // A headless Service has no virtual IP; its DNS name returns the pods' own IPs.
    const dnsName = getValueForLabel(container, 'DNS Name')?.textContent ?? '';
    expect(dnsName).toContain('postgres.data.svc');
    expect(dnsName).toContain('pod IPs');
    // A named target port has no single number; each pod resolves it.
    const [, namedChip] = listTexts('Ports');
    expect(namedChip).toContain('stats');
    expect(namedChip).toContain('UDP 9187:metrics');
  });
});
