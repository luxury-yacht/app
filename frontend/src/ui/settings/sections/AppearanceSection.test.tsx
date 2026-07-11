/**
 * frontend/src/ui/settings/sections/AppearanceSection.test.tsx
 *
 * Tests for Appearance settings interactions and preference workflow wiring.
 */

import { types } from '@wailsjs/go/models';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requireValue } from '@/test-utils/requireValue';
import AppearanceSection, { reorderThemeByOffset } from './AppearanceSection';

const setInputValue = (input: HTMLInputElement, value: string): void => {
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  valueSetter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
};

const appPreferenceMocks = vi.hoisted(() => ({
  getThemes: vi.fn(),
  saveTheme: vi.fn(),
  validateThemeClusterPattern: vi.fn(),
  getPaletteTint: vi.fn(),
  getPreferenceMetadata: vi.fn((key: string) => ({
    key,
    type: key === 'appearanceMode' ? 'enum' : 'integer',
    defaultValue: key === 'appearanceMode' ? 'system' : 0,
    currentValue: key === 'appearanceMode' ? 'light' : 0,
    min: key.includes('Brightness') ? -50 : 0,
    max: key.includes('Hue') ? 360 : 100,
    enumOptions: key === 'appearanceMode' ? ['light', 'dark', 'system'] : undefined,
    runtimeSideEffect: key === 'appearanceMode',
  })),
  getIntegerPreferenceMetadata: vi.fn((key: string) => ({
    key,
    type: 'integer',
    defaultValue: 0,
    currentValue: 0,
    min: key.includes('Brightness') ? -50 : 0,
    max: key.includes('Hue') ? 360 : 100,
    runtimeSideEffect: false,
  })),
  normalizeIntegerPreferenceValue: vi.fn((key: string, value: number) => {
    const min = key.includes('Brightness') ? -50 : 0;
    const max = key.includes('Hue') ? 360 : 100;
    return Math.max(min, Math.min(max, Math.floor(value)));
  }),
  setPaletteTint: vi.fn(),
  getAccentColor: vi.fn(),
  setAccentColor: vi.fn(),
  getLinkColor: vi.fn(),
  setLinkColor: vi.fn(),
}));

const errorHandlerMocks = vi.hoisted(() => ({
  handle: vi.fn(),
}));

const appearanceModeMocks = vi.hoisted(() => ({
  changeAppearanceMode: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/core/contexts/AppearanceModeContext', () => ({
  useAppearanceMode: () => ({ mode: 'light', resolvedMode: 'light' }),
}));

vi.mock('@/core/settings/appPreferences', () => {
  const createPreferenceWorkflowMock = <T,>(commit: (input: T) => void) => ({
    commit,
    commitDebounced: commit,
    cancelPending: vi.fn(),
  });

  return {
    hydrateAppPreferences: vi.fn().mockResolvedValue({}),
    getPreferenceMetadata: (key: string) => appPreferenceMocks.getPreferenceMetadata(key),
    getIntegerPreferenceMetadata: (key: string) =>
      appPreferenceMocks.getIntegerPreferenceMetadata(key),
    normalizeIntegerPreferenceValue: (key: string, value: number) =>
      appPreferenceMocks.normalizeIntegerPreferenceValue(key, value),
    getPaletteTint: (...args: unknown[]) => appPreferenceMocks.getPaletteTint(...args),
    createPaletteTintPreferenceWorkflow: () =>
      createPreferenceWorkflowMock(
        (input: { mode: 'light' | 'dark'; hue: number; saturation: number; brightness?: number }) =>
          appPreferenceMocks.setPaletteTint(
            input.mode,
            input.hue,
            input.saturation,
            input.brightness
          )
      ),
    getAccentColor: (...args: unknown[]) => appPreferenceMocks.getAccentColor(...args),
    createAccentColorPreferenceWorkflow: () =>
      createPreferenceWorkflowMock((input: { mode: 'light' | 'dark'; color: string }) =>
        appPreferenceMocks.setAccentColor(input.mode, input.color)
      ),
    getLinkColor: (...args: unknown[]) => appPreferenceMocks.getLinkColor(...args),
    createLinkColorPreferenceWorkflow: () =>
      createPreferenceWorkflowMock((input: { mode: 'light' | 'dark'; color: string }) =>
        appPreferenceMocks.setLinkColor(input.mode, input.color)
      ),
    getThemes: (...args: unknown[]) => appPreferenceMocks.getThemes(...args),
    saveTheme: (...args: unknown[]) => appPreferenceMocks.saveTheme(...args),
    validateThemeClusterPattern: (...args: unknown[]) =>
      appPreferenceMocks.validateThemeClusterPattern(...args),
    deleteTheme: vi.fn(),
    reorderThemes: vi.fn(),
    applyTheme: vi.fn(),
  };
});

vi.mock('@/utils/appearanceMode', () => ({
  changeAppearanceMode: (...args: unknown[]) => appearanceModeMocks.changeAppearanceMode(...args),
}));

vi.mock('@utils/paletteTint', () => ({
  applyTintedPalette: vi.fn(),
  isPaletteActive: vi.fn(() => false),
  MAX_SATURATION: 20,
  MAX_BRIGHTNESS_OFFSET: 10,
}));

vi.mock('@utils/accentColor', () => ({
  applyAccentColor: vi.fn(),
  applyAccentBg: vi.fn(),
}));

vi.mock('@utils/linkColor', () => ({
  applyLinkColor: vi.fn(),
}));

vi.mock('@utils/errorHandler', () => ({
  errorHandler: errorHandlerMocks,
}));

vi.mock('@shared/components/modals/ConfirmationModal', () => ({
  __esModule: true,
  default: vi.fn(() => null),
}));

describe('AppearanceSection', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(async () => {
    appPreferenceMocks.getThemes.mockResolvedValue([
      new types.Theme({ id: 'default', name: 'default', clusterPattern: '' }),
    ]);
    appPreferenceMocks.saveTheme.mockResolvedValue(undefined);
    appPreferenceMocks.validateThemeClusterPattern.mockResolvedValue({ valid: true });
    appPreferenceMocks.getPaletteTint.mockImplementation((mode: string) =>
      mode === 'light'
        ? { hue: 20, saturation: 0, brightness: 0 }
        : { hue: 210, saturation: 12, brightness: -3 }
    );
    appPreferenceMocks.getAccentColor.mockImplementation((mode: string) =>
      mode === 'light' ? '#123456' : '#abcdef'
    );
    appPreferenceMocks.getLinkColor.mockImplementation((mode: string) =>
      mode === 'light' ? '#654321' : '#fedcba'
    );

    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    await act(async () => {
      root.render(<AppearanceSection />);
      await Promise.resolve();
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.clearAllMocks();
  });

  it('renders styled appearance mode buttons and changes modes', async () => {
    const buttons = Array.from(
      container.querySelectorAll<HTMLButtonElement>('.settings-choice-button')
    );
    expect(buttons.map((button) => button.textContent)).toEqual(['System', 'Light', 'Dark']);

    const lightButton = buttons.find((button) => button.textContent === 'Light');
    const darkButton = requireValue(
      buttons.find((button) => button.textContent === 'Dark'),
      'expected the Dark appearance button'
    );
    expect(lightButton?.getAttribute('aria-pressed')).toBe('true');
    expect(darkButton?.getAttribute('aria-pressed')).toBe('false');

    await act(async () => {
      darkButton.click();
      await Promise.resolve();
    });

    expect(appearanceModeMocks.changeAppearanceMode).toHaveBeenCalledWith('dark');
  });

  it('prompts to save live appearance changes as the default theme', async () => {
    const hueInput = requireValue(
      container.querySelector<HTMLInputElement>('[id$="-palette-hue"]'),
      'expected the palette hue input'
    );

    await act(async () => {
      setInputValue(hueInput, '30');
    });

    expect(container.textContent).toContain('There are unsaved changes. Save as default?');

    const saveButton = requireValue(
      Array.from(container.querySelectorAll('button')).find(
        (button) => button.textContent === 'Save'
      ),
      'expected the default-theme Save button'
    );

    await act(async () => {
      saveButton.click();
      await Promise.resolve();
    });

    expect(appPreferenceMocks.saveTheme).toHaveBeenCalledTimes(1);
    expect(appPreferenceMocks.saveTheme.mock.calls[0][0]).toMatchObject({
      id: 'default',
      name: 'default',
      clusterPattern: '',
      paletteHueLight: 30,
      paletteSaturationLight: 0,
      paletteBrightnessLight: 0,
      paletteHueDark: 210,
      paletteSaturationDark: 12,
      paletteBrightnessDark: -3,
      accentColorLight: '#123456',
      accentColorDark: '#abcdef',
      linkColorLight: '#654321',
      linkColorDark: '#fedcba',
    });
  });

  it('prompts when tint values are reset', async () => {
    const hueReset = requireValue(
      container.querySelector<HTMLButtonElement>('button[title="Reset Hue"]'),
      'expected the Reset Hue button'
    );
    expect(hueReset.disabled).toBe(false);

    await act(async () => {
      hueReset.click();
      await Promise.resolve();
    });

    expect(container.textContent).toContain('There are unsaved changes. Save as default?');
  });

  it('prompts when color swatches are reset', async () => {
    const accentReset = requireValue(
      container.querySelector<HTMLButtonElement>('button[title="Reset Accent Color"]'),
      'expected the Reset Accent Color button'
    );
    const linkReset = requireValue(
      container.querySelector<HTMLButtonElement>('button[title="Reset Link Color"]'),
      'expected the Reset Link Color button'
    );

    await act(async () => {
      accentReset.click();
      await Promise.resolve();
    });

    expect(container.textContent).toContain('There are unsaved changes. Save as default?');

    const saveButton = requireValue(
      Array.from(container.querySelectorAll('button')).find(
        (button) => button.textContent === 'Save'
      ),
      'expected the default-theme Save button'
    );

    await act(async () => {
      saveButton.click();
      await Promise.resolve();
    });

    await act(async () => {
      linkReset.click();
      await Promise.resolve();
    });

    expect(container.textContent).toContain('There are unsaved changes. Save as default?');
  });

  it('shows invalid theme pattern errors inline instead of using the global error handler', async () => {
    appPreferenceMocks.validateThemeClusterPattern.mockResolvedValueOnce({
      valid: false,
      message: 'Invalid cluster pattern: missing closing bracket.',
    });

    const newThemeButton = requireValue(
      Array.from(container.querySelectorAll('button')).find(
        (button) => button.textContent === 'Save new theme'
      ),
      'expected the Save new theme button'
    );

    await act(async () => {
      newThemeButton.click();
      await Promise.resolve();
    });

    const nameInput = requireValue(
      container.querySelector<HTMLInputElement>('.theme-name-input'),
      'expected the theme name input'
    );
    const patternInput = requireValue(
      container.querySelector<HTMLInputElement>('.theme-pattern-input'),
      'expected the theme cluster-pattern input'
    );
    expect(document.activeElement).toBe(nameInput);

    await act(async () => {
      setInputValue(nameInput, 'Prod');
      setInputValue(patternInput, 'prod-[');
    });

    const saveButton = requireValue(
      container.querySelector<HTMLButtonElement>('button[aria-label="Save new theme"]'),
      'expected the open theme editor Save button'
    );

    await act(async () => {
      saveButton.click();
      await Promise.resolve();
    });

    expect(container.textContent).toContain('Invalid cluster pattern: missing closing bracket.');
    expect(patternInput.getAttribute('aria-invalid')).toBe('true');
    expect(appPreferenceMocks.validateThemeClusterPattern).toHaveBeenCalledWith('prod-[');
    expect(appPreferenceMocks.saveTheme).not.toHaveBeenCalled();
    expect(errorHandlerMocks.handle).not.toHaveBeenCalled();

    await act(async () => {
      setInputValue(patternInput, 'prod-*');
    });

    expect(container.textContent).not.toContain('Invalid cluster pattern');
    expect(patternInput.hasAttribute('aria-invalid')).toBe(false);
  });
});

describe('reorderThemeByOffset', () => {
  it('moves custom themes while keeping the default theme last', () => {
    const ids = ['one', 'two', 'default'];
    expect(reorderThemeByOffset(ids, 'one', 1)).toEqual(['two', 'one', 'default']);
    expect(reorderThemeByOffset(ids, 'two', -1)).toEqual(['two', 'one', 'default']);
    expect(reorderThemeByOffset(ids, 'one', -1)).toBeNull();
    expect(reorderThemeByOffset(ids, 'two', 1)).toBeNull();
    expect(reorderThemeByOffset(ids, 'default', -1)).toBeNull();
  });
});
