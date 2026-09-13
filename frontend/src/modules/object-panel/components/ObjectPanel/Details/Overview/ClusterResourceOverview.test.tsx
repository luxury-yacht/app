/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/ClusterResourceOverview.test.tsx
 *
 * Renders the cluster-scoped config kinds through the descriptor-driven OverviewRenderer (X1).
 * Fixtures are DTO-shaped (raw backend field names) rather than the flattened props the legacy
 * ClusterResourceOverview component consumed.
 */

import type React from 'react';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  crdDescriptor,
  ingressClassDescriptor,
  namespaceDescriptor,
  validatingWebhookDescriptor,
} from './descriptors/clusterresource';
import { OverviewRenderer } from './OverviewRenderer';
import type { OverviewDescriptor } from './schema';

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

vi.mock('@shared/components/kubernetes/ResourceStatus', () => ({
  ResourceStatus: (props: { status?: string }) => (
    <div data-testid="resource-status">{props.status}</div>
  ),
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

describe('ClusterResourceOverview', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  const renderOverview = async <T,>(descriptor: OverviewDescriptor<T>, fixture: DeepPartial<T>) => {
    const data = fixture as T;
    await act(async () => {
      root.render(
        <OverviewRenderer<T>
          descriptor={descriptor}
          data={data}
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

  it('renders namespace workload summary and status', async () => {
    await renderOverview(namespaceDescriptor, {
      kind: 'Namespace',
      name: 'prod',
      status: 'Active',
      hasWorkloads: true,
    });

    expect(container.textContent).toContain('Active');
    expect(getValueForLabel(container, 'Has Workloads')?.textContent).toBe('Yes');
  });

  it('projects CRD versions and their deprecation state', async () => {
    // Realistic multi-version shape: v1 is the primary (storage) version,
    // v1beta1 is served-only, v1alpha1 is served but deprecated.
    await renderOverview(crdDescriptor, {
      kind: 'CustomResourceDefinition',
      name: 'widgets.example.com',
      group: 'example.com',
      scope: 'Namespaced',
      versions: [
        { name: 'v1', served: true, storage: true },
        { name: 'v1beta1', served: true, storage: false },
        { name: 'v1alpha1', served: true, storage: false, deprecated: true },
      ],
      names: { kind: 'Widget', plural: 'widgets' },
      labels: { team: 'platform' },
      annotations: { owner: 'crd-admins' },
    });

    expect(getValueForLabel(container, 'Group')?.textContent).toBe('example.com');

    const versionsCell = getValueForLabel(container, 'Versions');
    expect(versionsCell).toBeTruthy();
    // Primary first (bare name), then non-primary in input order.
    const rows = Array.from(versionsCell?.querySelectorAll<HTMLDivElement>('div > div') ?? []);
    expect(rows.length).toBe(3);
    expect(rows[0].textContent).toBe('v1');
    // v1beta1 has no flags: the row is just the version name, no parens.
    expect(rows[1].textContent).toBe('v1beta1');
    expect(rows[2].textContent).toContain('v1alpha1');
    expect(rows[2].textContent).toContain('deprecated');

    expect(getValueForLabel(container, 'Plural')?.textContent).toBe('widgets');
    expect(container.textContent).toContain('platform');
    expect(container.textContent).toContain('crd-admins');
  });

  it('hoists the primary version to the top regardless of spec order', async () => {
    // Non-primary versions first in the input; primary in the middle.
    // The UI should reorder so the primary renders at the top while the
    // relative order of the non-primary versions is preserved.
    await renderOverview(crdDescriptor, {
      kind: 'CustomResourceDefinition',
      name: 'hoist.example.com',
      group: 'example.com',
      scope: 'Namespaced',
      versions: [
        { name: 'v1alpha1', served: true, storage: false, deprecated: true },
        { name: 'v1beta1', served: true, storage: false },
        { name: 'v1', served: true, storage: true }, // primary — was last, should render first
        { name: 'v2alpha1', served: true, storage: false },
      ],
      names: { kind: 'Hoist', plural: 'hoists' },
    });

    const versionsCell = getValueForLabel(container, 'Versions');
    const rows = Array.from(versionsCell?.querySelectorAll<HTMLDivElement>('div > div') ?? []);
    expect(rows.length).toBe(4);

    // Primary row is first, rendered as just the bare version name.
    expect(rows[0].textContent).toBe('v1');

    // Non-primary versions retain their original order.
    expect(rows[1].textContent).toContain('v1alpha1');
    expect(rows[2].textContent).toBe('v1beta1');
    expect(rows[3].textContent).toBe('v2alpha1');
  });

  it('flags a version that is defined but not currently served', async () => {
    // Rare/transient state: a version that has been removed from the
    // served set during a migration but still appears in spec.versions.
    await renderOverview(crdDescriptor, {
      kind: 'CustomResourceDefinition',
      name: 'legacy.example.com',
      group: 'example.com',
      scope: 'Namespaced',
      versions: [
        { name: 'v1', served: true, storage: true },
        { name: 'v1alpha1', served: false, storage: false },
      ],
      names: { kind: 'Legacy', plural: 'legacies' },
    });

    const versionsCell = getValueForLabel(container, 'Versions');
    const rows = Array.from(versionsCell?.querySelectorAll<HTMLDivElement>('div > div') ?? []);
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toBe('v1');
    expect(rows[1].textContent).toContain('v1alpha1');
    expect(rows[1].textContent).toContain('not served');
  });

  it('preserves both not-served and deprecated warnings for a retiring version', async () => {
    await renderOverview(crdDescriptor, {
      kind: 'CustomResourceDefinition',
      name: 'retiring.example.com',
      group: 'example.com',
      scope: 'Namespaced',
      versions: [
        { name: 'v1', served: true, storage: true },
        { name: 'v1alpha1', served: false, storage: false, deprecated: true },
      ],
      names: { kind: 'Retiring', plural: 'retirings' },
    });

    const versionsCell = getValueForLabel(container, 'Versions');
    const rows = Array.from(versionsCell?.querySelectorAll<HTMLDivElement>('div > div') ?? []);
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toBe('v1');
    expect(rows[1].textContent).toContain('v1alpha1');
    expect(rows[1].textContent).toContain('not served');
    expect(rows[1].textContent).toContain('deprecated');
  });

  it('hides the Versions row when the list is empty', async () => {
    // Defensive: a malformed or partially-loaded CRD with no versions
    // should not crash or show "undefined". OverviewItem collapses rows
    // whose value is undefined/null, so the Versions row is absent
    // entirely rather than showing a stray placeholder.
    await renderOverview(crdDescriptor, {
      kind: 'CustomResourceDefinition',
      name: 'empty.example.com',
      group: 'example.com',
      scope: 'Namespaced',
      versions: [],
      names: { kind: 'Empty', plural: 'empties' },
    });

    expect(getValueForLabel(container, 'Versions')).toBeNull();
    // Other CRD fields still render normally.
    expect(getValueForLabel(container, 'Group')?.textContent).toBe('example.com');
    expect(getValueForLabel(container, 'Scope')?.textContent).toBe('Namespaced');
  });

  it('renders webhook configuration details', async () => {
    await renderOverview(validatingWebhookDescriptor, {
      kind: 'ValidatingWebhookConfiguration',
      name: 'policy-webhooks',
      webhooks: [{}, {}, {}],
    });

    expect(getValueForLabel(container, 'Webhooks')?.textContent).toMatch(/\b3\b/);
  });

  it('renders ingress class controller information', async () => {
    await renderOverview(ingressClassDescriptor, {
      kind: 'IngressClass',
      name: 'nginx',
      controller: 'k8s.io/ingress-nginx',
      isDefault: true,
      // The "Used by" count is derived from the length of the ingresses list.
      ingresses: Array.from({ length: 12 }, (_, i) => `ingress-${i}`),
      labels: { app: 'ingress' },
      annotations: { owner: 'platform' },
    });

    expect(getValueForLabel(container, 'Controller')?.textContent).toBe('k8s.io/ingress-nginx');
    const defaultRow = getValueForLabel(container, 'Default');
    expect(defaultRow?.textContent).toBe('True');
    expect(defaultRow?.querySelector('.status-chip--healthy')).toBeTruthy();
    expect(getValueForLabel(container, 'Used by')?.textContent).toMatch(/\b12\b/);
    expect(container.textContent).toContain('ingress');
    expect(container.textContent).toContain('platform');
  });

  it('renders the IngressClass parameters reference', async () => {
    await renderOverview(ingressClassDescriptor, {
      kind: 'IngressClass',
      name: 'nginx',
      controller: 'k8s.io/ingress-nginx',
      isDefault: false,
      parameters: {
        kind: 'IngressParameters',
        name: 'nginx-config',
        scope: 'Cluster',
      },
    });

    // CRD-backed parameter kinds can't build a strict object ref (no
    // apiVersion on the wire), so they render as plain text rather than as
    // a link.
    const params = getValueForLabel(container, 'Parameters');
    expect(params?.textContent).toContain('nginx-config');
    expect(params?.querySelector('a')).toBeNull();
  });
});
