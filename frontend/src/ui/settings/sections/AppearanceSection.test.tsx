/**
 * frontend/src/ui/settings/sections/AppearanceSection.test.tsx
 *
 * Tests for Appearance settings interactions and preference workflow wiring.
 */

import type { types } from '@core/backend-api/models';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { partialModelFixture } from '@/test-utils/partialModelFixture';
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
  reorderThemes: vi.fn(),
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

vi.mock('@/core/settings/appPreferences', async (importOriginal) => {
  const { palettePreferenceKeys } =
    await importOriginal<typeof import('@/core/settings/appPreferences')>();
  const createPreferenceWorkflowMock = <T,>(commit: (input: T) => void) => ({
    commit,
    commitDebounced: commit,
    cancelPending: vi.fn(),
  });

  return {
    palettePreferenceKeys,
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
    reorderThemes: appPreferenceMocks.reorderThemes,
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
      partialModelFixture<types.Theme>({ id: 'default', name: 'default', clusterPattern: '' }),
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
      container.querySelector<HTMLButtonElement>('button[title="Reset Accent color"]'),
      'expected the Reset Accent color button'
    );
    const linkReset = requireValue(
      container.querySelector<HTMLButtonElement>('button[title="Reset Link color"]'),
      'expected the Reset Link color button'
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

  it.each([
    ['accent', 0, appPreferenceMocks.setAccentColor, appPreferenceMocks.setLinkColor],
    ['link', 1, appPreferenceMocks.setLinkColor, appPreferenceMocks.setAccentColor],
  ] as const)(
    'normalizes valid %s hex drafts and discards invalid or canceled drafts',
    async (_name, index, persist, otherPersist) => {
      const field = requireValue(
        container.querySelectorAll('.palette-color-field')[index],
        'expected color control'
      );
      const edit = async (draft: string) => {
        await act(async () => {
          requireValue(
            field.querySelector<HTMLButtonElement>('.palette-hex-clickable'),
            'expected hex edit button'
          ).click();
        });
        const input = requireValue(
          field.querySelector<HTMLInputElement>('.palette-hex-input'),
          'expected hex input'
        );
        await act(async () => setInputValue(input, draft));
        return input;
      };
      const submit = async (input: HTMLInputElement, key: string) => {
        await act(async () => {
          input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
        });
      };

      await submit(await edit('AbC'), 'Enter');
      expect(persist).toHaveBeenLastCalledWith('light', '#aabbcc');
      expect(otherPersist).not.toHaveBeenCalled();

      await submit(await edit('xyz'), 'Enter');
      await submit(await edit('#112233'), 'Escape');
      const blurred = await edit('#445566');
      await act(async () => {
        blurred.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
      });
      expect(persist).toHaveBeenCalledOnce();
      expect(otherPersist).not.toHaveBeenCalled();
      expect(field.querySelector('.palette-hex-input')).toBeNull();
      expect(field.querySelector<HTMLInputElement>('input[type="color"]')?.value).toBe('#aabbcc');
    }
  );

  it('preserves the other palette fields when editing and resetting tint', async () => {
    const change = async (field: string, value: string) => {
      await act(async () => {
        setInputValue(
          requireValue(
            container.querySelector<HTMLInputElement>(`[id$="-palette-${field}"]`),
            'expected palette slider'
          ),
          value
        );
      });
    };
    await change('hue', '120');
    await change('saturation', '35');
    await change('brightness', '-10');
    expect(appPreferenceMocks.setPaletteTint).toHaveBeenLastCalledWith('light', 120, 35, -10);

    for (const [field, expected] of [
      ['Saturation', [120, 0, -10]],
      ['Brightness', [120, 0, 0]],
      ['Hue', [0, 0, 0]],
    ] as const) {
      await act(async () => {
        requireValue(
          container.querySelector<HTMLButtonElement>(`button[title="Reset ${field}"]`),
          'expected palette reset'
        ).click();
      });
      expect(appPreferenceMocks.setPaletteTint).toHaveBeenLastCalledWith('light', ...expected);
    }
  });

  it('commits bounded inline tint values while canceled and invalid edits leave the palette unchanged', async () => {
    const edit = async (index: number, value: string, key: string) => {
      await act(async () => {
        requireValue(
          container.querySelectorAll<HTMLButtonElement>('.palette-slider-value')[index],
          'expected editable tint'
        ).click();
      });
      const input = requireValue(
        container.querySelector<HTMLInputElement>('.palette-tint-controls .palette-hex-input'),
        'expected tint editor'
      );
      await act(async () => setInputValue(input, value));
      await act(async () =>
        input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
      );
    };
    await edit(0, '500', 'Enter');
    expect(appPreferenceMocks.setPaletteTint).toHaveBeenLastCalledWith('light', 360, 0, 0);
    await edit(1, '34', 'Enter');
    expect(appPreferenceMocks.setPaletteTint).toHaveBeenLastCalledWith('light', 360, 34, 0);
    await edit(2, '25', 'Escape');
    await edit(2, 'bad', 'Enter');
    expect(appPreferenceMocks.setPaletteTint).toHaveBeenCalledTimes(2);
    expect(container.querySelector('.palette-tint-controls .palette-hex-input')).toBeNull();
  });

  it('persists keyboard theme priority changes and keeps the default theme last', async () => {
    appPreferenceMocks.getThemes.mockResolvedValue([
      partialModelFixture<types.Theme>({ id: 'one', name: 'One' }),
      partialModelFixture<types.Theme>({ id: 'two', name: 'Two' }),
      partialModelFixture<types.Theme>({ id: 'default', name: 'default' }),
    ]);
    await act(async () => root.render(null));
    await act(async () => root.render(<AppearanceSection />));
    const reorder = async (name: string, key: string) => {
      await act(async () => {
        requireValue(
          container.querySelector<HTMLButtonElement>(`[aria-label^="Reorder ${name}."]`),
          'expected theme reorder control'
        ).dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      });
    };
    await reorder('One', 'ArrowDown');
    expect(appPreferenceMocks.reorderThemes).toHaveBeenCalledExactlyOnceWith([
      'two',
      'one',
      'default',
    ]);
    await reorder('Two', 'ArrowDown');
    expect(appPreferenceMocks.reorderThemes).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[aria-label^="Reorder default."]')).toBeNull();
  });

  it.each(['new', 'existing'] as const)(
    'validates and saves %s theme fields from the keyboard, and cancels without saving',
    async (kind) => {
      if (kind === 'existing') {
        appPreferenceMocks.getThemes.mockResolvedValue([
          partialModelFixture<types.Theme>({ id: 'custom', name: 'Custom', clusterPattern: '*' }),
        ]);
        await act(async () => root.render(null));
        await act(async () => root.render(<AppearanceSection />));
      }
      const openEditor = async () => {
        const button = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
          (candidate) =>
            kind === 'new'
              ? candidate.textContent === 'Save new theme'
              : candidate.getAttribute('aria-label') === 'Edit theme'
        );
        await act(async () => requireValue(button, 'expected theme editor action').click());
      };
      const inputs = () => ({
        name: requireValue(
          container.querySelector<HTMLInputElement>('.theme-name-input'),
          'expected name'
        ),
        pattern: requireValue(
          container.querySelector<HTMLInputElement>('.theme-pattern-input'),
          'expected pattern'
        ),
      });
      await openEditor();
      const fields = inputs();
      await act(async () => {
        setInputValue(fields.name, 'Production');
        setInputValue(fields.pattern, 'prod-*');
      });
      await act(async () => {
        fields.pattern.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      });
      expect(appPreferenceMocks.validateThemeClusterPattern).toHaveBeenLastCalledWith('prod-*');
      expect(appPreferenceMocks.saveTheme).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          id: kind === 'existing' ? 'custom' : expect.any(String),
          name: 'Production',
          clusterPattern: 'prod-*',
          paletteHueLight: 20,
          paletteHueDark: 210,
        })
      );
      await openEditor();
      const cancelledFields = inputs();
      await act(async () => setInputValue(cancelledFields.name, 'Do not save'));
      await act(async () => {
        cancelledFields.name.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
        );
      });
      expect(appPreferenceMocks.saveTheme).toHaveBeenCalledTimes(1);
      expect(container.querySelector('.theme-name-input')).toBeNull();
    }
  );

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
