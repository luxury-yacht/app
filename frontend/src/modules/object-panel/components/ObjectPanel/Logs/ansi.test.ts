import { DEFAULT_TERMINAL_THEME } from '@shared/terminal/terminalTheme';
import { describe, expect, it } from 'vitest';
import { parseAnsiTextSegments } from './ansi';

describe('parseAnsiTextSegments', () => {
  it('covers parseAnsiTextSegments scenarios', async () => {
    // Scenario: uses the shared iTerm2 ANSI palette for base colors
    expect(parseAnsiTextSegments('\u001b[31merror\u001b[0m', DEFAULT_TERMINAL_THEME)).toEqual([
      {
        text: 'error',
        style: { color: '#b43c2a' },
      },
    ]);
    // Scenario: resolves bright colors from the shared palette
    expect(parseAnsiTextSegments('\u001b[94mnote\u001b[0m', DEFAULT_TERMINAL_THEME)).toEqual([
      {
        text: 'note',
        style: { color: '#a7abf2' },
      },
    ]);
    // Scenario: dims the foreground color instead of using span opacity
    expect(parseAnsiTextSegments('\u001b[2mquiet\u001b[0m', DEFAULT_TERMINAL_THEME)).toEqual([
      {
        text: 'quiet',
        style: { color: 'rgba(220, 220, 220, 0.5)' },
      },
    ]);
    // Scenario: swaps foreground and background for inverse video
    expect(parseAnsiTextSegments('\u001b[7mflip\u001b[0m', DEFAULT_TERMINAL_THEME)).toEqual([
      {
        text: 'flip',
        style: {
          color: '#15191f',
          backgroundColor: '#dcdcdc',
        },
      },
    ]);
    // Scenario: keeps truecolor values exact
    expect(
      parseAnsiTextSegments('\u001b[38;2;1;2;3mtruecolor\u001b[0m', DEFAULT_TERMINAL_THEME)
    ).toEqual([
      {
        text: 'truecolor',
        style: { color: 'rgb(1, 2, 3)' },
      },
    ]);
    // Scenario: resolves 256-color foreground and background values
    expect(
      parseAnsiTextSegments('\u001b[38;5;196;48;5;21mindexed\u001b[0m', DEFAULT_TERMINAL_THEME)
    ).toEqual([
      {
        text: 'indexed',
        style: {
          color: '#ff0000',
          backgroundColor: '#0000ff',
        },
      },
    ]);
    // Scenario: applies bold without affecting color resolution
    expect(parseAnsiTextSegments('\u001b[1;32mready\u001b[0m', DEFAULT_TERMINAL_THEME)).toEqual([
      {
        text: 'ready',
        style: {
          color: '#00c200',
          fontWeight: '600',
        },
      },
    ]);
    // Scenario: keeps truecolor backgrounds exact
    expect(parseAnsiTextSegments('\u001b[48;2;4;5;6mbg\u001b[0m', DEFAULT_TERMINAL_THEME)).toEqual([
      {
        text: 'bg',
        style: { backgroundColor: 'rgb(4, 5, 6)' },
      },
    ]);
    // Scenario: resets styles back to plain text segments
    expect(parseAnsiTextSegments('\u001b[31mred\u001b[0m plain', DEFAULT_TERMINAL_THEME)).toEqual([
      {
        text: 'red',
        style: { color: '#b43c2a' },
      },
      {
        text: ' plain',
        style: {},
      },
    ]);
    // Scenario: supports nested resets while preserving the remaining foreground
    expect(
      parseAnsiTextSegments(
        '\u001b[31mred \u001b[1mbold\u001b[22m still\u001b[0m plain',
        DEFAULT_TERMINAL_THEME
      )
    ).toEqual([
      {
        text: 'red ',
        style: { color: '#b43c2a' },
      },
      {
        text: 'bold',
        style: { color: '#b43c2a', fontWeight: '600' },
      },
      {
        text: ' still',
        style: { color: '#b43c2a' },
      },
      {
        text: ' plain',
        style: {},
      },
    ]);
  });
});
