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

    expect(getValueForLabel(container, 'Ingress Class')?.textContent).toBe('nginx');
    expect(getValueForLabel(container, 'Load Balancer')?.textContent).toContain('lb.example.com');
    expect(getValueForLabel(container, 'Rules')?.textContent).toContain('example.com');
    expect(getValueForLabel(container, 'Rules')?.textContent).toContain('/app');
    expect(getValueForLabel(container, 'Rules')?.textContent).toContain('config-service');
    expect(getValueForLabel(container, 'TLS')?.textContent).toContain('tls-secret');
    expect(getValueForLabel(container, 'Default Backend')?.textContent).toBe('fallback:8080');
  });

  it('handles missing optional fields gracefully', async () => {
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

    expect(container.textContent).not.toContain('Load Balancer');
    expect(container.textContent).not.toContain('Default Backend');
  });
});
