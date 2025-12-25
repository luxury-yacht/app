/**
 * frontend/src/core/codemirror/theme.test.ts
 *
 * Test suite for theme.
 * Covers key behaviors and edge cases for theme.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

const themeMock = vi.hoisted(() => {
  return vi.fn((spec: unknown, options: { dark: boolean }) => ({
    spec,
    options,
    id: options.dark ? 'dark-theme' : 'light-theme',
  }));
});

const defineMock = vi.hoisted(() => {
  return vi.fn((specs: unknown, options: { themeType: string }) => ({
    specs,
    options,
    id: options.themeType,
  }));
});

const syntaxHighlightingMock = vi.hoisted(() => {
  return vi.fn((style: unknown) => ({ highlightId: style }));
});

vi.mock('@codemirror/view', () => ({
  EditorView: {
    theme: themeMock,
  },
}));

vi.mock('@codemirror/language', () => ({
  HighlightStyle: {
    define: defineMock,
  },
  syntaxHighlighting: syntaxHighlightingMock,
}));

vi.mock('@lezer/highlight', () => ({
  tags: {
    keyword: 'keyword',
    bool: 'bool',
    string: 'string',
    number: 'number',
    float: 'float',
    integer: 'integer',
    null: 'null',
    atom: 'atom',
    propertyName: 'propertyName',
    attributeName: 'attributeName',
    tagName: 'tagName',
    typeName: 'typeName',
    operator: 'operator',
    punctuation: 'punctuation',
    comment: 'comment',
    meta: 'meta',
    invalid: 'invalid',
    special: (value: unknown) => value,
    definition: (value: unknown) => value,
  },
}));

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe('buildCodeTheme', () => {
  it('returns the dark theme set when dark mode is enabled', async () => {
    const { buildCodeTheme } = await import('./theme');

    const result = buildCodeTheme(true);

    expect(themeMock).toHaveBeenNthCalledWith(1, expect.any(Object), { dark: false });
    expect(themeMock).toHaveBeenNthCalledWith(2, expect.any(Object), { dark: true });
    expect(defineMock).toHaveBeenNthCalledWith(1, expect.any(Array), { themeType: 'light' });
    expect(defineMock).toHaveBeenNthCalledWith(2, expect.any(Array), { themeType: 'dark' });
    expect(syntaxHighlightingMock).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      theme: expect.objectContaining({ id: 'dark-theme' }),
      highlight: expect.objectContaining({ highlightId: expect.objectContaining({ id: 'dark' }) }),
    });
  });

  it('returns the light theme set when dark mode is disabled', async () => {
    const { buildCodeTheme } = await import('./theme');

    const result = buildCodeTheme(false);

    expect(result).toEqual({
      theme: expect.objectContaining({ id: 'light-theme' }),
      highlight: expect.objectContaining({ highlightId: expect.objectContaining({ id: 'light' }) }),
    });
  });
});
