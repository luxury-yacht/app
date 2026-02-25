/**
 * frontend/src/ui/shortcuts/utils.ts
 *
 * Utility helpers for utils.
 * Provides shared helper functions for the UI layer.
 */

import { ShortcutModifiers } from '@/types/shortcuts';

// Helper to format shortcuts for display
export function formatShortcut(key: string, modifiers?: ShortcutModifiers): string {
  const parts: string[] = [];

  // Use appropriate symbols based on platform
  const isMac = navigator.userAgent.includes('Mac');

  if (modifiers?.meta) parts.push(isMac ? '⌘' : 'Win');
  if (modifiers?.ctrl) parts.push(isMac ? '⌃' : 'Ctrl');
  if (modifiers?.alt) parts.push(isMac ? '⌥' : 'Alt');
  if (modifiers?.shift) parts.push(isMac ? '⇧' : 'Shift');

  // Format the key
  const formattedKey = key.length === 1 ? key.toUpperCase() : key;
  parts.push(formattedKey);

  return parts.join(isMac ? '' : '+');
}

// Helper to check if modifiers match
export function modifiersMatch(event: KeyboardEvent, modifiers?: ShortcutModifiers): boolean {
  const required = modifiers || {};

  return (
    event.ctrlKey === (required.ctrl || false) &&
    event.shiftKey === (required.shift || false) &&
    event.altKey === (required.alt || false) &&
    event.metaKey === (required.meta || false)
  );
}

// Helper to create a shortcut key string for Map keys
export function getShortcutKey(key: string, modifiers?: ShortcutModifiers): string {
  const parts: string[] = [];
  if (modifiers?.meta) parts.push('meta');
  if (modifiers?.ctrl) parts.push('ctrl');
  if (modifiers?.alt) parts.push('alt');
  if (modifiers?.shift) parts.push('shift');
  parts.push(key.toLowerCase());
  return parts.join('+');
}

// Check if user is typing in an input field
export const resolveEventElement = (target: EventTarget | null): HTMLElement | null => {
  if (!target) return null;
  if (target instanceof HTMLElement) return target;
  if (target instanceof Node) {
    return target.parentElement;
  }
  return null;
};

// Selector for elements with their own keyboard interaction.
// Used to protect interactive elements inside data-allow-shortcuts containers
// from having bare keystrokes intercepted by shortcut handlers.
const INTERACTIVE_ELEMENT_SELECTOR = [
  'input',
  'textarea',
  'select',
  'button',
  'summary',
  'a[href]',
  '[contenteditable="true"]',
  '[contenteditable="plaintext-only"]',
  '[role="textbox"]',
  '[role="button"]',
].join(', ');

export function isInputElement(target: EventTarget | null): boolean {
  let element = resolveEventElement(target);
  if (!element && typeof document !== 'undefined') {
    const active = document.activeElement;
    if (active instanceof HTMLElement) {
      element = active;
    }
  }
  if (!element && typeof window !== 'undefined') {
    const selection = window.getSelection();
    const anchorNode = selection?.anchorNode ?? null;
    element = resolveEventElement(anchorNode);
  }
  if (!element) return false;

  if (element instanceof HTMLElement) {
    // Direct opt-in: the element itself carries data-allow-shortcuts="true".
    // Must be checked before the ancestor .closest() check below, which also
    // matches self — without this guard, interactive elements that explicitly
    // opt in (e.g. Dropdown's search input) would be treated as inputs.
    const optIn = element.getAttribute('data-allow-shortcuts');
    if (optIn && optIn.toLowerCase() === 'true') {
      return false;
    }
    if (element.closest('[data-allow-shortcuts="true"]')) {
      // The ancestor opted in to shortcuts, but interactive elements inside
      // should still be protected from bare-key interception. The direct
      // attribute check above already handles elements that explicitly opt in.
      if (element.closest(INTERACTIVE_ELEMENT_SELECTOR)) {
        return true;
      }
      return false;
    }
  }

  const tagName = element.tagName.toLowerCase();
  const contentEditable = element.contentEditable;
  const isContentEditable = contentEditable === 'true' || contentEditable === 'plaintext-only';
  const isInput = tagName === 'input' || tagName === 'textarea' || tagName === 'select';
  const isCodeMirror = !!element.closest('.cm-editor');

  return isInput || isContentEditable || isCodeMirror;
}
