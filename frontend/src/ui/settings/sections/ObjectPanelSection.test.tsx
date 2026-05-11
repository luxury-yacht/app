import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import ObjectPanelSection from './ObjectPanelSection';

const appPreferenceMocks = vi.hoisted(() => ({
  getDefaultObjectPanelPosition: vi.fn(() => 'right'),
  setDefaultObjectPanelPosition: vi.fn(),
  getObjectPanelLayoutDefaults: vi.fn(() => ({
    dockedRightWidth: 420,
    dockedBottomHeight: 260,
    floatingWidth: 720,
    floatingHeight: 520,
    floatingX: 60,
    floatingY: 60,
  })),
  setObjectPanelLayoutDefaults: vi.fn(),
}));

const dockableMocks = vi.hoisted(() => ({
  applyLayoutDefaultsAcrossClusters: vi.fn(),
}));

vi.mock('@core/settings/appPreferences', () => ({
  getDefaultObjectPanelPosition: () => appPreferenceMocks.getDefaultObjectPanelPosition(),
  setDefaultObjectPanelPosition: (...args: unknown[]) =>
    appPreferenceMocks.setDefaultObjectPanelPosition(...args),
  getObjectPanelLayoutDefaults: () => appPreferenceMocks.getObjectPanelLayoutDefaults(),
  setObjectPanelLayoutDefaults: (...args: unknown[]) =>
    appPreferenceMocks.setObjectPanelLayoutDefaults(...args),
}));

vi.mock('@ui/dockable', () => ({
  useDockablePanelContext: () => ({
    applyLayoutDefaultsAcrossClusters: dockableMocks.applyLayoutDefaultsAcrossClusters,
  }),
}));

vi.mock('@ui/dockable/dockablePanelLayout', () => ({
  getContentBounds: () => ({ width: 1200, height: 900 }),
  PANEL_DEFAULTS: {
    RIGHT_MIN_WIDTH: 240,
    BOTTOM_MIN_HEIGHT: 180,
    FLOATING_MIN_WIDTH: 320,
    FLOATING_MIN_HEIGHT: 240,
  },
}));

describe('ObjectPanelSection', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    appPreferenceMocks.getDefaultObjectPanelPosition.mockReturnValue('right');
    appPreferenceMocks.setDefaultObjectPanelPosition.mockClear();

    act(() => {
      root.render(<ObjectPanelSection />);
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.clearAllMocks();
  });

  it('renders styled position buttons and persists changes', () => {
    const buttons = Array.from(
      container.querySelectorAll<HTMLButtonElement>('.settings-choice-button')
    );
    expect(buttons.map((button) => button.textContent)).toEqual(['Right', 'Bottom', 'Floating']);

    const rightButton = buttons.find((button) => button.textContent === 'Right');
    const bottomButton = buttons.find((button) => button.textContent === 'Bottom');
    expect(rightButton?.getAttribute('aria-pressed')).toBe('true');
    expect(bottomButton?.getAttribute('aria-pressed')).toBe('false');

    act(() => {
      bottomButton!.click();
    });

    expect(appPreferenceMocks.setDefaultObjectPanelPosition).toHaveBeenCalledWith('bottom');
    expect(bottomButton?.getAttribute('aria-pressed')).toBe('true');
  });
});
