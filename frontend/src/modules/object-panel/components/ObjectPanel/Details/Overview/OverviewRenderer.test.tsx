/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/OverviewRenderer.test.tsx
 *
 * Renderer-level behavior, independent of any single kind: a field's `render`, `label`, and
 * `fullWidth` resolvers must NOT run when the field's `hidden` predicate returns true. The row is
 * dropped, so evaluating those resolvers is wasted work and — for link builders that assume the
 * value is present — a latent throw on a row the user never sees.
 */

import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OverviewRenderer } from './OverviewRenderer';
import type { OverviewDescriptor } from './schema';

vi.mock('@shared/components/kubernetes/ResourceHeader', () => ({
  ResourceHeader: () => null,
}));
vi.mock('@shared/components/kubernetes/ResourceStatus', () => ({
  ResourceStatus: () => null,
}));
vi.mock('@shared/components/kubernetes/ResourceMetadata', () => ({
  ResourceMetadata: () => null,
}));

interface Row {
  name?: string;
  visibleVal?: string;
  hiddenVal?: string;
}

const getValueForLabel = (container: HTMLElement, label: string) => {
  const labelElement = Array.from(container.querySelectorAll<HTMLElement>('.overview-label')).find(
    (el) => el.textContent?.trim() === label
  );
  return labelElement?.parentElement?.querySelector<HTMLElement>('.overview-value') ?? null;
};

describe('OverviewRenderer hidden fields', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  const render = async (descriptor: OverviewDescriptor<Row>, data: Row) => {
    await act(async () => {
      root.render(<OverviewRenderer descriptor={descriptor} data={data} />);
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

  it('skips render/label/fullWidth resolvers for a hidden field and omits the row', async () => {
    const hiddenRender = vi.fn(() => 'should-not-run');
    const hiddenLabel = vi.fn(() => 'Hidden');
    const hiddenFullWidth = vi.fn(() => true);
    const visibleRender = vi.fn(() => 'shown');

    const descriptor = {
      displayKind: 'Test',
      dtoClass: class {},
      schema: {
        items: [
          {
            field: 'visibleVal',
            label: 'Visible',
            render: visibleRender,
            hidden: () => false,
          },
          {
            field: 'hiddenVal',
            label: hiddenLabel,
            render: hiddenRender,
            fullWidth: hiddenFullWidth,
            hidden: () => true,
          },
        ],
      },
    } as unknown as OverviewDescriptor<Row>;

    await render(descriptor, { name: 'x', visibleVal: 'v', hiddenVal: 'h' });

    // The hidden field's resolvers must never be invoked.
    expect(hiddenRender).not.toHaveBeenCalled();
    expect(hiddenLabel).not.toHaveBeenCalled();
    expect(hiddenFullWidth).not.toHaveBeenCalled();

    // The visible field still renders normally.
    expect(visibleRender).toHaveBeenCalledTimes(1);
    expect(getValueForLabel(container, 'Visible')?.textContent).toBe('shown');
    expect(getValueForLabel(container, 'Hidden')).toBeNull();
  });
});
