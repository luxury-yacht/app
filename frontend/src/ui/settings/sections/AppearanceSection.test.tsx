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
  getPaletteTint: vi.fn(),
  setPaletteTint: vi.fn(),
  getAccentColor: vi.fn(),
  setAccentColor: vi.fn(),
  getLinkColor: vi.fn(),
  setLinkColor: vi.fn(),
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
  deleteTheme: vi.fn(),
  reorderThemes: vi.fn(),
  applyTheme: vi.fn(),
}));

vi.mock('@/utils/appearanceMode', () => ({
  changeAppearanceMode: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@utils/paletteTint', () => ({
  applyTintedPalette: vi.fn(),
  savePaletteTintToLocalStorage: vi.fn(),
  isPaletteActive: vi.fn(() => false),
  MAX_SATURATION: 20,
  MAX_BRIGHTNESS_OFFSET: 10,
}));

vi.mock('@utils/accentColor', () => ({
  applyAccentColor: vi.fn(),
  applyAccentBg: vi.fn(),
  saveAccentColorToLocalStorage: vi.fn(),
}));

vi.mock('@utils/linkColor', () => ({
  applyLinkColor: vi.fn(),
  saveLinkColorToLocalStorage: vi.fn(),
}));

vi.mock('@utils/errorHandler', () => ({
  errorHandler: { handle: vi.fn() },
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
});
