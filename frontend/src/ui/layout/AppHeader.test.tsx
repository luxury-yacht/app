import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AppHeader from './AppHeader';

const viewStateMock = vi.hoisted(() => ({
  setIsSettingsOpen: vi.fn(),
}));
const runtimeMock = vi.hoisted(() => ({
  WindowToggleMaximise: vi.fn(),
}));

vi.mock('@core/contexts/ViewStateContext', () => ({
  useViewState: () => viewStateMock,
}));

vi.mock('@shared/components/KubeconfigSelector', () => ({
  default: () => <button type="button">Kubeconfig</button>,
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
    viewStateMock.setIsSettingsOpen.mockReset();
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
      root.render(<AppHeader contentTitle="cluster: dev" />);
    });

    const focusables = Array.from(
      container.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )
    );

    expect(
      focusables.map((element) => element.getAttribute('aria-label') || element.textContent)
    ).toEqual(['Kubeconfig', 'Favorites', 'Settings']);
  });

  it('does not toggle maximise from the header while a modal is open', () => {
    document.body.classList.add('modal-surface-open');
    act(() => {
      root.render(<AppHeader contentTitle="cluster: dev" />);
    });

    const header = container.querySelector('.app-header') as HTMLDivElement;
    act(() => {
      header.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });

    expect(runtimeMock.WindowToggleMaximise).not.toHaveBeenCalled();
  });
});
