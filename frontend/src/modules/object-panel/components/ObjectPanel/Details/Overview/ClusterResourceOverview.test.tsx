/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/ClusterResourceOverview.test.tsx
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

  it('renders CRD metadata with actual version names and parenthesized flags', async () => {
    // Realistic multi-version shape: v1 is the primary (storage) version,
    // v1beta1 is served-only, v1alpha1 is served but deprecated.
    await renderComponent({
      kind: 'CustomResourceDefinition',
      name: 'widgets.example.com',
      group: 'example.com',
      scope: 'Namespaced',
      versions: [
        { name: 'v1', served: true, storage: true },
        { name: 'v1beta1', served: true, storage: false },
        { name: 'v1alpha1', served: true, storage: false, deprecated: true },
      ],
      names: { kind: 'Widget', plural: 'widgets' } as any,
      labels: { team: 'platform' },
      annotations: { owner: 'crd-admins' },
    });

    expect(getValueForLabel(container, 'Group')?.textContent).toBe('example.com');

    // CRD fields render in a fixed order: Scope → Group → Versions → Kind → Plural.
    const labels = Array.from(container.querySelectorAll<HTMLElement>('.overview-label'))
      .map((el) => el.textContent?.trim())
      .filter((label): label is string =>
        ['Scope', 'Group', 'Versions', 'Kind', 'Plural'].includes(label ?? '')
      );
    expect(labels).toEqual(['Scope', 'Group', 'Versions', 'Kind', 'Plural']);

    // Group/Kind/Plural values render in the monospace token font.
    const groupSpan = getValueForLabel(container, 'Group')?.querySelector<HTMLSpanElement>('span');
    expect(groupSpan?.style.fontFamily).toBe('var(--font-family-mono)');
    const kindSpan = getValueForLabel(container, 'Kind')?.querySelector<HTMLSpanElement>('span');
    expect(kindSpan?.style.fontFamily).toBe('var(--font-family-mono)');
    const pluralSpan = getValueForLabel(container, 'Plural')?.querySelector<HTMLSpanElement>(
      'span'
    );
    expect(pluralSpan?.style.fontFamily).toBe('var(--font-family-mono)');

    // Scope stays in the regular font — no mono span inside the value.
    const scopeValue = getValueForLabel(container, 'Scope');
    expect(scopeValue?.textContent).toBe('Namespaced');
    expect(scopeValue?.querySelector('span[style*="mono"]')).toBeNull();

    // Versions cell should contain each version name and their flags in
    // parens, not the legacy "N version(s)" placeholder and not the
    // Kubernetes-internal "storage" term. The primary version is
    // indicated by position (top) and default text color, NOT by a
    // "(primary)" annotation — the label would be redundant.
    const versionsCell = getValueForLabel(container, 'Versions');
    expect(versionsCell).toBeTruthy();
    const versionsText = versionsCell?.textContent ?? '';
    expect(versionsText).not.toContain('version(s)');
    expect(versionsText).not.toContain('storage');
    expect(versionsText).not.toContain('primary'); // communicated by position + color
    expect(versionsText).toContain('v1alpha1 (deprecated)');

    // Primary first (bare name), then non-primary in input order.
    const rows = Array.from(versionsCell?.querySelectorAll<HTMLDivElement>('div > div') ?? []);
    expect(rows.length).toBe(3);
    expect(rows[0].textContent).toBe('v1');
    // v1beta1 has no flags: the row is just the version name, no parens.
    expect(rows[1].textContent).toBe('v1beta1');
    expect(rows[2].textContent).toBe('v1alpha1 (deprecated)');

    // Only non-primary rows get the secondary text color.
    expect(rows[0].style.color).toBe('');
    expect(rows[1].style.color).toBe('var(--color-text-secondary)');
    expect(rows[2].style.color).toBe('var(--color-text-secondary)');

    expect(getValueForLabel(container, 'Plural')?.textContent).toBe('widgets');
    expect(container.textContent).toContain('Labels');
    expect(container.textContent).toContain('team:');
    expect(container.textContent).toContain('platform');
    expect(container.textContent).toContain('Annotations');
    expect(container.textContent).toContain('owner:');
    expect(container.textContent).toContain('crd-admins');
  });

  it('hoists the primary version to the top regardless of spec order', async () => {
    // Non-primary versions first in the input; primary in the middle.
    // The UI should reorder so the primary renders at the top while the
    // relative order of the non-primary versions is preserved.
    await renderComponent({
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
      names: { kind: 'Hoist', plural: 'hoists' } as any,
    });

    const versionsCell = getValueForLabel(container, 'Versions');
    const rows = Array.from(versionsCell?.querySelectorAll<HTMLDivElement>('div > div') ?? []);
    expect(rows.length).toBe(4);

    // Primary row is first, rendered as just the bare version name.
    expect(rows[0].textContent).toBe('v1');
    expect(rows[0].style.color).toBe('');

    // Non-primary rows in original spec order, all in secondary color.
    expect(rows[1].textContent).toBe('v1alpha1 (deprecated)');
    expect(rows[1].style.color).toBe('var(--color-text-secondary)');
    expect(rows[2].textContent).toBe('v1beta1');
    expect(rows[2].style.color).toBe('var(--color-text-secondary)');
    expect(rows[3].textContent).toBe('v2alpha1');
    expect(rows[3].style.color).toBe('var(--color-text-secondary)');
  });

  it('renders a single-version CRD as just the bare version name', async () => {
    // The common case: one version, which is both served and storage.
    // No "(primary)" annotation — the top-of-list position and default
    // text color are the indication.
    await renderComponent({
      kind: 'CustomResourceDefinition',
      name: 'gadgets.example.com',
      group: 'example.com',
      scope: 'Cluster',
      versions: [{ name: 'v1', served: true, storage: true }],
      names: { kind: 'Gadget', plural: 'gadgets' } as any,
    });

    const versionsCell = getValueForLabel(container, 'Versions');
    const rows = Array.from(versionsCell?.querySelectorAll<HTMLDivElement>('div > div') ?? []);
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toBe('v1');
    expect(rows[0].style.color).toBe('');
  });

  it('flags a version that is defined but not currently served', async () => {
    // Rare/transient state: a version that has been removed from the
    // served set during a migration but still appears in spec.versions.
    await renderComponent({
      kind: 'CustomResourceDefinition',
      name: 'legacy.example.com',
      group: 'example.com',
      scope: 'Namespaced',
      versions: [
        { name: 'v1', served: true, storage: true },
        { name: 'v1alpha1', served: false, storage: false },
      ],
      names: { kind: 'Legacy', plural: 'legacies' } as any,
    });

    const versionsCell = getValueForLabel(container, 'Versions');
    const rows = Array.from(versionsCell?.querySelectorAll<HTMLDivElement>('div > div') ?? []);
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toBe('v1');
    expect(rows[1].textContent).toBe('v1alpha1 (not served)');
  });

  it('combines multiple flags with a comma inside the parens', async () => {
    // A version that's both deprecated and not served — unusual but
    // possible during a CRD retirement cycle. Flags should be joined by
    // a comma inside a single set of parens rather than rendering two
    // separate (deprecated)(not served) groups.
    await renderComponent({
      kind: 'CustomResourceDefinition',
      name: 'retiring.example.com',
      group: 'example.com',
      scope: 'Namespaced',
      versions: [
        { name: 'v1', served: true, storage: true },
        { name: 'v1alpha1', served: false, storage: false, deprecated: true },
      ],
      names: { kind: 'Retiring', plural: 'retirings' } as any,
    });

    const versionsCell = getValueForLabel(container, 'Versions');
    const rows = Array.from(versionsCell?.querySelectorAll<HTMLDivElement>('div > div') ?? []);
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toBe('v1');
    expect(rows[1].textContent).toBe('v1alpha1 (not served, deprecated)');
  });

  it('hides the Versions row when the list is empty', async () => {
    // Defensive: a malformed or partially-loaded CRD with no versions
    // should not crash or show "undefined". OverviewItem collapses rows
    // whose value is undefined/null, so the Versions row is absent
    // entirely rather than showing a stray placeholder.
    await renderComponent({
      kind: 'CustomResourceDefinition',
      name: 'empty.example.com',
      group: 'example.com',
      scope: 'Namespaced',
      versions: [],
      names: { kind: 'Empty', plural: 'empties' } as any,
    });

    expect(getValueForLabel(container, 'Versions')).toBeNull();
    // Other CRD fields still render normally.
    expect(getValueForLabel(container, 'Group')?.textContent).toBe('example.com');
    expect(getValueForLabel(container, 'Scope')?.textContent).toBe('Namespaced');
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
