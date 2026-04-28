/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/IngressOverview.test.tsx
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { IngressOverview } from './IngressOverview';

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
    objectData: { clusterId: 'test-cluster', clusterName: 'test' },
  }),
}));

vi.mock('@shared/components/ObjectPanelLink', () => ({
  ObjectPanelLink: ({ children }: any) => <a href="#">{children}</a>,
}));

vi.mock('@shared/components/Tooltip', () => ({
  __esModule: true,
  default: ({ children }: any) => <>{children}</>,
}));

const getValueForLabel = (container: HTMLElement, label: string) => {
  const labelElement = Array.from(container.querySelectorAll<HTMLElement>('.overview-label')).find(
    (el) => el.textContent?.trim() === label
  );
  return labelElement?.parentElement?.querySelector<HTMLElement>('.overview-value') ?? null;
};

describe('IngressOverview', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  const renderComponent = async (props: React.ComponentProps<typeof IngressOverview>) => {
    await act(async () => {
      root.render(<IngressOverview {...props} />);
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

  it('renders ingress details including rules, TLS, and default backend', async () => {
    await renderComponent({
      ingressDetails: {
        name: 'web-ingress',
        namespace: 'prod',
        age: '2d',
        ingressClassName: 'nginx',
        loadBalancerStatus: ['lb.example.com'],
        rules: [
          {
            host: 'example.com',
            paths: [
              {
                path: '/app',
                pathType: 'Prefix',
                backend: { serviceName: 'web', servicePort: 80 },
              },
              {
                path: '/',
                pathType: 'Prefix',
                backend: { resource: 'config-service' },
              },
            ],
          },
        ],
        tls: [
          {
            hosts: ['example.com'],
            secretName: 'tls-secret',
          },
        ],
        defaultBackend: {
          serviceName: 'fallback',
          servicePort: 8080,
        },
        labels: {},
        annotations: {},
      } as any,
    });

    // Ingress Class is now rendered as a link to the IngressClass panel.
    const ingressClass = getValueForLabel(container, 'Ingress Class');
    expect(ingressClass?.textContent).toBe('nginx');
    expect(ingressClass?.querySelector('a')).toBeTruthy();
    // Load Balancer renamed to Address; surfaced near the top.
    expect(getValueForLabel(container, 'Address')?.textContent).toContain('lb.example.com');
    expect(getValueForLabel(container, 'Rules')?.textContent).toContain('example.com');
    expect(getValueForLabel(container, 'Rules')?.textContent).toContain('/app');
    expect(getValueForLabel(container, 'Rules')?.textContent).toContain('config-service');
    // Service-backed rule paths are linkable.
    const rulesValue = getValueForLabel(container, 'Rules');
    const rulesLinks = rulesValue?.querySelectorAll('a');
    expect(rulesLinks && rulesLinks.length).toBeGreaterThan(0);
    // TLS secret is now linkable.
    const tlsValue = getValueForLabel(container, 'TLS');
    expect(tlsValue?.textContent).toContain('tls-secret');
    expect(tlsValue?.querySelector('a')).toBeTruthy();
    // Default backend is linkable; textContent stays as `name:port`.
    const defaultBackend = getValueForLabel(container, 'Default Backend');
    expect(defaultBackend?.textContent).toBe('fallback:8080');
    expect(defaultBackend?.querySelector('a')).toBeTruthy();
  });

  it('shows a "no address" chip when the load balancer has no addresses yet', async () => {
    await renderComponent({
      ingressDetails: {
        name: 'minimal',
        namespace: 'default',
        age: '1h',
        rules: [],
        tls: [],
        labels: {},
        annotations: {},
      } as any,
    });

    const address = getValueForLabel(container, 'Address');
    expect(address?.textContent).toBe('no address');
    expect(address?.querySelector('.status-chip--info')).toBeTruthy();
    expect(container.textContent).not.toContain('Default Backend');
  });
});
