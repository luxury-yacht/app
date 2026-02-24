/**
 * frontend/src/ui/shortcuts/utils.test.ts
 *
 * Test suite for utils.
 * Covers key behaviors and edge cases for utils.
 */

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

describe('isInputElement with data-allow-shortcuts containers', () => {
  // Helper: wraps a child element in a container with data-allow-shortcuts="true"
  // and appends both to document.body so .closest() traversal works.
  const wrapInAllowShortcuts = (child: HTMLElement): HTMLDivElement => {
    const container = document.createElement('div');
    container.setAttribute('data-allow-shortcuts', 'true');
    container.appendChild(child);
    document.body.appendChild(container);
    return container;
  };

  afterEach(() => {
    document.body.replaceChildren();
  });

  it('returns true for a button inside a data-allow-shortcuts container', () => {
    const button = document.createElement('button');
    wrapInAllowShortcuts(button);
    expect(isInputElement(button)).toBe(true);
  });

  it('returns true for an input inside a data-allow-shortcuts container', () => {
    const input = document.createElement('input');
    wrapInAllowShortcuts(input);
    expect(isInputElement(input)).toBe(true);
  });

  it('returns true for a link inside a data-allow-shortcuts container', () => {
    const link = document.createElement('a');
    link.setAttribute('href', '/resource');
    wrapInAllowShortcuts(link);
    expect(isInputElement(link)).toBe(true);
  });

  it('returns true for a span nested inside a button inside the container', () => {
    const button = document.createElement('button');
    const span = document.createElement('span');
    button.appendChild(span);
    wrapInAllowShortcuts(button);
    expect(isInputElement(span)).toBe(true);
  });

  it('returns true for a contenteditable inside a data-allow-shortcuts container', () => {
    const editable = document.createElement('div');
    // Use setAttribute so jsdom reflects the attribute for .closest() matching
    editable.setAttribute('contenteditable', 'true');
    wrapInAllowShortcuts(editable);
    expect(isInputElement(editable)).toBe(true);
  });

  it('returns true for a role="textbox" inside a data-allow-shortcuts container', () => {
    const textbox = document.createElement('div');
    textbox.setAttribute('role', 'textbox');
    wrapInAllowShortcuts(textbox);
    expect(isInputElement(textbox)).toBe(true);
  });

  it('returns false for a plain div inside a data-allow-shortcuts container', () => {
    const div = document.createElement('div');
    wrapInAllowShortcuts(div);
    expect(isInputElement(div)).toBe(false);
  });

  it('returns false for a button with direct data-allow-shortcuts="true"', () => {
    const button = document.createElement('button');
    button.setAttribute('data-allow-shortcuts', 'true');
    document.body.appendChild(button);
    expect(isInputElement(button)).toBe(false);
    document.body.removeChild(button);
  });
});
