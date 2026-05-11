import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { IconDebugOverlay } from './IconDebugOverlay';

describe('IconDebugOverlay', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeAll(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    container?.remove();
    document.body.innerHTML = '';
  });

  const renderOverlay = (onClose = vi.fn()) => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);

    act(() => {
      root.render(<IconDebugOverlay onClose={onClose} />);
    });
  };

  it('renders icon previews with source file and measured sizes', () => {
    renderOverlay();

    const overlay = document.body.querySelector('[data-testid="icon-debug-overlay"]');
    expect(overlay).not.toBeNull();
    expect(overlay?.querySelector('table.icon-debug-table--header')).not.toBeNull();
    expect(overlay?.querySelector('.icon-debug-table__body-scroll table')).not.toBeNull();
    const getHeaderText = (cell: Element) => cell.textContent?.replace(/[▲▼]/g, '');
    expect(
      Array.from(overlay?.querySelectorAll('th') ?? []).map((cell) => getHeaderText(cell))
    ).toEqual(['View', 'Size', 'Grid', 'Name', 'Source']);
    expect(
      Array.from(overlay?.querySelectorAll('thead button') ?? []).map((cell) => getHeaderText(cell))
    ).toEqual(['Size', 'Grid', 'Name', 'Source']);
    expect(
      Array.from(overlay?.querySelectorAll('table.icon-debug-table--header col') ?? []).map(
        (column) => column.className
      )
    ).toEqual([
      'icon-debug-table__preview-col',
      'icon-debug-table__metric-col',
      'icon-debug-table__metric-col',
      '',
      '',
    ]);
    expect(overlay?.textContent).toContain('CordonIcon');
    expect(overlay?.textContent).toContain('SharedIcons.tsx');
    expect(overlay?.textContent).toContain('24x24');
    expect(overlay?.textContent).toContain('ew-resize');
    expect(overlay?.querySelectorAll('.icon-debug-row__preview svg').length).toBeGreaterThan(0);
    expect(overlay?.querySelectorAll('.icon-debug__asset-preview').length).toBeGreaterThan(0);
  });

  it('renders component previews at their default svg size', () => {
    renderOverlay();

    const overlay = document.body.querySelector('[data-testid="icon-debug-overlay"]');
    const rows = Array.from(overlay?.querySelectorAll<HTMLTableRowElement>('tbody tr') ?? []);
    const dockBottomRow = rows.find((row) => row.textContent?.includes('DockBottomIcon'));
    const previewSvg = dockBottomRow?.querySelector('.icon-debug-row__preview svg');

    expect(previewSvg?.getAttribute('width')).toBe('24');
    expect(previewSvg?.getAttribute('height')).toBe('24');
  });

  it('closes from the debug overlay close button', () => {
    const onClose = vi.fn();
    renderOverlay(onClose);

    const closeButton = document.body.querySelector<HTMLButtonElement>(
      '[aria-label="Close debug overlay"]'
    );

    expect(closeButton).not.toBeNull();

    act(() => {
      closeButton?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
      closeButton?.click();
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('sorts by sortable icon table columns', () => {
    renderOverlay();

    const overlay = document.body.querySelector('[data-testid="icon-debug-overlay"]');
    const getFirstName = () =>
      overlay?.querySelector<HTMLTableRowElement>('tbody tr')?.querySelector('td:nth-child(4)')
        ?.textContent;
    const getHeaderButton = (name: string) =>
      Array.from(overlay?.querySelectorAll<HTMLButtonElement>('thead button') ?? []).find(
        (button) => button.textContent?.replace(/[▲▼]/g, '') === name
      );

    expect(getFirstName()).toBe('AdvancedIcon');

    act(() => {
      getHeaderButton('Size')?.click();
    });
    expect(getFirstName()).toBe('IconBarSeparatorIcon');

    act(() => {
      getHeaderButton('Grid')?.click();
    });
    expect(getFirstName()).toBe('IconBarSeparatorIcon');

    act(() => {
      getHeaderButton('Name')?.click();
    });
    expect(getFirstName()).toBe('AdvancedIcon');

    act(() => {
      getHeaderButton('Name')?.click();
    });
    expect(getFirstName()).toBe('ZoomOutIcon');

    act(() => {
      getHeaderButton('Source')?.click();
    });
    expect(getFirstName()).toBe('ew-resize');
  });
});
