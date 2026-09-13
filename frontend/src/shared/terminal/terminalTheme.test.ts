import { describe, expect, it } from 'vitest';

import { DEFAULT_TERMINAL_THEME, resolveAnsi256Color, resolveTerminalTheme } from './terminalTheme';

describe('terminalTheme', () => {
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
