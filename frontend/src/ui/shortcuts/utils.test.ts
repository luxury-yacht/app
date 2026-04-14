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

  it('resolves event targets to elements', () => {
    const span = document.createElement('span');
    const text = document.createTextNode('content');
    span.appendChild(text);
    expect(resolveEventElement(text)).toBe(span);
  });
});

describe('isInputElement', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it('returns false for button-like elements', () => {
    const button = document.createElement('button');
    document.body.appendChild(button);
    expect(isInputElement(button)).toBe(false);
  });

  it('returns true for text-entry elements', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    expect(isInputElement(input)).toBe(true);
  });

  it('returns true for contenteditable elements', () => {
    const editable = document.createElement('div');
    editable.contentEditable = 'true';
    document.body.appendChild(editable);
    expect(isInputElement(editable)).toBe(true);
  });

  it('returns false for non-input containers', () => {
    const div = document.createElement('div');
    document.body.appendChild(div);
    expect(isInputElement(div)).toBe(false);
  });

  it('returns true for descendants inside CodeMirror editors', () => {
    const editor = document.createElement('div');
    editor.className = 'cm-editor';
    const content = document.createElement('div');
    editor.appendChild(content);
    document.body.appendChild(editor);
    expect(isInputElement(content)).toBe(true);
  });
});
