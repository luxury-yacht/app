/**
 * frontend/src/utils/inputAssistPolicy.test.ts
 *
 * Test suite for the global input typing-assist policy utility.
 */

import { afterEach, describe, expect, it } from 'vitest';

import {
  applyTypingAssistPolicy,
  installTypingAssistPolicyObserver,
} from '@utils/inputAssistPolicy';

describe('inputAssistPolicy', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('disables typing assistance on existing inputs, textareas, and contenteditable nodes', () => {
    document.body.innerHTML = `
      <input id="name" />
      <textarea id="notes"></textarea>
      <div id="editor" contenteditable="true"></div>
    `;

    applyTypingAssistPolicy(document);

    const input = document.getElementById('name') as HTMLInputElement;
    const textarea = document.getElementById('notes') as HTMLTextAreaElement;
    const editor = document.getElementById('editor') as HTMLElement;

    expect(input.getAttribute('autocapitalize')).toBe('off');
    expect(input.getAttribute('autocomplete')).toBe('off');
    expect(input.getAttribute('autocorrect')).toBe('off');
    expect(input.spellcheck).toBe(false);

    expect(textarea.getAttribute('autocapitalize')).toBe('off');
    expect(textarea.getAttribute('autocomplete')).toBe('off');
    expect(textarea.getAttribute('autocorrect')).toBe('off');
    expect(textarea.spellcheck).toBe(false);

    expect(editor.getAttribute('autocapitalize')).toBe('off');
    expect(editor.getAttribute('autocomplete')).toBe('off');
    expect(editor.getAttribute('autocorrect')).toBe('off');
    expect(editor.spellcheck).toBe(false);
  });

  it('applies the policy to dynamically added input-like nodes', async () => {
    const cleanup = installTypingAssistPolicyObserver(document.body);

    const wrapper = document.createElement('div');
    wrapper.innerHTML = `
      <input id="dynamic-input" />
      <div id="dynamic-editor" contenteditable="plaintext-only"></div>
    `;
    document.body.appendChild(wrapper);

    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    const input = document.getElementById('dynamic-input') as HTMLInputElement;
    const editor = document.getElementById('dynamic-editor') as HTMLElement;

    expect(input.getAttribute('autocapitalize')).toBe('off');
    expect(input.getAttribute('autocomplete')).toBe('off');
    expect(input.getAttribute('autocorrect')).toBe('off');
    expect(input.spellcheck).toBe(false);

    expect(editor.getAttribute('autocapitalize')).toBe('off');
    expect(editor.getAttribute('autocomplete')).toBe('off');
    expect(editor.getAttribute('autocorrect')).toBe('off');
    expect(editor.spellcheck).toBe(false);

    cleanup();
  });

  it('applies the policy when an element becomes contenteditable later', async () => {
    const cleanup = installTypingAssistPolicyObserver(document.body);

    const editor = document.createElement('div');
    editor.id = 'late-editor';
    document.body.appendChild(editor);

    editor.setAttribute('contenteditable', 'true');

    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(editor.getAttribute('autocapitalize')).toBe('off');
    expect(editor.getAttribute('autocomplete')).toBe('off');
    expect(editor.getAttribute('autocorrect')).toBe('off');
    expect(editor.spellcheck).toBe(false);

    cleanup();
  });
});
