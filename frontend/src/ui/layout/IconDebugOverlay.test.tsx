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

  const renderOverlay = () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);

    act(() => {
      root.render(<IconDebugOverlay onClose={vi.fn()} />);
    });
  };

  it('renders icon previews with source file and production consumers', () => {
    renderOverlay();

    const overlay = document.body.querySelector('[data-testid="icon-debug-overlay"]');
    expect(overlay).not.toBeNull();
    expect(overlay?.querySelector('table.icon-debug-table')).not.toBeNull();
    expect(
      Array.from(overlay?.querySelectorAll('th') ?? []).map((cell) => cell.textContent)
    ).toEqual(['Preview', 'Name', 'Source', 'Grid', 'Default', 'Usage']);
    expect(overlay?.textContent).toContain('CordonIcon');
    expect(overlay?.textContent).toContain('SharedIcons.tsx');
    expect(overlay?.textContent).toContain('shared/hooks/useObjectActions.tsx');
    expect(overlay?.textContent).toContain('24x24');
    expect(overlay?.textContent).toContain('rendered 16x16');
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

  it('sorts by sortable icon table columns', () => {
    renderOverlay();

    const overlay = document.body.querySelector('[data-testid="icon-debug-overlay"]');
    const getFirstName = () =>
      overlay?.querySelector<HTMLTableRowElement>('tbody tr')?.querySelector('td:nth-child(2)')
        ?.textContent;
    const getHeaderButton = (name: string) =>
      Array.from(overlay?.querySelectorAll<HTMLButtonElement>('thead button') ?? []).find(
        (button) => button.textContent === name
      );

    expect(getFirstName()).toBe('CordonIcon');

    act(() => {
      getHeaderButton('Name')?.click();
    });
    expect(getFirstName()).toBe('AdvancedIcon');

    act(() => {
      getHeaderButton('Source')?.click();
    });
    expect(getFirstName()).toBe('ew-resize');

    act(() => {
      getHeaderButton('Grid')?.click();
    });
    expect(getFirstName()).toBe('IconBarSeparatorIcon');
  });
});
