/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/GatewayAPIOverview.test.tsx
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GatewayAPIOverview } from './GatewayAPIOverview';

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

vi.mock('@shared/components/ObjectPanelLink', () => ({
  ObjectPanelLink: (props: any) => (
    <span
      data-testid="object-panel-link"
      data-kind={props.objectRef.kind}
      data-name={props.objectRef.name}
    >
      {props.children}
    </span>
  ),
}));

vi.mock('@shared/components/Tooltip', () => ({
  __esModule: true,
  default: ({ children }: any) => <>{children}</>,
}));

vi.mock('@modules/object-panel/hooks/useObjectPanel', () => ({
  useObjectPanel: () => ({
    objectData: {
      clusterName: 'prod-cluster',
    },
  }),
}));

const getValueForLabel = (container: HTMLElement, label: string) => {
  const labelElement = Array.from(container.querySelectorAll<HTMLElement>('.overview-label')).find(
    (el) => el.textContent?.trim() === label
  );
  return labelElement?.parentElement?.querySelector<HTMLElement>('.overview-value') ?? null;
};

describe('GatewayAPIOverview', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  const renderComponent = async (props: React.ComponentProps<typeof GatewayAPIOverview>) => {
    await act(async () => {
      root.render(<GatewayAPIOverview {...props} />);
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

  it('renders Gateway class, addresses, listeners, and conditions', async () => {
    await renderComponent({
      gatewayDetails: {
        kind: 'Gateway',
        name: 'edge',
        namespace: 'prod',
        age: '3h',
        gatewayClassRef: {
          clusterId: 'cluster-a',
          group: 'gateway.networking.k8s.io',
          version: 'v1',
          kind: 'GatewayClass',
          name: 'shared',
        },
        addresses: ['203.0.113.10'],
        listeners: [
          {
            name: 'https',
            protocol: 'HTTPS',
            port: 443,
            hostname: 'example.com',
            attachedRoutes: 2,
            conditions: [{ type: 'Programmed', status: 'True', reason: 'Programmed' }],
          },
        ],
        conditions: [{ type: 'Accepted', status: 'True', reason: 'Accepted' }],
        labels: {},
        annotations: {},
      } as any,
    });

    expect(getValueForLabel(container, 'Gateway Class')?.textContent).toContain(
      'GatewayClass shared'
    );
    expect(getValueForLabel(container, 'Addresses')?.textContent).toBe('203.0.113.10');
    expect(getValueForLabel(container, 'Listeners')?.textContent).toContain('HTTPS');
    expect(getValueForLabel(container, 'Listeners')?.textContent).toContain('443');
    expect(getValueForLabel(container, 'Listeners')?.textContent).toContain('2 routes');
    const conditionsValue = getValueForLabel(container, 'Conditions');
    expect(conditionsValue?.textContent).toContain('Accepted');
    // Status now drives badge color (healthy class) rather than appearing as text.
    const acceptedBadge = conditionsValue?.querySelector('.overview-condition-status');
    expect(acceptedBadge?.classList.contains('healthy')).toBe(true);
    expect(
      container.querySelector('[data-testid="object-panel-link"]')?.getAttribute('data-name')
    ).toBe('shared');
  });

  it('renders route parents, backends, rules, and hostnames', async () => {
    await renderComponent({
      routeDetails: {
        kind: 'HTTPRoute',
        name: 'web',
        namespace: 'prod',
        age: '1h',
        hostnames: ['example.com'],
        parentRefs: [
          {
            ref: {
              clusterId: 'cluster-a',
              group: 'gateway.networking.k8s.io',
              version: 'v1',
              kind: 'Gateway',
              namespace: 'prod',
              name: 'edge',
            },
          },
        ],
        backendRefs: [
          {
            ref: {
              clusterId: 'cluster-a',
              group: '',
              version: 'v1',
              kind: 'Service',
              namespace: 'prod',
              name: 'web-svc',
            },
          },
        ],
        rules: [
          {
            matches: ['path /app'],
            backendRefs: [
              {
                ref: {
                  clusterId: 'cluster-a',
                  group: '',
                  version: 'v1',
                  kind: 'Service',
                  namespace: 'prod',
                  name: 'web-svc',
                },
              },
            ],
          },
        ],
        conditions: [{ type: 'ResolvedRefs', status: 'True', reason: 'ResolvedRefs' }],
        labels: {},
        annotations: {},
      } as any,
    });

    expect(getValueForLabel(container, 'Hostnames')?.textContent).toBe('example.com');
    expect(getValueForLabel(container, 'Parent Refs')?.textContent).toContain('Gateway prod/edge');
    expect(getValueForLabel(container, 'Backend Refs')?.textContent).toContain(
      'Service prod/web-svc'
    );
    expect(getValueForLabel(container, 'Rules')?.textContent).toContain('path /app');
    expect(getValueForLabel(container, 'Rules')?.textContent).toContain('Service prod/web-svc');
  });

  it('renders display-only refs without object links', async () => {
    await renderComponent({
      referenceGrantDetails: {
        kind: 'ReferenceGrant',
        name: 'allow-widgets',
        namespace: 'prod',
        age: '4h',
        from: [{ group: 'gateway.networking.k8s.io', kind: 'HTTPRoute', namespace: 'team-a' }],
        to: [
          {
            display: {
              clusterId: 'cluster-a',
              group: 'example.io',
              kind: 'Widget',
              namespace: 'team-a',
              name: '',
            },
          },
        ],
        labels: {},
        annotations: {},
      } as any,
    });

    expect(getValueForLabel(container, 'From')?.textContent).toContain(
      'gateway.networking.k8s.io/HTTPRoute from team-a'
    );
    expect(getValueForLabel(container, 'To')?.textContent).toContain(
      'Widget team-a/(name not specified)'
    );
    expect(container.querySelector('[data-testid="object-panel-link"]')).toBeNull();
  });
});
