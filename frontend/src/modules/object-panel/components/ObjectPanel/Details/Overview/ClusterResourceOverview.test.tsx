/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/ClusterResourceOverview.test.tsx
 *
 * Tests for ClusterResourceOverview.
 */
import React from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ClusterResourceOverview } from './ClusterResourceOverview';

vi.mock('@shared/components/kubernetes/ResourceHeader', () => ({
  ResourceHeader: (props: any) => (
    <div data-testid="resource-header">
      {props.kind}:{props.name}
    </div>
  ),
}));

vi.mock('@shared/components/kubernetes/ResourceStatus', () => ({
  ResourceStatus: (props: any) => <div data-testid="resource-status">{props.status}</div>,
}));

const getValueForLabel = (container: HTMLElement, label: string) => {
  const labelElement = Array.from(container.querySelectorAll<HTMLElement>('.overview-label')).find(
    (el) => el.textContent?.trim() === label
  );
  return labelElement?.parentElement?.querySelector<HTMLElement>('.overview-value') ?? null;
};

describe('ClusterResourceOverview', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  const renderComponent = async (props: React.ComponentProps<typeof ClusterResourceOverview>) => {
    await act(async () => {
      root.render(<ClusterResourceOverview {...props} />);
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

  it('renders namespace workload summary and status', async () => {
    await renderComponent({
      kind: 'Namespace',
      name: 'prod',
      status: 'Active',
      hasWorkloads: true,
    });

    expect(container.textContent).toContain('Active');
    expect(getValueForLabel(container, 'Has Workloads')?.textContent).toBe('Yes');
  });

  it('renders CRD metadata and version counts', async () => {
    await renderComponent({
      kind: 'CustomResourceDefinition',
      name: 'widgets.example.com',
      group: 'example.com',
      scope: 'Namespaced',
      versions: [{}, {}] as any,
      names: { kind: 'Widget', plural: 'widgets' } as any,
      labels: { team: 'platform' },
      annotations: { owner: 'crd-admins' },
    });

    expect(getValueForLabel(container, 'Group')?.textContent).toBe('example.com');
    expect(getValueForLabel(container, 'Versions')?.textContent).toBe('2 version(s)');
    expect(getValueForLabel(container, 'Plural')?.textContent).toBe('widgets');
    expect(container.textContent).toContain('Labels');
    expect(container.textContent).toContain('team:');
    expect(container.textContent).toContain('platform');
    expect(container.textContent).toContain('Annotations');
    expect(container.textContent).toContain('owner:');
    expect(container.textContent).toContain('crd-admins');
  });

  it('renders webhook configuration details', async () => {
    await renderComponent({
      kind: 'ValidatingWebhookConfiguration',
      name: 'policy-webhooks',
      webhooks: [{}, {}, {}] as any,
    });

    expect(getValueForLabel(container, 'Webhooks')?.textContent).toBe('3 webhook(s)');
  });

  it('renders ingress class controller information', async () => {
    await renderComponent({
      kind: 'IngressClass',
      name: 'nginx',
      controller: 'k8s.io/ingress-nginx',
      isDefault: true,
      labels: { app: 'ingress' },
      annotations: { owner: 'platform' },
    });

    expect(getValueForLabel(container, 'Controller')?.textContent).toBe('k8s.io/ingress-nginx');
    expect(getValueForLabel(container, 'Default Class')?.textContent).toBe('Yes');
    expect(container.textContent).toContain('Labels');
    expect(container.textContent).toContain('app:');
    expect(container.textContent).toContain('ingress');
    expect(container.textContent).toContain('Annotations');
    expect(container.textContent).toContain('owner:');
    expect(container.textContent).toContain('platform');
  });
});
