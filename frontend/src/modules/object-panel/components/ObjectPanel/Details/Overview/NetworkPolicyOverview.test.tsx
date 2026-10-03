/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/NetworkPolicyOverview.test.tsx
 */

import type { networkpolicy } from '@core/backend-api/models';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { networkPolicyDescriptor } from './descriptors/networkpolicy';
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

const policy = (
  overrides: Partial<networkpolicy.NetworkPolicyDetails>
): networkpolicy.NetworkPolicyDetails => ({
  kind: 'NetworkPolicy',
  name: 'payments-api',
  namespace: 'payments',
  details: '',
  podSelector: { matchLabels: { 'app.kubernetes.io/name': 'payments-api' } },
  policyTypes: ['Ingress', 'Egress'],
  ...overrides,
});

describe('NetworkPolicyOverview', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  const render = async (details: networkpolicy.NetworkPolicyDetails) => {
    await act(async () => {
      root.render(<OverviewRenderer descriptor={networkPolicyDescriptor} data={details} />);
      await Promise.resolve();
    });
  };

  const direction = (label: 'Ingress' | 'Egress') =>
    container.querySelector<HTMLElement>(`section[aria-label="${label}"]`);
  const rules = (label: 'Ingress' | 'Egress') =>
    Array.from(direction(label)?.querySelectorAll<HTMLElement>('ol > li') ?? []);
  const items = (scope: HTMLElement | undefined, listLabel: string) =>
    Array.from(
      scope?.querySelectorAll<HTMLElement>(`ul[aria-label="${listLabel}"] > li`) ?? [],
      (item) => item.textContent ?? ''
    );
  const selectedPods = (scope: HTMLElement | undefined) =>
    scope?.querySelector<HTMLElement>('[aria-label="Selected pods"]')?.textContent ?? '';

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

  it('shows each rule as sources flowing to the selected pods, keeping AND/OR peer grouping', async () => {
    await render(
      policy({
        ingressRules: [
          {
            from: [
              { podSelector: { matchLabels: { app: 'checkout-web' } } },
              {
                namespaceSelector: {
                  matchLabels: { 'kubernetes.io/metadata.name': 'monitoring' },
                },
                podSelector: { matchLabels: { app: 'prometheus' } },
              },
            ],
            ports: [{ protocol: 'TCP', port: '8080' }],
          },
          {
            from: [{ ipBlock: { cidr: '10.20.0.0/16', except: ['10.20.5.0/24'] } }],
            ports: [{ protocol: 'TCP', port: '8443' }],
          },
        ],
        egressRules: [
          {
            to: [{ podSelector: { matchLabels: { app: 'postgres' } } }],
            ports: [
              { protocol: 'UDP', port: '53' },
              { protocol: 'TCP', port: '30000', endPort: 32767 },
            ],
          },
        ],
      })
    );

    const [first, second] = rules('Ingress');
    const sources = items(first, 'Sources');
    // Two peers are alternatives (OR); a peer's namespace and pod selectors apply together (AND).
    expect(sources).toHaveLength(2);
    expect(sources[0]).toContain('payments');
    expect(sources[0]).toContain('app=checkout-web');
    expect(sources[1]).toContain('monitoring');
    expect(sources[1]).not.toContain('kubernetes.io/metadata.name');
    expect(sources[1]).toContain('app=prometheus');
    expect(selectedPods(first)).toContain('app.kubernetes.io/name=payments-api');
    expect(items(first, 'Ports')).toEqual(['TCP 8080']);

    expect(items(second, 'Sources')).toHaveLength(1);
    expect(items(second, 'Sources')[0]).toContain('10.20.0.0/16');
    // An ipBlock's except ranges are carved out of the allowed range, not more allowed addresses.
    expect(items(second, 'Excluded')).toEqual(['10.20.5.0/24']);

    // Egress flows the other way: the policy's pods are the source.
    const [egress] = rules('Egress');
    expect(selectedPods(egress)).toContain('app.kubernetes.io/name=payments-api');
    expect(items(egress, 'Destinations')).toHaveLength(1);
    expect(items(egress, 'Destinations')[0]).toContain('app=postgres');
    expect(items(egress, 'Ports')).toEqual(['UDP 53', 'TCP 30000-32767']);
  });

  it('keeps selector meaning: expressions, empty selectors, and rules without peers or ports', async () => {
    await render(
      policy({
        namespace: 'edge',
        podSelector: {
          matchExpressions: [{ key: 'tier', operator: 'In', values: ['frontend', 'edge'] }],
        },
        policyTypes: ['Ingress'],
        ingressRules: [
          { from: [{ namespaceSelector: {} }], ports: [{ protocol: 'TCP', port: 'http' }] },
          { ports: [{ protocol: 'UDP', port: '5353' }] },
          { from: [{ podSelector: {} }] },
        ],
      })
    );

    const [allNamespaces, anySource, samePods] = rules('Ingress');
    expect(selectedPods(allNamespaces)).toContain('tier In frontend, edge');
    expect(items(allNamespaces, 'Sources')[0]).toContain('any namespace');
    expect(items(anySource, 'Sources')).toEqual([expect.stringContaining('Any pod or IP address')]);
    // An empty pod selector without a namespace selector means every pod in the policy namespace.
    expect(items(samePods, 'Sources')[0]).toContain('edge');
    expect(items(samePods, 'Sources')[0]).toContain('All pods');
    expect(items(samePods, 'Ports')).toEqual(['All ports']);
  });

  it('names namespaces selected by their name label and keeps other namespace selectors as written', async () => {
    const nameLabel = 'kubernetes.io/metadata.name';
    await render(
      policy({
        policyTypes: ['Ingress'],
        ingressRules: [
          {
            from: [
              {
                namespaceSelector: {
                  matchExpressions: [
                    { key: nameLabel, operator: 'In', values: ['logging', 'tracing'] },
                  ],
                },
              },
              // Every selector requirement applies, so a name plus another label is not a plain name.
              {
                namespaceSelector: { matchLabels: { [nameLabel]: 'monitoring', team: 'platform' } },
              },
              {
                namespaceSelector: {
                  matchExpressions: [
                    { key: nameLabel, operator: 'NotIn', values: ['kube-system'] },
                  ],
                },
              },
            ],
          },
        ],
      })
    );

    const [named, mixed, negated] = items(rules('Ingress')[0], 'Sources');
    expect(named).toContain('logging, tracing');
    expect(named).not.toContain(nameLabel);
    expect(mixed).toContain(`${nameLabel}=monitoring`);
    expect(mixed).toContain('team=platform');
    expect(negated).toContain(`${nameLabel} NotIn kube-system`);
  });

  it('distinguishes a denied direction from one the policy does not restrict', async () => {
    await render(policy({ policyTypes: ['Ingress'] }));

    expect(rules('Ingress')).toHaveLength(0);
    expect(direction('Ingress')?.textContent).toContain('denied');
    expect(selectedPods(direction('Ingress') ?? undefined)).toContain('payments-api');
    expect(direction('Egress')?.textContent).not.toContain('denied');
    expect(direction('Egress')?.textContent).toContain('No egress rules');
  });
});
