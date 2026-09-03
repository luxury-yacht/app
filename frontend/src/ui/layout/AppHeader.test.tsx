import { ModalStateProvider } from '@core/contexts/ModalStateContext';
import { KeyboardProvider } from '@ui/shortcuts';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AppHeader from './AppHeader';

const runtimeMock = vi.hoisted(() => ({
  closeWindow: vi.fn(),
  minimiseWindow: vi.fn(),
  toggleMaximise: vi.fn(),
}));

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
    minimiseWindow: runtimeMock.minimiseWindow,
    toggleMaximise: runtimeMock.toggleMaximise,
  };
});

vi.mock('@/utils/platform', () => ({
  isMacPlatform: platformMock.isMacPlatform,
  isWindowsPlatform: platformMock.isWindowsPlatform,
}));

describe('AppHeader', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    platformMock.isMacPlatform.mockReturnValue(false);
    runtimeMock.closeWindow.mockReset();
    runtimeMock.minimiseWindow.mockReset();
    runtimeMock.toggleMaximise.mockReset();
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    document.body.classList.remove('modal-surface-open');
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
      'Maximise or restore window',
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
    expect(container.querySelector('[aria-label="Maximise or restore window"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Close window"]')).not.toBeNull();
    expect(container.textContent).not.toContain('Connectivity');
    expect(container.textContent).not.toContain('Metrics');
    expect(container.textContent).not.toContain('Sessions');
    expect(container.textContent).not.toContain('Favorites');
    expect(container.querySelector('[aria-label="Command Palette"]')).toBeNull();
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
      'm6 6 6 6m0-6-6 6',
    ]);
  });

  it('routes custom panel controls through the desktop runtime', () => {
    act(() => {
      root.render(<AppHeader mode="panel" />);
    });

    act(() => {
      container.querySelector<HTMLButtonElement>('[aria-label="Minimise window"]')?.click();
      container
        .querySelector<HTMLButtonElement>('[aria-label="Maximise or restore window"]')
        ?.click();
      container.querySelector<HTMLButtonElement>('[aria-label="Close window"]')?.click();
    });

    expect(runtimeMock.minimiseWindow).toHaveBeenCalledOnce();
    expect(runtimeMock.toggleMaximise).toHaveBeenCalledOnce();
    expect(runtimeMock.closeWindow).toHaveBeenCalledOnce();
  });

  it('keeps native traffic-light controls for a mac panel window', () => {
    platformMock.isMacPlatform.mockReturnValue(true);

    act(() => {
      root.render(<AppHeader mode="panel" />);
    });

    expect(container.querySelector('.app-header--mac')).not.toBeNull();
    expect(container.querySelector('.app-header--custom-frame')).toBeNull();
    expect(container.querySelector('.app-header-window-controls')).toBeNull();
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
