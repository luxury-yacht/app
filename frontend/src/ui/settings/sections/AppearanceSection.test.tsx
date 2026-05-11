import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { types } from '@wailsjs/go/models';
import AppearanceSection from './AppearanceSection';

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

vi.mock('@/core/settings/appPreferences', () => ({
  hydrateAppPreferences: vi.fn().mockResolvedValue({}),
  getPaletteTint: (...args: unknown[]) => appPreferenceMocks.getPaletteTint(...args),
  setPaletteTint: (...args: unknown[]) => appPreferenceMocks.setPaletteTint(...args),
  getAccentColor: (...args: unknown[]) => appPreferenceMocks.getAccentColor(...args),
  setAccentColor: (...args: unknown[]) => appPreferenceMocks.setAccentColor(...args),
  getLinkColor: (...args: unknown[]) => appPreferenceMocks.getLinkColor(...args),
  setLinkColor: (...args: unknown[]) => appPreferenceMocks.setLinkColor(...args),
  getThemes: (...args: unknown[]) => appPreferenceMocks.getThemes(...args),
  saveTheme: (...args: unknown[]) => appPreferenceMocks.saveTheme(...args),
  validateThemeClusterPattern: (...args: unknown[]) =>
    appPreferenceMocks.validateThemeClusterPattern(...args),
  deleteTheme: vi.fn(),
  reorderThemes: vi.fn(),
  applyTheme: vi.fn(),
}));

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

  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

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
    const darkButton = buttons.find((button) => button.textContent === 'Dark');
    expect(lightButton?.getAttribute('aria-pressed')).toBe('true');
    expect(darkButton?.getAttribute('aria-pressed')).toBe('false');

    await act(async () => {
      darkButton!.click();
      await Promise.resolve();
    });

    expect(appearanceModeMocks.changeAppearanceMode).toHaveBeenCalledWith('dark');
  });

  it('prompts to save live appearance changes as the default theme', async () => {
    const hueInput = container.querySelector('#palette-hue') as HTMLInputElement | null;
    expect(hueInput).toBeTruthy();

    await act(async () => {
      setInputValue(hueInput!, '30');
    });

    expect(container.textContent).toContain(
      'There are unsaved changes. Would you like to save them as the default theme?'
    );

    const saveButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Save'
    ) as HTMLButtonElement | undefined;
    expect(saveButton).toBeTruthy();

    await act(async () => {
      saveButton!.click();
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
    const hueReset = container.querySelector(
      'button[title="Reset Hue"]'
    ) as HTMLButtonElement | null;
    expect(hueReset).toBeTruthy();
    expect(hueReset!.disabled).toBe(false);

    await act(async () => {
      hueReset!.click();
      await Promise.resolve();
    });

    expect(container.textContent).toContain(
      'There are unsaved changes. Would you like to save them as the default theme?'
    );
  });

  it('prompts when color swatches are reset', async () => {
    const accentReset = container.querySelector(
      'button[title="Reset Accent Color"]'
    ) as HTMLButtonElement | null;
    const linkReset = container.querySelector(
      'button[title="Reset Link Color"]'
    ) as HTMLButtonElement | null;
    expect(accentReset).toBeTruthy();
    expect(linkReset).toBeTruthy();

    await act(async () => {
      accentReset!.click();
      await Promise.resolve();
    });

    expect(container.textContent).toContain(
      'There are unsaved changes. Would you like to save them as the default theme?'
    );

    const saveButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Save'
    ) as HTMLButtonElement | undefined;
    expect(saveButton).toBeTruthy();

    await act(async () => {
      saveButton!.click();
      await Promise.resolve();
    });

    await act(async () => {
      linkReset!.click();
      await Promise.resolve();
    });

    expect(container.textContent).toContain(
      'There are unsaved changes. Would you like to save them as the default theme?'
    );
  });

  it('shows invalid theme pattern errors inline instead of using the global error handler', async () => {
    appPreferenceMocks.validateThemeClusterPattern.mockResolvedValueOnce({
      valid: false,
      message: 'Invalid cluster pattern: missing closing bracket.',
    });

    const newThemeButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Save new theme'
    ) as HTMLButtonElement | undefined;
    expect(newThemeButton).toBeTruthy();

    await act(async () => {
      newThemeButton!.click();
      await Promise.resolve();
    });

    const nameInput = container.querySelector('.theme-name-input') as HTMLInputElement | null;
    const patternInput = container.querySelector('.theme-pattern-input') as HTMLInputElement | null;
    expect(nameInput).toBeTruthy();
    expect(patternInput).toBeTruthy();

    await act(async () => {
      setInputValue(nameInput!, 'Prod');
      setInputValue(patternInput!, 'prod-[');
    });

    const saveButton = container.querySelector(
      'button[aria-label="Save new theme"]'
    ) as HTMLButtonElement | null;
    expect(saveButton).toBeTruthy();

    await act(async () => {
      saveButton!.click();
      await Promise.resolve();
    });

    expect(container.textContent).toContain('Invalid cluster pattern: missing closing bracket.');
    expect(patternInput!.getAttribute('aria-invalid')).toBe('true');
    expect(appPreferenceMocks.validateThemeClusterPattern).toHaveBeenCalledWith('prod-[');
    expect(appPreferenceMocks.saveTheme).not.toHaveBeenCalled();
    expect(errorHandlerMocks.handle).not.toHaveBeenCalled();

    await act(async () => {
      setInputValue(patternInput!, 'prod-*');
    });

    expect(container.textContent).not.toContain('Invalid cluster pattern');
    expect(patternInput!.hasAttribute('aria-invalid')).toBe(false);
  });
});
