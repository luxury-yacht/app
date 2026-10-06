/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/GatewayAPIOverview.test.tsx
 *
 * Exercises the Gateway API Overview descriptors (X1) through the generic OverviewRenderer. Each
 * case renders the descriptor matching the kind under test with a DTO-shaped fixture as `data` and
 * the cluster identity threaded via `context`.
 */

import type React from 'react';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  gatewayDescriptor,
  grpcRouteDescriptor,
  httpRouteDescriptor,
  referenceGrantDescriptor,
  tlsRouteDescriptor,
} from './descriptors/gateway';
import { OverviewRenderer } from './OverviewRenderer';
import type { OverviewContext, OverviewDescriptor } from './schema';

type DeepPartial<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer Item)[]
    ? DeepPartial<Item>[]
    : T extends object
      ? { [Key in keyof T]?: DeepPartial<T[Key]> }
      : T;

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

vi.mock('@shared/components/ObjectPanelLink', () => ({
  ObjectPanelLink: (props: {
    objectRef: { kind: string; name: string };
    children: React.ReactNode;
  }) => (
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
  default: ({ children }: React.PropsWithChildren) => <>{children}</>,
}));

const context: OverviewContext = {
  clusterId: 'cluster-a',
  clusterName: 'prod-cluster',
};

const getValueForLabel = (container: HTMLElement, label: string) => {
  const labelElement = Array.from(container.querySelectorAll<HTMLElement>('.overview-label')).find(
    (el) => el.textContent?.trim() === label
  );
  return labelElement?.parentElement?.querySelector<HTMLElement>('.overview-value') ?? null;
};

describe('GatewayAPIOverview', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  const renderDescriptor = async <T,>(
    descriptor: OverviewDescriptor<T>,
    fixture: DeepPartial<T>
  ) => {
    const data = fixture as T;
    await act(async () => {
      root.render(<OverviewRenderer<T> descriptor={descriptor} data={data} context={context} />);
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
    await renderDescriptor(gatewayDescriptor, {
      kind: 'Gateway',
      name: 'edge',
      namespace: 'prod',
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
    // Status drives chip variant (healthy) rather than appearing as text.
    const acceptedBadge = conditionsValue?.querySelector('.status-chip');
    expect(acceptedBadge?.classList.contains('status-chip--healthy')).toBe(true);
    expect(
      container.querySelector('[data-testid="object-panel-link"]')?.getAttribute('data-name')
    ).toBe('shared');
  });

  it('renders HTTP(S) listener hostnames as browser links and leaves others as text', async () => {
    await renderDescriptor(gatewayDescriptor, {
      kind: 'Gateway',
      name: 'edge',
      namespace: 'prod',
      listeners: [
        {
          name: 'https',
          protocol: 'HTTPS',
          port: 443,
          hostname: 'secure.example.com',
          attachedRoutes: 0,
        },
        {
          name: 'http',
          protocol: 'HTTP',
          port: 8080,
          hostname: 'plain.example.com',
          attachedRoutes: 0,
        },
        {
          name: 'passthrough',
          protocol: 'TLS',
          port: 8443,
          hostname: 'tls.example.com',
          attachedRoutes: 0,
        },
      ],
      labels: {},
      annotations: {},
    });

    const listenersValue = getValueForLabel(container, 'Listeners');
    const linkTitles = Array.from(
      listenersValue?.querySelectorAll<HTMLButtonElement>('button.overview-scheme-link') ?? []
    ).map((b) => b.title);

    // Each title is the exact resolved URL ("Open <url> in browser"), so assert
    // the whole title. A substring match would also accept an arbitrary host
    // before or after the expected URL.
    // HTTPS listener → https, default 443 omitted (the exact title proves it).
    expect(linkTitles).toContain('Open https://secure.example.com in browser');
    // HTTP listener → http with its non-default port.
    expect(linkTitles).toContain('Open http://plain.example.com:8080 in browser');
    // TLS listener has an ambiguous scheme, so it produces no link — only the
    // two links above — though its hostname stays as plain text.
    expect(linkTitles).toHaveLength(2);
    expect(listenersValue?.textContent).toContain('tls.example.com');
  });

  const serviceRef = (name: string, namespace = 'prod') => ({
    ref: { clusterId: 'cluster-a', group: '', version: 'v1', kind: 'Service', namespace, name },
  });
  const routeRules = (label = 'Rules') =>
    Array.from(
      container.querySelectorAll<HTMLElement>(`section[aria-label="${label}"] ol > li`) ?? []
    );
  const endpointTexts = (rule: HTMLElement | undefined, label: string) =>
    Array.from(
      rule?.querySelectorAll<HTMLElement>(`ul[aria-label="${label}"] > li`) ?? [],
      (item) => item.textContent ?? ''
    );

  it('shows each route rule as its matches flowing to weighted backends', async () => {
    await renderDescriptor(httpRouteDescriptor, {
      kind: 'HTTPRoute',
      name: 'web',
      namespace: 'prod',
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
      backendRefs: [serviceRef('web-svc'), serviceRef('web-canary')],
      rules: [
        {
          matches: [
            {
              path: { type: 'PathPrefix', value: '/app' },
              headers: [{ type: 'Exact', name: 'x-canary', value: 'true' }],
            },
            { path: { type: 'Exact', value: '/healthz' }, method: 'GET' },
          ],
          backendRefs: [
            { target: serviceRef('web-svc'), port: 8080, weight: 90 },
            { target: serviceRef('web-canary', 'canary'), port: 8080, weight: 10 },
          ],
        },
        { backendRefs: [{ target: serviceRef('web-svc'), port: 80, weight: 1 }] },
        {
          matches: [{ path: { type: 'PathPrefix', value: '/old' } }],
          backendRefs: [{ target: serviceRef('legacy'), port: 80, weight: 0 }],
        },
      ],
      conditions: [{ type: 'ResolvedRefs', status: 'True', reason: 'ResolvedRefs' }],
      labels: {},
      annotations: {},
    });

    expect(getValueForLabel(container, 'Hostnames')?.textContent).toBe('example.com');
    expect(getValueForLabel(container, 'Parent Refs')?.textContent).toContain('Gateway prod/edge');

    const [split, catchAll, disabled] = routeRules();
    // Matches are alternatives; every condition inside one match applies together.
    const requests = endpointTexts(split, 'Requests');
    expect(requests).toHaveLength(2);
    expect(requests[0]).toContain('/app');
    expect(requests[0]).toContain('x-canary');
    expect(requests[1]).toContain('/healthz');
    expect(requests[1]).toContain('GET');
    // Backends carry port and their share of the rule's traffic.
    const backends = endpointTexts(split, 'Backends');
    expect(backends[0]).toContain('web-svc');
    expect(backends[0]).toContain('8080');
    expect(backends[0]).toContain('90%');
    expect(backends[1]).toContain('10%');
    // A backend in another namespace says which one.
    expect(backends[1]).toContain('canary');
    expect(
      split
        ?.querySelector('ul[aria-label="Backends"] [data-testid="object-panel-link"]')
        ?.getAttribute('data-name')
    ).toBe('web-svc');

    // A rule without matches takes every request; a single backend gets no share.
    expect(endpointTexts(catchAll, 'Requests')).toEqual(['Any request']);
    expect(endpointTexts(catchAll, 'Backends')[0]).not.toContain('%');
    // Weight 0 sends no traffic, even for a rule's only backend.
    expect(endpointTexts(disabled, 'Backends')[0]).toContain('0% of traffic');
  });

  it('describes gRPC method matches and TLS hostnames as the requests a rule takes', async () => {
    await renderDescriptor(grpcRouteDescriptor, {
      kind: 'GRPCRoute',
      name: 'orders',
      namespace: 'prod',
      rules: [
        {
          matches: [
            {
              grpcMethod: { type: 'Exact', service: 'orders.OrderService', method: 'Create' },
              headers: [{ type: 'Exact', name: 'tenant', value: 'acme' }],
            },
            { headers: [{ type: 'Exact', name: 'x-debug', value: '1' }] },
          ],
          backendRefs: [{ target: serviceRef('orders'), port: 9090, weight: 1 }],
        },
      ],
      labels: {},
      annotations: {},
    });
    const [grpcRequests, anyMethod] = endpointTexts(routeRules()[0], 'Requests');
    expect(grpcRequests).toContain('orders.OrderService/Create');
    expect(grpcRequests).toContain('tenant');
    expect(anyMethod).toContain('Any method');

    await renderDescriptor(tlsRouteDescriptor, {
      kind: 'TLSRoute',
      name: 'db',
      namespace: 'prod',
      hostnames: ['db.example.com'],
      rules: [{ backendRefs: [{ target: serviceRef('postgres'), port: 5432, weight: 1 }] }],
      labels: {},
      annotations: {},
    });
    // TLS rules have no matches; the route's hostnames decide which connections they take.
    expect(endpointTexts(routeRules()[0], 'Requests')[0]).toContain('db.example.com');
  });

  it('renders display-only refs without object links', async () => {
    await renderDescriptor(referenceGrantDescriptor, {
      kind: 'ReferenceGrant',
      name: 'allow-widgets',
      namespace: 'prod',
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
    });

    // Grant renders the from→to diagram; query it directly.
    const diagram = container.querySelector('.reference-grant-diagram');
    expect(diagram).not.toBeNull();
    expect(diagram?.textContent).toContain('team-a');
    expect(diagram?.textContent).toContain('gateway.networking.k8s.io/HTTPRoute');
    // TO entries omit the namespace since it's the namespace card's header.
    expect(diagram?.textContent).toContain('Widget/*');
    expect(container.querySelector('[data-testid="object-panel-link"]')).toBeNull();
  });
});
