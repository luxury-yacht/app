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
    expect(overlay?.textContent).toContain('CordonIcon');
    expect(overlay?.textContent).toContain('SharedIcons.tsx');
    expect(overlay?.textContent).toContain('shared/hooks/useObjectActions.tsx');
    expect(overlay?.textContent).toContain('grid 24x24');
    expect(overlay?.textContent).toContain('rendered 16x16');
    expect(overlay?.textContent).toContain('ew-resize');
    expect(overlay?.querySelectorAll('.icon-debug-row__preview svg').length).toBeGreaterThan(0);
    expect(overlay?.querySelectorAll('.icon-debug__asset-preview').length).toBeGreaterThan(0);
  });
});
