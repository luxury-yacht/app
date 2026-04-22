import { describe, expect, it } from 'vitest';

import {
  DEFAULT_TERMINAL_THEME,
  resolveAnsi256Color,
  resolveTerminalTheme,
  toXtermThemeDefinition,
} from './terminalTheme';

describe('terminalTheme', () => {
  it('uses iTerm2 defaults for the base ANSI palette', () => {
    expect(DEFAULT_TERMINAL_THEME.ansi).toEqual([
      '#14191e',
      '#b43c2a',
      '#00c200',
      '#c7c400',
      '#2744c7',
      '#c040be',
      '#00c5c7',
      '#c7c7c7',
      '#686868',
      '#dd7975',
      '#58e790',
      '#ece100',
      '#a7abf2',
      '#e17ee1',
      '#60fdff',
      '#ffffff',
    ]);
  });

  it('maps terminal theme colors into the xterm theme shape', () => {
    expect(toXtermThemeDefinition(DEFAULT_TERMINAL_THEME)).toMatchObject({
      background: '#15191f',
      foreground: '#dcdcdc',
      red: '#b43c2a',
      brightBlue: '#a7abf2',
      brightWhite: '#ffffff',
    });
  });

  it('resolves ANSI 256 colors using the shared base palette', () => {
    expect(resolveAnsi256Color(1, DEFAULT_TERMINAL_THEME.ansi)).toBe('#b43c2a');
    expect(resolveAnsi256Color(16, DEFAULT_TERMINAL_THEME.ansi)).toBe('#000000');
    expect(resolveAnsi256Color(231, DEFAULT_TERMINAL_THEME.ansi)).toBe('#ffffff');
    expect(resolveAnsi256Color(244, DEFAULT_TERMINAL_THEME.ansi)).toBe('#808080');
  });

  it('reads theme variables from CSS when present', () => {
    const styles = {
      getPropertyValue: (name: string) =>
        (
          ({
            '--terminal-theme-background': '#010203',
            '--terminal-theme-foreground': '#fefefe',
            '--terminal-theme-cursor': '#abcdef',
            '--terminal-theme-selection': '#123456',
            '--terminal-theme-scrollbar-slider': '#111111',
            '--terminal-theme-scrollbar-slider-hover': '#222222',
            '--terminal-theme-scrollbar-slider-active': '#333333',
            '--terminal-theme-overview-ruler-border': '#444444',
            '--scrollbar-width': '9',
            '--terminal-ansi-red': '#ff1111',
            '--terminal-ansi-bright-white': '#fafafa',
          }) satisfies Record<string, string>
        )[name] ?? '',
    };

    const resolvedTheme = resolveTerminalTheme(styles);

    expect(resolvedTheme.background).toBe('#010203');
    expect(resolvedTheme.foreground).toBe('#fefefe');
    expect(resolvedTheme.cursor).toBe('#abcdef');
    expect(resolvedTheme.selectionBackground).toBe('#123456');
    expect(resolvedTheme.scrollbarWidth).toBe(9);
    expect(resolvedTheme.ansi[1]).toBe('#ff1111');
    expect(resolvedTheme.ansi[15]).toBe('#fafafa');
    expect(resolvedTheme.ansi[0]).toBe('#14191e');
  });
});
