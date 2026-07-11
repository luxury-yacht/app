import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AppHeader from './AppHeader';

const runtimeMock = vi.hoisted(() => ({
  WindowToggleMaximise: vi.fn(),
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

vi.mock('@wailsjs/runtime/runtime', async () => {
  const actual = await vi.importActual<object>('@wailsjs/runtime/runtime');
  return {
    ...actual,
    WindowToggleMaximise: runtimeMock.WindowToggleMaximise,
  };
});

describe('AppHeader', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    runtimeMock.WindowToggleMaximise.mockReset();
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    document.body.classList.remove('modal-surface-open');
  });

  it('renders header controls in the expected tab order', () => {
    act(() => {
      root.render(<AppHeader />);
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

  it('does not toggle maximise from the header while a modal is open', () => {
    document.body.classList.add('modal-surface-open');
    act(() => {
      root.render(<AppHeader />);
    });

    const header = container.querySelector('.app-header-drag-control') as HTMLButtonElement;
    act(() => {
      header.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });

    expect(runtimeMock.WindowToggleMaximise).not.toHaveBeenCalled();
  });

  it('exposes the titlebar maximize gesture as a native keyboard control', () => {
    act(() => {
      root.render(<AppHeader />);
    });

    const dragControl = container.querySelector<HTMLButtonElement>('.app-header-drag-control');
    expect(dragControl?.type).toBe('button');
    act(() => dragControl?.click());
    expect(runtimeMock.WindowToggleMaximise).toHaveBeenCalledTimes(1);
  });

  it('does not toggle maximise when a control is double-clicked', () => {
    act(() => {
      root.render(<AppHeader />);
    });

    const commandPaletteButton = container.querySelector(
      '[aria-label="Command Palette"]'
    ) as HTMLButtonElement;
    act(() => {
      commandPaletteButton.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });

    expect(runtimeMock.WindowToggleMaximise).not.toHaveBeenCalled();
  });
});
