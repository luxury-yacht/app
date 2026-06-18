/**
 * frontend/src/shared/components/kubernetes/ResourceHeader.test.tsx
 *
 * Test suite for ResourceHeader — focuses on the Last Modified row.
 */

import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const panel: { current: { objectData: unknown; lastModified?: string | null } } = {
  current: { objectData: { clusterId: 'c1' }, lastModified: undefined },
};

vi.mock('@modules/object-panel/hooks/useObjectPanel', () => ({
  useObjectPanel: () => panel.current,
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

describe('ResourceHeader Last Modified', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    panel.current = { objectData: { clusterId: 'c1' }, lastModified: undefined };
  });

  const render = async () => {
    await act(async () => {
      root.render(<ResourceHeader kind="Deployment" name="web" age="2d" />);
      await Promise.resolve();
    });
  };

  it('renders Last Modified immediately after Age when available', async () => {
    panel.current = { objectData: { clusterId: 'c1' }, lastModified: '2h' };
    await render();

    expect(valueForLabel(container, 'Last Modified')).toBe('2h');

    const order = labelOrder(container);
    expect(order).toContain('Age');
    expect(order.indexOf('Last Modified')).toBe(order.indexOf('Age') + 1);
  });

  it('omits the Last Modified row when unavailable', async () => {
    panel.current = { objectData: { clusterId: 'c1' }, lastModified: undefined };
    await render();

    expect(labelOrder(container)).toContain('Age');
    expect(labelOrder(container)).not.toContain('Last Modified');
  });

  it('omits the Last Modified row when the value is an empty string', async () => {
    panel.current = { objectData: { clusterId: 'c1' }, lastModified: '' };
    await render();

    expect(labelOrder(container)).not.toContain('Last Modified');
  });
});
