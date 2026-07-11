import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requireValue } from '@/test-utils/requireValue';
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
  getIntegerPreferenceMetadata: vi.fn((key: string) => ({
    key,
    type: 'integer',
    defaultValue: key.includes('DockedRight')
      ? 600
      : key.includes('DockedBottom')
        ? 400
        : key.includes('FloatingWidth')
          ? 500
          : key.includes('FloatingHeight')
            ? 400
            : 100,
    currentValue: 0,
    min: key.includes('DockedRight')
      ? 500
      : key.includes('DockedBottom')
        ? 200
        : key.includes('FloatingWidth')
          ? 450
          : key.includes('FloatingHeight')
            ? 200
            : 0,
    max: 9999,
    runtimeSideEffect: false,
  })),
  normalizeIntegerPreferenceValue: vi.fn((_key: string, value: number) =>
    Math.max(0, Math.min(9999, Math.floor(value)))
  ),
  setObjectPanelLayoutDefaults: vi.fn(),
}));

const dockableMocks = vi.hoisted(() => ({
  applyLayoutDefaultsAcrossClusters: vi.fn(),
}));

vi.mock('@core/settings/appPreferences', () => ({
  getDefaultObjectPanelPosition: () => appPreferenceMocks.getDefaultObjectPanelPosition(),
  getIntegerPreferenceMetadata: (key: string) =>
    appPreferenceMocks.getIntegerPreferenceMetadata(key),
  setDefaultObjectPanelPosition: (...args: unknown[]) =>
    appPreferenceMocks.setDefaultObjectPanelPosition(...args),
  getObjectPanelLayoutDefaults: () => appPreferenceMocks.getObjectPanelLayoutDefaults(),
  normalizeIntegerPreferenceValue: (key: string, value: number) =>
    appPreferenceMocks.normalizeIntegerPreferenceValue(key, value),
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
}));

describe('ObjectPanelSection', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

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
    const bottomButton = requireValue(
      buttons.find((button) => button.textContent === 'Bottom'),
      'expected the Bottom object-panel position button'
    );
    expect(rightButton?.getAttribute('aria-pressed')).toBe('true');
    expect(bottomButton?.getAttribute('aria-pressed')).toBe('false');

    act(() => {
      bottomButton.click();
    });

    expect(appPreferenceMocks.setDefaultObjectPanelPosition).toHaveBeenCalledWith('bottom');
    expect(bottomButton?.getAttribute('aria-pressed')).toBe('true');
  });
});
