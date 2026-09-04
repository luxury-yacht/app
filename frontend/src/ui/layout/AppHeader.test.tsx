import { ModalStateProvider } from '@core/contexts/ModalStateContext';
import { KeyboardProvider } from '@ui/shortcuts';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AppHeader from './AppHeader';
import { focusPreviousRegionBeforeSidebar } from './appFocusRegions';

const runtimeMock = vi.hoisted(() => ({
  closeWindow: vi.fn(),
  isWindowMaximised: vi.fn(() => Promise.resolve(false)),
  minimiseWindow: vi.fn(),
  toggleMaximise: vi.fn(),
}));

const reportOperationalError = vi.hoisted(() => vi.fn());
vi.mock('@/utils/errorHandler', () => ({ reportOperationalError }));

const platformMock = vi.hoisted(() => ({
  isMacPlatform: vi.fn(() => false),
  isWindowsPlatform: vi.fn(() => true),
}));

vi.mock('@ui/favorites/FavMenuDropdown', () => ({
  default: () => <button type="button">Favorites</button>,
}));

vi.mock('@ui/status/ConnectivityStatus', () => ({
  default: () => <div>Connectivity</div>,
}));

vi.mock('@ui/status/MetricsStatus', () => ({
  default: () => <div>Metrics</div>,
}));

vi.mock('@ui/status/SessionsStatus', () => ({
  default: () => <div>Sessions</div>,
}));

vi.mock('@core/desktop-runtime', async () => {
  const actual = await vi.importActual<object>('@core/desktop-runtime');
  return {
    ...actual,
    closeWindow: runtimeMock.closeWindow,
    isWindowMaximised: runtimeMock.isWindowMaximised,
    minimiseWindow: runtimeMock.minimiseWindow,
    toggleMaximise: runtimeMock.toggleMaximise,
  };
});

vi.mock('@/utils/platform', () => ({
  isMacPlatform: platformMock.isMacPlatform,
  isWindowsPlatform: platformMock.isWindowsPlatform,
  usesCustomWindowFrame: () => !platformMock.isMacPlatform(),
}));

describe('AppHeader', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    platformMock.isMacPlatform.mockReturnValue(false);
    platformMock.isWindowsPlatform.mockReturnValue(true);
    reportOperationalError.mockClear();
    runtimeMock.closeWindow.mockReset().mockResolvedValue(undefined);
    runtimeMock.isWindowMaximised.mockReset();
    runtimeMock.isWindowMaximised.mockResolvedValue(false);
    runtimeMock.minimiseWindow.mockReset().mockResolvedValue(undefined);
    runtimeMock.toggleMaximise.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    document.body.classList.remove('modal-surface-open');
    document.body.style.cursor = '';
    delete document.body.dataset.windowResizeCursor;
  });

  const renderHeader = () => {
    root.render(
      <ModalStateProvider>
        <KeyboardProvider>
          <AppHeader />
        </KeyboardProvider>
      </ModalStateProvider>
    );
  };

  it.each([false, true])(
    'returns from the sidebar to the final header control (mac=%s)',
    (isMac) => {
      platformMock.isMacPlatform.mockReturnValue(isMac);
      act(() => renderHeader());
      expect(focusPreviousRegionBeforeSidebar()).toBe(true);
      expect(document.activeElement?.getAttribute('aria-label')).toBe(
        isMac ? 'Command Palette' : 'Close window'
      );
      expect(container.querySelectorAll('[data-app-header-last-focusable="true"]')).toHaveLength(1);
    }
  );

  it.each([
    ['Minimise window', 'minimiseWindow', 'minimise-window'],
    ['Maximise window', 'toggleMaximise', 'toggle-maximise-window'],
    ['Close window', 'closeWindow', 'close-window'],
    ['Toggle window maximize', 'toggleMaximise', 'toggle-maximise-window'],
  ] as const)('reports failures from %s', async (label, operation, action) => {
    const error = new Error('Window operation failed');
    runtimeMock[operation].mockRejectedValueOnce(error);
    await act(async () => {
      root.render(<AppHeader mode="panel" />);
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)?.click();
    });
    expect(reportOperationalError).toHaveBeenCalledWith(error, { source: 'AppHeader', action });
  });

  it('renders header controls in the expected tab order', () => {
    act(() => {
      renderHeader();
    });

    const focusables = Array.from(
      container.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )
    );

    expect(
      focusables.map((element) => element.getAttribute('aria-label') || element.textContent)
    ).toEqual([
      'File menu',
      'Edit menu',
      'View menu',
      'Window menu',
      ...(import.meta.env.DEV ? ['Debug menu'] : []),
      'Help menu',
      'Toggle window maximize',
      'Favorites',
      'Command Palette',
      'Minimise window',
      'Maximise window',
      'Close window',
    ]);

    expect(container.querySelector('.app-header--custom-frame')).not.toBeNull();
    expect(container.querySelector('[role="menubar"]')).not.toBeNull();
  });

  it('keeps the native menu and traffic-light frame for a mac workspace', () => {
    platformMock.isMacPlatform.mockReturnValue(true);

    act(() => {
      renderHeader();
    });

    expect(container.querySelector('.app-header--mac')).not.toBeNull();
    expect(container.querySelector('.app-header--custom-frame')).toBeNull();
    expect(container.querySelector('[role="menubar"]')).toBeNull();
    expect(container.querySelector('.app-header-window-controls')).toBeNull();
  });

  it('renders custom window controls for a non-mac panel window', () => {
    act(() => {
      root.render(<AppHeader mode="panel" />);
    });

    expect(container.querySelector('.app-header-drag-control')).not.toBeNull();
    expect(container.querySelector('.app-header--custom-frame')).not.toBeNull();
    expect(container.querySelector('.app-header-controls')).toBeNull();
    expect(container.querySelector('[aria-label="Minimise window"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Maximise window"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Close window"]')).not.toBeNull();
    expect(container.textContent).not.toContain('Connectivity');
    expect(container.textContent).not.toContain('Metrics');
    expect(container.textContent).not.toContain('Sessions');
    expect(container.textContent).not.toContain('Favorites');
    expect(container.querySelector('[aria-label="Command Palette"]')).toBeNull();
    expect(container.querySelector('.app-header--linux')).toBeNull();
  });

  it('marks Linux custom frames for the shared window outline', () => {
    platformMock.isWindowsPlatform.mockReturnValue(false);

    act(() => {
      root.render(<AppHeader mode="panel" />);
    });

    expect(container.querySelector('.app-header--linux')).not.toBeNull();
  });

  it('projects Wails edge detection to a directional cursor for custom frames', () => {
    act(() => {
      root.render(<AppHeader mode="panel" />);
    });
    document.body.style.cursor = 'ns-resize';

    act(() => {
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 400, clientY: 1 }));
    });

    expect(document.body.style.cursor).toBe('n-resize');
    expect(document.body.dataset.windowResizeCursor).toBe('n-resize');
  });

  it('uses compact app-owned glyphs instead of operating-system chrome symbols', () => {
    act(() => {
      root.render(<AppHeader mode="panel" />);
    });

    const glyphs = Array.from(
      container.querySelectorAll<SVGElement>('.app-header-window-control-glyph')
    );
    expect(glyphs).toHaveLength(3);
    expect(glyphs.map((glyph) => glyph.querySelector('path')?.getAttribute('d'))).toEqual([
      'M5 12h8',
      'M6.5 4.5h-2v2M11.5 4.5h2v2M6.5 13.5h-2v-2M11.5 13.5h2v-2',
      'm5 5 8 8m0-8-8 8',
    ]);
  });

  it('routes custom panel controls through the desktop runtime', () => {
    act(() => {
      root.render(<AppHeader mode="panel" />);
    });

    act(() => {
      container.querySelector<HTMLButtonElement>('[aria-label="Minimise window"]')?.click();
      container.querySelector<HTMLButtonElement>('[aria-label="Maximise window"]')?.click();
      container.querySelector<HTMLButtonElement>('[aria-label="Close window"]')?.click();
    });

    expect(runtimeMock.minimiseWindow).toHaveBeenCalledOnce();
    expect(runtimeMock.toggleMaximise).toHaveBeenCalledOnce();
    expect(runtimeMock.closeWindow).toHaveBeenCalledOnce();
  });

  it('tracks maximise state in the window action and glyph', async () => {
    runtimeMock.isWindowMaximised.mockResolvedValue(true);

    await act(async () => {
      root.render(<AppHeader mode="panel" />);
      await Promise.resolve();
    });

    const restoreButton = container.querySelector<HTMLButtonElement>(
      '[aria-label="Restore window"]'
    );
    expect(restoreButton?.title).toBe('Restore');
    expect(restoreButton?.querySelector('path')?.getAttribute('d')).toBe(
      'M5.5 6.5v7h7v-7h-7Zm2-2h7v7'
    );
  });

  it('refreshes maximise state after toggling the window', async () => {
    runtimeMock.isWindowMaximised.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    await act(async () => {
      root.render(<AppHeader mode="panel" />);
      await Promise.resolve();
    });

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="Maximise window"]')?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(runtimeMock.toggleMaximise).toHaveBeenCalledOnce();
    expect(runtimeMock.isWindowMaximised).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[aria-label="Restore window"]')).not.toBeNull();
  });

  it('refreshes maximise state after an external window resize', async () => {
    vi.useFakeTimers();
    try {
      await act(async () => {
        root.render(<AppHeader mode="panel" />);
        await Promise.resolve();
      });
      runtimeMock.isWindowMaximised.mockResolvedValue(true);

      await act(async () => {
        window.dispatchEvent(new Event('resize'));
        await vi.advanceTimersByTimeAsync(50);
      });

      expect(container.querySelector('[aria-label="Restore window"]')).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps native traffic-light controls for a mac panel window', () => {
    platformMock.isMacPlatform.mockReturnValue(true);

    act(() => {
      root.render(<AppHeader mode="panel" />);
    });

    expect(container.querySelector('.app-header--mac')).not.toBeNull();
    expect(container.querySelector('.app-header--linux')).toBeNull();
    expect(container.querySelector('.app-header--custom-frame')).toBeNull();
    expect(container.querySelector('.app-header-window-controls')).toBeNull();
  });

  it('does not override native macOS edge cursors', () => {
    platformMock.isMacPlatform.mockReturnValue(true);
    act(() => {
      root.render(<AppHeader mode="panel" />);
    });
    document.body.style.cursor = 'ns-resize';

    act(() => {
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 400, clientY: 1 }));
    });

    expect(document.body.style.cursor).toBe('ns-resize');
    expect(document.body.dataset.windowResizeCursor).toBeUndefined();
  });

  it('does not toggle maximise from the header while a modal is open', () => {
    document.body.classList.add('modal-surface-open');
    act(() => {
      renderHeader();
    });

    const header = container.querySelector('.app-header-drag-control') as HTMLButtonElement;
    act(() => {
      header.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });

    expect(runtimeMock.toggleMaximise).not.toHaveBeenCalled();
  });

  it('exposes the titlebar maximize gesture as a native keyboard control', () => {
    act(() => {
      renderHeader();
    });

    const dragControl = container.querySelector<HTMLButtonElement>('.app-header-drag-control');
    expect(dragControl?.type).toBe('button');
    act(() => dragControl?.click());
    expect(runtimeMock.toggleMaximise).toHaveBeenCalledTimes(1);
  });

  it('does not toggle maximise when a control is double-clicked', () => {
    act(() => {
      renderHeader();
    });

    const commandPaletteButton = container.querySelector(
      '[aria-label="Command Palette"]'
    ) as HTMLButtonElement;
    act(() => {
      commandPaletteButton.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });

    expect(runtimeMock.toggleMaximise).not.toHaveBeenCalled();
  });
});
