import {
  type ObjectPanelLayoutDefaults,
  type ObjectPanelPosition,
  resetAppPreferencesCacheForTesting,
  setAppPreferencesForTesting,
} from '@core/settings/appPreferences';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requireValue } from '@/test-utils/requireValue';
import ObjectPanelSection from './ObjectPanelSection';

const setInputValue = (input: HTMLInputElement, value: string): void => {
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  valueSetter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
};

const appPreferenceMocks = vi.hoisted(() => ({
  setDefaultObjectPanelPosition: vi.fn(),
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

// The real preference store; the setters update it as the optimistic setters do,
// without a backend. Metadata and normalization are stubbed.
vi.mock('@core/settings/appPreferences', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@core/settings/appPreferences')>();
  return {
    ...actual,
    getIntegerPreferenceMetadata: (key: string) =>
      appPreferenceMocks.getIntegerPreferenceMetadata(key),
    setDefaultObjectPanelPosition: (position: ObjectPanelPosition) => {
      appPreferenceMocks.setDefaultObjectPanelPosition(position);
      actual.setAppPreferencesForTesting({ defaultObjectPanelPosition: position });
    },
    normalizeIntegerPreferenceValue: (key: string, value: number) =>
      appPreferenceMocks.normalizeIntegerPreferenceValue(key, value),
    setObjectPanelLayoutDefaults: (layout: ObjectPanelLayoutDefaults) => {
      appPreferenceMocks.setObjectPanelLayoutDefaults(layout);
      actual.setAppPreferencesForTesting({
        objectPanelDockedRightWidth: layout.dockedRightWidth,
        objectPanelDockedBottomHeight: layout.dockedBottomHeight,
        objectPanelFloatingWidth: layout.floatingWidth,
        objectPanelFloatingHeight: layout.floatingHeight,
      });
    },
  };
});

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
    appPreferenceMocks.setDefaultObjectPanelPosition.mockClear();
    resetAppPreferencesCacheForTesting();
    setAppPreferencesForTesting({
      objectPanelDockedRightWidth: 420,
      objectPanelDockedBottomHeight: 260,
      objectPanelFloatingWidth: 720,
      objectPanelFloatingHeight: 520,
    });

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

  it('lets users configure the default floating window width and height', () => {
    const widthInput = requireValue(
      container.querySelector<HTMLInputElement>('input[aria-label="Floating width"]'),
      'expected a floating window width setting'
    );
    const heightInput = requireValue(
      container.querySelector<HTMLInputElement>('input[aria-label="Floating height"]'),
      'expected a floating window height setting'
    );

    expect(widthInput.value).toBe('720');
    expect(widthInput.min).toBe('450');
    expect(heightInput.value).toBe('520');
    expect(heightInput.min).toBe('200');

    act(() => {
      setInputValue(widthInput, '810');
    });

    expect(appPreferenceMocks.setObjectPanelLayoutDefaults).toHaveBeenLastCalledWith({
      dockedRightWidth: 420,
      dockedBottomHeight: 260,
      floatingWidth: 810,
      floatingHeight: 520,
    });
    expect(dockableMocks.applyLayoutDefaultsAcrossClusters).toHaveBeenCalledOnce();
  });
});
