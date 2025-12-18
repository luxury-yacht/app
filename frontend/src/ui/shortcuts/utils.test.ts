import { describe, it, expect, afterEach } from 'vitest';

import {
  formatShortcut,
  modifiersMatch,
  getShortcutKey,
  isInputElement,
  resolveEventElement,
} from './utils';

const originalUserAgent = navigator.userAgent;

const setUserAgent = (value: string) => {
  Object.defineProperty(navigator, 'userAgent', {
    value,
    configurable: true,
  });
};

afterEach(() => {
  setUserAgent(originalUserAgent);
});

describe('shortcut utilities', () => {
  it('formats shortcuts with mac symbols', () => {
    setUserAgent('Macintosh');
    const formatted = formatShortcut('k', { meta: true, shift: true });
    expect(formatted).toBe('⌘⇧K');
  });

  it('formats shortcuts with plus separators on non-Mac platforms', () => {
    setUserAgent('Windows');
    const formatted = formatShortcut('ArrowUp', { ctrl: true, alt: true });
    expect(formatted).toBe('Ctrl+Alt+ArrowUp');
  });

  it('matches modifier combinations correctly', () => {
    const event = new KeyboardEvent('keydown', {
      key: 'k',
      ctrlKey: true,
      shiftKey: false,
      altKey: true,
      metaKey: false,
    });
    expect(modifiersMatch(event, { ctrl: true, alt: true })).toBe(true);
    expect(modifiersMatch(event, { ctrl: true, shift: true })).toBe(false);
  });

  it('produces stable shortcut map keys', () => {
    expect(getShortcutKey('K', { ctrl: true, alt: true })).toBe('ctrl+alt+k');
    expect(getShortcutKey('K')).toBe('k');
  });

  it('detects interactive elements and content editable regions', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    expect(isInputElement(input)).toBe(true);
    document.body.removeChild(input);

    const editable = document.createElement('div');
    editable.contentEditable = 'true';
    expect(isInputElement(editable)).toBe(true);

    const codemirror = document.createElement('div');
    codemirror.className = 'cm-editor';
    expect(isInputElement(codemirror)).toBe(true);
  });

  it('allows opt-in elements to bypass input detection', () => {
    const input = document.createElement('input');
    input.setAttribute('data-allow-shortcuts', 'true');
    expect(isInputElement(input)).toBe(false);
  });

  it('resolves event targets to elements', () => {
    const span = document.createElement('span');
    const text = document.createTextNode('content');
    span.appendChild(text);
    expect(resolveEventElement(text)).toBe(span);
  });
});
