import React from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NetworkPolicyOverview } from './NetworkPolicyOverview';

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

describe('NetworkPolicyOverview', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  const renderComponent = async (props: React.ComponentProps<typeof NetworkPolicyOverview>) => {
    await act(async () => {
      root.render(<NetworkPolicyOverview {...props} />);
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

  it('renders selectors, policy types, and ingress/egress rules', async () => {
    await renderComponent({
      networkPolicyDetails: {
        name: 'restrictive-policy',
        namespace: 'prod',
        age: '1d',
        podSelector: { app: 'web', tier: 'frontend' },
        policyTypes: ['Ingress', 'Egress'],
        ingressRules: [
          {
            from: [
              {
                namespaceSelector: { team: 'platform' },
              },
              {
                ipBlock: { cidr: '10.0.0.0/24', except: ['10.0.0.10/32'] },
              },
            ],
            ports: [
              { protocol: 'TCP', port: 80 },
              { protocol: 'TCP', port: 443, endPort: 445 },
            ],
          },
        ],
        egressRules: [
          {
            to: [
              {
                podSelector: { app: 'api' },
              },
            ],
            ports: [{ protocol: 'TCP', port: 5432 }],
          },
        ],
        labels: {},
        annotations: {},
      } as any,
    });

    expect(getValueForLabel(container, 'Pod Selector')?.textContent).toContain('app=web');
    expect(getValueForLabel(container, 'Policy Types')?.textContent).toBe('Ingress, Egress');
    const ingressValue = getValueForLabel(container, 'Ingress Rules');
    expect(ingressValue?.textContent).toContain('platform');
    expect(ingressValue?.textContent).toContain('10.0.0.0/24');
    expect(ingressValue?.textContent).toContain('TCP/80');
    const egressValue = getValueForLabel(container, 'Egress Rules');
    expect(egressValue?.textContent).toContain('app=api');
    expect(egressValue?.textContent).toContain('5432');
  });

  it('defaults pod selector message when no selector is provided', async () => {
    await renderComponent({
      networkPolicyDetails: {
        name: 'open-policy',
        namespace: 'default',
        age: '3h',
        podSelector: {},
        policyTypes: [],
        labels: {},
        annotations: {},
      } as any,
    });

    expect(getValueForLabel(container, 'Pod Selector')?.textContent).toBe('All pods in namespace');
    expect(getValueForLabel(container, 'Policy Types')?.textContent).toBe('None');
  });
});
