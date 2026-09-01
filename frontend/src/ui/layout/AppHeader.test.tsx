import { ModalStateProvider } from '@core/contexts/ModalStateContext';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AppHeader from './AppHeader';

const runtimeMock = vi.hoisted(() => ({
  toggleMaximise: vi.fn(),
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
    toggleMaximise: runtimeMock.toggleMaximise,
  };
});

describe('AppHeader', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
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
        <AppHeader />
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
    ).toEqual(['Toggle window maximize', 'Favorites', 'Command Palette']);
  });

  it('renders only draggable window chrome for a panel window', () => {
    act(() => {
      root.render(<AppHeader mode="panel" />);
    });

    expect(container.querySelector('.app-header-drag-control')).not.toBeNull();
    expect(container.querySelector('.app-header-controls')).toBeNull();
    expect(container.textContent).not.toContain('Connectivity');
    expect(container.textContent).not.toContain('Metrics');
    expect(container.textContent).not.toContain('Sessions');
    expect(container.textContent).not.toContain('Favorites');
    expect(container.querySelector('[aria-label="Command Palette"]')).toBeNull();
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
