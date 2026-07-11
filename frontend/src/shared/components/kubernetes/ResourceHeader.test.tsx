/**
 * frontend/src/shared/components/kubernetes/ResourceHeader.test.tsx
 *
 * Test suite for ResourceHeader — Age (derived from the object's
 * creationTimestamp in panel context) and the Last Modified row.
 */

import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { formatAge } from '@/utils/ageFormatter';

const panel: {
  current: {
    objectData: unknown;
    creationTimestamp?: string | null;
    lastModified?: string | null;
  };
} = {
  current: {
    objectData: { clusterId: 'c1' },
    creationTimestamp: undefined,
    lastModified: undefined,
  },
};

vi.mock('@modules/object-panel/hooks/useObjectPanel', () => ({
  useObjectPanel: () => panel.current,
}));

const navigateToView = vi.fn();
vi.mock('@shared/hooks/useNavigateToView', () => ({
  useNavigateToView: () => ({ navigateToView }),
}));

import { ResourceHeader } from './ResourceHeader';

const labelOrder = (c: HTMLElement) =>
  Array.from(c.querySelectorAll('.overview-label')).map((e) => e.textContent);

const valueForLabel = (c: HTMLElement, label: string) => {
  const el = Array.from(c.querySelectorAll<HTMLElement>('.overview-label')).find(
    (e) => e.textContent === label
  );
  return el?.parentElement?.querySelector<HTMLElement>('.overview-value')?.textContent ?? null;
};

describe('ResourceHeader', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
    panel.current = {
      objectData: { clusterId: 'c1' },
      creationTimestamp: undefined,
      lastModified: undefined,
    };
  });

  const render = async () => {
    await act(async () => {
      root.render(<ResourceHeader kind="Deployment" name="web" />);
      await Promise.resolve();
    });
  };

  it('renders Age formatted from the object creationTimestamp in context', async () => {
    const created = '2020-01-01T00:00:00Z';
    panel.current = { objectData: { clusterId: 'c1' }, creationTimestamp: created };
    await render();

    // Formatted with the same formatter the Browse table uses, so the two
    // surfaces show byte-identical Age values.
    expect(valueForLabel(container, 'Age')).toBe(formatAge(created));
  });

  it('updates Age from the object creationTimestamp without receiving new panel data', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:10Z'));
    panel.current = {
      objectData: { clusterId: 'c1' },
      creationTimestamp: '2026-01-01T00:00:00Z',
    };
    await render();

    expect(valueForLabel(container, 'Age')).toBe('10s');

    await act(async () => {
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
    });

    expect(valueForLabel(container, 'Age')).toBe('11s');
  });

  it('omits the Age row when no creationTimestamp is available', async () => {
    panel.current = { objectData: { clusterId: 'c1' }, creationTimestamp: undefined };
    await render();

    expect(labelOrder(container)).not.toContain('Age');
  });

  it('renders Last Modified immediately after Age when available', async () => {
    panel.current = {
      objectData: { clusterId: 'c1' },
      creationTimestamp: '2020-01-01T00:00:00Z',
      lastModified: '2h',
    };
    await render();

    expect(valueForLabel(container, 'Last Modified')).toBe('2h');

    const order = labelOrder(container);
    expect(order).toContain('Age');
    expect(order.indexOf('Last Modified')).toBe(order.indexOf('Age') + 1);
  });

  it('omits the Last Modified row when unavailable', async () => {
    panel.current = {
      objectData: { clusterId: 'c1' },
      creationTimestamp: '2020-01-01T00:00:00Z',
      lastModified: undefined,
    };
    await render();

    expect(labelOrder(container)).toContain('Age');
    expect(labelOrder(container)).not.toContain('Last Modified');
  });

  it('omits the Last Modified row when the value is an empty string', async () => {
    panel.current = {
      objectData: { clusterId: 'c1' },
      creationTimestamp: '2020-01-01T00:00:00Z',
      lastModified: '',
    };
    await render();

    expect(labelOrder(container)).not.toContain('Last Modified');
  });

  it('alt-clicks the Namespace value to reveal the HOST object, not the Namespace kind', async () => {
    // The panel is showing a Pod in namespace "shop"; its details render the
    // namespace as a link.
    const hostObject = {
      kind: 'Pod',
      name: 'web-5',
      namespace: 'shop',
      clusterId: 'c1',
      group: '',
      version: 'v1',
    };
    panel.current = { objectData: hostObject };
    navigateToView.mockClear();

    await act(async () => {
      root.render(<ResourceHeader kind="Pod" name="web-5" namespace="shop" />);
      await Promise.resolve();
    });

    const nsLabel = Array.from(container.querySelectorAll<HTMLElement>('.overview-label')).find(
      (el) => el.textContent === 'Namespace'
    );
    const nsLink = nsLabel?.parentElement?.querySelector<HTMLElement>('.object-panel-link');
    expect(nsLink?.textContent).toBe('shop');

    act(() => {
      nsLink?.dispatchEvent(new MouseEvent('click', { bubbles: true, altKey: true }));
    });

    // Reveals the host object (which selects its namespace in the sidebar),
    // NOT a { kind: 'Namespace' } ref (which routed to Cluster → Config).
    expect(navigateToView).toHaveBeenCalledTimes(1);
    const ref = navigateToView.mock.calls[0][0];
    expect(ref.kind).toBe('Pod');
    expect(ref.name).toBe('web-5');
    expect(ref.namespace).toBe('shop');
  });
});
