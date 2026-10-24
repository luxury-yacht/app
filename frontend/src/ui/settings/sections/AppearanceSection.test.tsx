/**
 * frontend/src/ui/settings/sections/AppearanceSection.test.tsx
 *
 * The Appearance settings: every input is named; the chosen mode is saved and
 * applied to the page; tint, accent, and link edits save through the
 * preference owner for the visible mode (bounded, normalized, and keeping the
 * other fields), and a live change or reset offers to save the default theme
 * with both modes' values; saved themes reorder from the keyboard with the
 * default theme last, save from the keyboard after their pattern validates,
 * cancel without saving, and show an invalid pattern inline. Runs inside the
 * production shell with the real preference and appearance owners over the
 * faked backend (test-utils/appState). reorderThemeByOffset is tested directly.
 */

import type { types } from '@core/backend-api/models';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installAppStateHarness, type MountedApp } from '@/test-utils/appState/harness';
import { controlName } from '@/test-utils/controlName';
import { partialModelFixture } from '@/test-utils/partialModelFixture';
import { requireValue } from '@/test-utils/requireValue';
import AppearanceSection, { reorderThemeByOffset } from './AppearanceSection';

const app = installAppStateHarness();
let view: MountedApp;
let themes: types.Theme[];

// The light and dark values the app starts with.
const appearance = {
  paletteHueLight: 20,
  paletteSaturationLight: 0,
  paletteBrightnessLight: 0,
  paletteHueDark: 210,
  paletteSaturationDark: 12,
  paletteBrightnessDark: -3,
  accentColorLight: '#123456',
  accentColorDark: '#abcdef',
  linkColorLight: '#654321',
  linkColorDark: '#fedcba',
};

const theme = (fields: Partial<types.Theme> & Pick<types.Theme, 'id' | 'name'>) =>
  partialModelFixture<types.Theme>({ clusterPattern: '', ...appearance, ...fields });

/** Preference changes the backend saved, in order. */
const saved = () =>
  app.backend.calls('UpdateAppPreferences').flatMap(([request]) => request.changes ?? []);
const savedThemes = () => app.backend.calls('SaveTheme').map(([sent]) => sent);

const setInputValue = (input: HTMLInputElement, value: string): void => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
};

const press = async (target: HTMLElement, key: string) => {
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
  await app.settle();
};

const click = async (target: HTMLElement) => {
  await act(async () => target.click());
  await app.settle();
};

const buttonWithText = (text: string) =>
  requireValue(
    Array.from(view.container.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent === text
    ),
    `expected the ${text} button`
  );

const unsavedPrompt = () => view.container.querySelector('.themes-unsaved-default');

/** Lets the debounced preference saves run. */
const flushDebouncedSaves = async () => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300);
  });
  await app.settle();
};

const showSection = async () => {
  view = await app.render(null);
  await view.show(<AppearanceSection />);
};

beforeEach(() => {
  app.preferences({ appearanceMode: 'light', ...appearance });
  themes = [theme({ id: 'default', name: 'default' })];
  // Mirrors backend/preferences_settings.go UpdateAppPreferences: the next read
  // returns what was saved.
  app.backend.answer('UpdateAppPreferences', (request) => {
    const changes = request.changes ?? [];
    app.preferences(Object.fromEntries(changes.map(({ key, value }) => [key, value])));
    return { settings: null, changedKeys: changes.map(({ key }) => key) };
  });
  // Mirrors the backend theme library: saved themes keep the default theme last,
  // and applying a theme writes its values into the settings.
  app.backend.answer('GetThemes', () => [...themes]);
  app.backend.answer('SaveTheme', (next) => {
    const others = themes.filter((existing) => existing.id !== next.id);
    themes = themes.some((existing) => existing.id === next.id)
      ? themes.map((existing) => (existing.id === next.id ? next : existing))
      : [...others.filter((existing) => existing.id !== 'default'), next, ...themes.slice(-1)];
  });
  app.backend.answer('ReorderThemes', (ids) => {
    themes = (ids ?? []).map((id) =>
      requireValue(
        themes.find((existing) => existing.id === id),
        id
      )
    );
  });
  app.backend.answer('ApplyTheme', (id) => {
    const {
      id: _id,
      name: _name,
      clusterPattern: _pattern,
      ...values
    } = requireValue(
      themes.find((existing) => existing.id === id),
      `theme ${id}`
    );
    app.preferences(values);
  });
  app.backend.answer('ValidateThemeClusterPattern', () => ({ valid: true, message: '' }));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('AppearanceSection', () => {
  // The tint and color value editors and the new-theme editor appear on
  // demand; their inputs are named too.
  it('gives every input a name, including the value and theme editors', async () => {
    await showSection();
    const unnamedInputs = () =>
      Array.from(view.container.querySelectorAll('input'))
        .filter((input) => controlName(input) === '')
        .map((input) => input.className || input.type);
    expect(unnamedInputs()).toEqual([]);

    const valueEditors = view.container.querySelectorAll('.palette-hex-clickable').length;
    expect(valueEditors).toBeGreaterThan(3);
    for (let index = 0; index < valueEditors; index += 1) {
      await click(
        requireValue(
          view.container.querySelectorAll<HTMLButtonElement>('.palette-hex-clickable')[index],
          `expected value button ${index}`
        )
      );
      const editor = requireValue(
        view.container.querySelector<HTMLInputElement>('.palette-hex-input'),
        `expected value editor ${index}`
      );
      expect(unnamedInputs()).toEqual([]);
      await press(editor, 'Escape');
    }

    await click(buttonWithText('Save new theme'));
    expect(view.container.querySelector('.theme-name-input')).not.toBeNull();
    expect(unnamedInputs()).toEqual([]);
  });

  it('saves the chosen appearance mode and applies it to the page', async () => {
    await showSection();
    const mode = (label: string) =>
      requireValue(
        Array.from(
          view.container.querySelectorAll<HTMLButtonElement>(
            'fieldset[aria-label="Appearance mode"] button'
          )
        ).find((button) => button.textContent === label),
        `expected the ${label} mode`
      );
    expect(mode('Light').getAttribute('aria-pressed')).toBe('true');

    await click(mode('Dark'));

    expect(saved()).toEqual([{ key: 'appearanceMode', value: 'dark' }]);
    expect(document.documentElement.dataset.appearanceMode).toBe('dark');
    expect(mode('Dark').getAttribute('aria-pressed')).toBe('true');
  });

  it('offers to save a live tint change as the default theme, with both modes’ values', async () => {
    await showSection();
    await act(async () => {
      setInputValue(
        requireValue(
          view.container.querySelector<HTMLInputElement>('[id$="-palette-hue"]'),
          'expected the palette hue slider'
        ),
        '30'
      );
    });
    expect(unsavedPrompt()).not.toBeNull();

    await click(buttonWithText('Save'));

    expect(savedThemes()).toEqual([
      expect.objectContaining({
        id: 'default',
        name: 'default',
        clusterPattern: '',
        ...appearance,
        paletteHueLight: 30,
      }),
    ]);
    expect(unsavedPrompt()).toBeNull();
  });

  it('offers to save the default theme again after a tint, accent, or link reset', async () => {
    await showSection();
    for (const reset of ['Reset Hue', 'Reset Accent color', 'Reset Link color']) {
      await click(
        requireValue(
          view.container.querySelector<HTMLButtonElement>(`button[title="${reset}"]`),
          `expected the ${reset} button`
        )
      );
      expect(unsavedPrompt()).not.toBeNull();
      await click(buttonWithText('Save'));
      expect(unsavedPrompt()).toBeNull();
    }

    expect(savedThemes().slice(-1)).toEqual([
      expect.objectContaining({
        id: 'default',
        paletteHueLight: 0,
        accentColorLight: '',
        linkColorLight: '',
        paletteHueDark: 210,
        accentColorDark: '#abcdef',
        linkColorDark: '#fedcba',
      }),
    ]);
  });

  it.each([
    ['accent', 0, 'accentColorLight'],
    ['link', 1, 'linkColorLight'],
  ] as const)(
    'saves a normalized %s hex draft and discards invalid or canceled drafts',
    async (_name, index, key) => {
      await showSection();
      vi.useFakeTimers();
      const field = requireValue(
        view.container.querySelectorAll('.palette-color-field')[index],
        'expected color control'
      );
      const edit = async (draft: string) => {
        await click(
          requireValue(
            field.querySelector<HTMLButtonElement>('.palette-hex-clickable'),
            'expected hex edit button'
          )
        );
        const input = requireValue(
          field.querySelector<HTMLInputElement>('.palette-hex-input'),
          'expected hex input'
        );
        await act(async () => setInputValue(input, draft));
        return input;
      };

      await press(await edit('AbC'), 'Enter');
      await press(await edit('xyz'), 'Enter');
      await press(await edit('#112233'), 'Escape');
      const blurred = await edit('#445566');
      await act(async () => {
        blurred.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
      });
      await flushDebouncedSaves();

      expect(saved()).toEqual([{ key, value: '#aabbcc' }]);
      expect(field.querySelector('.palette-hex-input')).toBeNull();
      expect(field.querySelector<HTMLInputElement>('input[type="color"]')?.value).toBe('#aabbcc');
    }
  );

  it('keeps the other tint fields when one is edited or reset', async () => {
    await showSection();
    vi.useFakeTimers();
    /** The light tint the latest save wrote, as [hue, saturation, brightness]. */
    const savedTint = () => {
      const tint = Object.fromEntries(saved().map(({ key, value }) => [key, value]));
      return [tint.paletteHueLight, tint.paletteSaturationLight, tint.paletteBrightnessLight];
    };
    const change = async (field: string, value: string) => {
      await act(async () => {
        setInputValue(
          requireValue(
            view.container.querySelector<HTMLInputElement>(`[id$="-palette-${field}"]`),
            'expected palette slider'
          ),
          value
        );
      });
    };
    await change('hue', '120');
    await change('saturation', '35');
    await change('brightness', '-10');
    await flushDebouncedSaves();
    expect(savedTint()).toEqual([120, 35, -10]);

    for (const [field, expected] of [
      ['Saturation', [120, 0, -10]],
      ['Brightness', [120, 0, 0]],
      ['Hue', [0, 0, 0]],
    ] as const) {
      await click(
        requireValue(
          view.container.querySelector<HTMLButtonElement>(`button[title="Reset ${field}"]`),
          'expected palette reset'
        )
      );
      await flushDebouncedSaves();
      expect(savedTint()).toEqual(expected);
    }
  });

  it('saves bounded inline tint values while canceled and invalid edits change nothing', async () => {
    await showSection();
    vi.useFakeTimers();
    const edit = async (index: number, value: string, key: string) => {
      await click(
        requireValue(
          view.container.querySelectorAll<HTMLButtonElement>('.palette-slider-value')[index],
          'expected editable tint'
        )
      );
      const input = requireValue(
        view.container.querySelector<HTMLInputElement>('.palette-tint-controls .palette-hex-input'),
        'expected tint editor'
      );
      await act(async () => setInputValue(input, value));
      await press(input, key);
      await flushDebouncedSaves();
    };

    // Above the hue maximum (appPreferences.ts PALETTE_HUE_MAX).
    await edit(0, '500', 'Enter');
    await edit(1, '34', 'Enter');
    await edit(2, '25', 'Escape');
    await edit(2, 'bad', 'Enter');

    expect(app.backend.calls('UpdateAppPreferences')).toHaveLength(2);
    expect(saved().slice(-3)).toEqual([
      { key: 'paletteHueLight', value: 360 },
      { key: 'paletteSaturationLight', value: 34 },
      { key: 'paletteBrightnessLight', value: 0 },
    ]);
    expect(view.container.querySelector('.palette-tint-controls .palette-hex-input')).toBeNull();
  });

  it('saves keyboard theme priority changes and keeps the default theme last', async () => {
    themes = [
      theme({ id: 'one', name: 'One' }),
      theme({ id: 'two', name: 'Two' }),
      theme({ id: 'default', name: 'default' }),
    ];
    await showSection();
    const handle = (name: string) =>
      requireValue(
        view.container.querySelector<HTMLButtonElement>(`[aria-label^="Reorder ${name}."]`),
        `expected the ${name} reorder control`
      );

    const order = () =>
      Array.from(view.container.querySelectorAll('.themes-table-row .theme-name')).map(
        (name) => name.textContent
      );

    await press(handle('One'), 'ArrowDown');
    expect(app.backend.calls('ReorderThemes')).toEqual([[['two', 'one', 'default']]]);
    expect(order()).toEqual(['Two', 'One', 'default']);

    // Two is now first and One is the last custom theme, which cannot move below the default.
    await press(handle('Two'), 'ArrowUp');
    await press(handle('One'), 'ArrowDown');
    expect(app.backend.calls('ReorderThemes')).toHaveLength(1);
    expect(view.container.querySelector('[aria-label^="Reorder default."]')).toBeNull();
  });

  it.each(['new', 'existing'] as const)(
    'validates and saves %s theme fields from the keyboard, and cancels without saving',
    async (kind) => {
      if (kind === 'existing') {
        themes = [
          theme({ id: 'custom', name: 'Custom', clusterPattern: '*' }),
          theme({ id: 'default', name: 'default' }),
        ];
      }
      await showSection();
      const openEditor = async () =>
        click(
          requireValue(
            Array.from(view.container.querySelectorAll<HTMLButtonElement>('button')).find(
              (candidate) =>
                kind === 'new'
                  ? candidate.textContent === 'Save new theme'
                  : candidate.getAttribute('aria-label') === 'Edit theme'
            ),
            'expected theme editor action'
          )
        );
      const inputs = () => ({
        name: requireValue(
          view.container.querySelector<HTMLInputElement>('.theme-name-input'),
          'expected name'
        ),
        pattern: requireValue(
          view.container.querySelector<HTMLInputElement>('.theme-pattern-input'),
          'expected pattern'
        ),
      });

      await openEditor();
      const fields = inputs();
      await act(async () => {
        setInputValue(fields.name, 'Production');
        setInputValue(fields.pattern, 'prod-*');
      });
      await press(fields.pattern, 'Enter');

      expect(app.backend.calls('ValidateThemeClusterPattern').slice(-1)).toEqual([['prod-*']]);
      expect(savedThemes()).toEqual([
        expect.objectContaining({
          ...(kind === 'existing' ? { id: 'custom' } : {}),
          name: 'Production',
          clusterPattern: 'prod-*',
          ...appearance,
        }),
      ]);

      await openEditor();
      const cancelled = inputs();
      await act(async () => setInputValue(cancelled.name, 'Do not save'));
      await press(cancelled.name, 'Escape');

      expect(savedThemes()).toHaveLength(1);
      expect(view.container.querySelector('.theme-name-input')).toBeNull();
    }
  );

  it('shows an invalid theme pattern inline instead of reporting it', async () => {
    app.backend.answer('ValidateThemeClusterPattern', () => ({
      valid: false,
      message: 'Invalid cluster pattern: missing closing bracket.',
    }));
    await showSection();

    await click(buttonWithText('Save new theme'));
    const nameInput = requireValue(
      view.container.querySelector<HTMLInputElement>('.theme-name-input'),
      'expected the theme name input'
    );
    const patternInput = requireValue(
      view.container.querySelector<HTMLInputElement>('.theme-pattern-input'),
      'expected the theme cluster-pattern input'
    );
    expect(document.activeElement).toBe(nameInput);

    await act(async () => {
      setInputValue(nameInput, 'Prod');
      setInputValue(patternInput, 'prod-[');
    });
    await click(
      requireValue(
        view.container.querySelector<HTMLButtonElement>('button[aria-label="Save new theme"]'),
        'expected the open theme editor Save button'
      )
    );

    expect(app.backend.calls('ValidateThemeClusterPattern')).toEqual([['prod-[']]);
    expect(view.container.textContent).toContain('missing closing bracket');
    expect(patternInput.getAttribute('aria-invalid')).toBe('true');
    expect(savedThemes()).toEqual([]);
    expect(app.errors.records()).toEqual([]);

    await act(async () => setInputValue(patternInput, 'prod-*'));

    expect(view.container.textContent).not.toContain('missing closing bracket');
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
