/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/IngressOverview.test.tsx
 */

import type { ingress } from '@core/backend-api/models';
import type React from 'react';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { partialModelFixture } from '@/test-utils/partialModelFixture';
import { ingressDescriptor } from './descriptors/ingress';
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

vi.mock('@modules/object-panel/hooks/useObjectPanel', () => ({
  useObjectPanel: () => ({
    objectData: { clusterId: 'test-cluster', clusterName: 'test' },
  }),
}));

vi.mock('@shared/components/ObjectPanelLink', () => ({
  ObjectPanelLink: ({ children }: React.PropsWithChildren) => <a href="/object">{children}</a>,
}));

vi.mock('@shared/components/Tooltip', () => ({
  __esModule: true,
  default: ({ children }: React.PropsWithChildren) => <>{children}</>,
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

  const rulesSection = () => container.querySelector<HTMLElement>('section[aria-label="Rules"]');
  const ruleCards = () =>
    Array.from(rulesSection()?.querySelectorAll<HTMLElement>('ol > li') ?? []);
  const endpointTexts = (card: HTMLElement | undefined, label: string) =>
    Array.from(
      card?.querySelectorAll<HTMLElement>(`ul[aria-label="${label}"] > li`) ?? [],
      (item) => item.textContent ?? ''
    );

  const renderComponent = async (fixture: Record<string, unknown>) => {
    const dto = partialModelFixture<ingress.IngressDetails>(fixture);
    await act(async () => {
      root.render(
        <OverviewRenderer
          descriptor={ingressDescriptor}
          data={dto}
          context={{ clusterId: 'test-cluster', clusterName: 'test' }}
        />
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

  it('renders ingress details including rules, TLS, and default backend', async () => {
    await renderComponent({
      name: 'web-ingress',
      namespace: 'prod',
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
    });

    // Ingress Class is now rendered as a link to the IngressClass panel.
    const ingressClass = getValueForLabel(container, 'Ingress Class');
    expect(ingressClass?.textContent).toBe('nginx');
    expect(ingressClass?.querySelector('a')).toBeTruthy();
    // Load Balancer renamed to Address; surfaced near the top.
    expect(getValueForLabel(container, 'Address')?.textContent).toContain('lb.example.com');

    // Each host rule is a card with one flow per path: requests → port → backend.
    const [hostRule, defaultRule] = ruleCards();
    const requests = endpointTexts(hostRule, 'Requests');
    expect(requests).toHaveLength(2);
    expect(requests[0]).toContain('/app');
    expect(requests[0]).toContain('example.com');
    const backends = endpointTexts(hostRule, 'Backend');
    expect(backends[0]).toContain('web');
    expect(backends[1]).toContain('config-service');
    expect(endpointTexts(hostRule, 'Ports')).toEqual(['port 80']);
    // Service backends open the Service.
    expect(hostRule?.querySelector('ul[aria-label="Backend"] a')?.textContent).toBe('web');

    // The default backend takes every request no rule matches.
    expect(endpointTexts(defaultRule, 'Requests')).toEqual(['All other requests']);
    expect(endpointTexts(defaultRule, 'Ports')).toEqual(['port 8080']);
    expect(defaultRule?.querySelector('ul[aria-label="Backend"] a')?.textContent).toBe('fallback');

    // TLS secret is now linkable.
    const tlsValue = getValueForLabel(container, 'TLS');
    expect(tlsValue?.textContent).toContain('tls-secret');
    expect(tlsValue?.querySelector('a')).toBeTruthy();
  });

  it('renders rule hosts as browser links with the TLS-derived scheme', async () => {
    await renderComponent({
      name: 'web-ingress',
      namespace: 'prod',
      rules: [
        { host: 'secure.example.com', paths: [] },
        { host: 'plain.example.com', paths: [] },
        { host: '*.wild.example.com', paths: [] },
      ],
      tls: [{ hosts: ['secure.example.com'], secretName: 'tls-secret' }],
      labels: {},
      annotations: {},
    });

    const rulesValue = rulesSection();
    const linkTitles = Array.from(
      rulesValue?.querySelectorAll<HTMLButtonElement>('button.overview-scheme-link') ?? []
    ).map((b) => b.title);

    // Each title is the exact resolved URL ("Open <url> in browser"), so assert
    // the whole title. A substring match would also accept an arbitrary host
    // before or after the expected URL.
    // TLS-covered host offers both https and http.
    expect(linkTitles).toContain('Open https://secure.example.com in browser');
    expect(linkTitles).toContain('Open http://secure.example.com in browser');
    // Uncovered host offers http only — never https (no cert).
    expect(linkTitles).toContain('Open http://plain.example.com in browser');
    expect(linkTitles).not.toContain('Open https://plain.example.com in browser');

    // Wildcard hosts aren't browsable, so they get no scheme links — only the
    // three links above — but the name still shows.
    expect(linkTitles).toHaveLength(3);
    expect(rulesValue?.textContent).toContain('*.wild.example.com');
  });

  it('shows a "no address" chip when the load balancer has no addresses yet', async () => {
    await renderComponent({
      name: 'minimal',
      namespace: 'default',
      rules: [],
      tls: [],
      labels: {},
      annotations: {},
    });

    const address = getValueForLabel(container, 'Address');
    expect(address?.textContent).toBe('no address');
    expect(address?.querySelector('.status-chip--info')).toBeTruthy();
    expect(container.textContent).not.toContain('Default Backend');
  });
});
