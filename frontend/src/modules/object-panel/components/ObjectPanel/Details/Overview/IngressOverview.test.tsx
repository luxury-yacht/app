/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/IngressOverview.test.tsx
 *
 * Renders the Ingress overview inside the real app shell: its class, backend Service, and TLS
 * Secret links open panels through the real panel owners. Only the backend boundary is faked
 * (test-utils/appState).
 */

import type { ingress } from '@core/backend-api/models';
import type React from 'react';
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  installAppStateHarness,
  type MountedApp,
  type TestCluster,
} from '@/test-utils/appState/harness';
import { partialModelFixture } from '@/test-utils/partialModelFixture';
import { ingressDescriptor } from './descriptors/ingress';
import { OverviewRenderer } from './OverviewRenderer';

const app = installAppStateHarness();

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
  let view: MountedApp;
  let dev: TestCluster;
  let container: HTMLElement;

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
    await view.show(
      <OverviewRenderer
        descriptor={ingressDescriptor}
        data={dto}
        context={{ clusterId: dev.clusterId, clusterName: dev.clusterName }}
      />
    );
  };

  const click = async (element: HTMLElement | null | undefined) => {
    await act(async () => {
      element?.click();
    });
    await app.settle();
  };

  // A panel the real panel state holds, in the ingress's cluster.
  const panel = (kind: string, group: string, namespace: string, name: string) => ({
    clusterId: dev.clusterId,
    clusterName: dev.clusterName,
    group,
    version: 'v1',
    kind,
    namespace,
    name,
  });

  beforeEach(async () => {
    dev = app.cluster({ name: 'dev', context: 'alpha' });
    app.namespaces(dev, ['prod', 'default']);
    view = await app.render(null);
    container = view.container;
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
    const backendLink = (card: HTMLElement | undefined) =>
      card?.querySelector<HTMLElement>('ul[aria-label="Backend"] .object-panel-link');
    expect(backendLink(hostRule)?.textContent).toBe('web');

    // The default backend takes every request no rule matches.
    expect(endpointTexts(defaultRule, 'Requests')).toEqual(['All other requests']);
    expect(endpointTexts(defaultRule, 'Ports')).toEqual(['port 8080']);
    expect(backendLink(defaultRule)?.textContent).toBe('fallback');

    const tlsValue = getValueForLabel(container, 'TLS');
    expect(tlsValue?.textContent).toContain('tls-secret');

    // The class is cluster-scoped; Service backends and the TLS Secret live in the ingress's
    // namespace.
    await click(ingressClass?.querySelector<HTMLElement>('.object-panel-link'));
    await click(backendLink(hostRule));
    await click(backendLink(defaultRule));
    await click(tlsValue?.querySelector<HTMLElement>('.object-panel-link'));
    expect(view.openPanels()).toEqual([
      panel('IngressClass', 'networking.k8s.io', '', 'nginx'),
      panel('Service', '', 'prod', 'web'),
      panel('Service', '', 'prod', 'fallback'),
      panel('Secret', '', 'prod', 'tls-secret'),
    ]);
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
