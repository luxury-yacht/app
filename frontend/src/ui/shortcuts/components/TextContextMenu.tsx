/**
 * frontend/src/ui/shortcuts/components/TextContextMenu.tsx
 *
 * Provides a consistent custom right-click context menu with Copy, Cut,
 * Paste, and Select All on text-relevant elements (inputs, textareas,
 * contenteditable, and selected text). CodeMirror editors are skipped
 * here because YamlTab registers its own handler via domEventHandlers,
 * but both render the same ContextMenu component for visual consistency.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import ContextMenu, { type ContextMenuItem } from '@shared/components/ContextMenu';
import { deriveCopyText } from '../context';

interface TextContextMenuState {
  position: { x: number; y: number };
  items: ContextMenuItem[];
}

/** Input types that represent textual content (not buttons, checkboxes, etc.). */
const TEXTUAL_INPUT_TYPES = new Set([
  'text', 'search', 'url', 'email', 'password', 'tel', 'number',
]);

function isTextualInput(el: HTMLInputElement): boolean {
  return TEXTUAL_INPUT_TYPES.has(el.type);
}

/** Check whether the target is an editable text element. */
function isEditableTarget(target: Element): boolean {
  if (target instanceof HTMLInputElement) {
    return isTextualInput(target) && !target.readOnly && !target.disabled;
  }
  if (target instanceof HTMLTextAreaElement) {
    return !target.readOnly && !target.disabled;
  }
  if (target.closest('[contenteditable="true"]')) return true;
  return false;
}

const TextContextMenu: React.FC = () => {
  const [menu, setMenu] = useState<TextContextMenuState | null>(null);
  const targetRef = useRef<Element | null>(null);
  const selectedTextRef = useRef<string | null>(null);

  const handleClose = useCallback(() => {
    setMenu(null);
    targetRef.current = null;
    selectedTextRef.current = null;
  }, []);

  useEffect(() => {
    const handleContextMenu = (event: MouseEvent) => {
      // Skip if already handled (e.g., GridTable or CodeMirror context menus).
      if (event.defaultPrevented) return;

      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;

      // CodeMirror editors have their own handler in YamlTab — skip here.
      if (target.closest('.cm-editor')) return;

      // Only show on text-relevant targets.
      const isInput =
        (target instanceof HTMLInputElement && isTextualInput(target)) ||
        target instanceof HTMLTextAreaElement;
      const isContentEditable = !!target.closest('[contenteditable="true"]');
      const selectedText = deriveCopyText(window.getSelection());
      const hasSelection = !!selectedText;

      if (!isInput && !isContentEditable && !hasSelection) return;

      event.preventDefault();
      targetRef.current = target;
      selectedTextRef.current = selectedText;

      const editable = isEditableTarget(target);
      const items: ContextMenuItem[] = [];

      if (editable) {
        items.push({
          label: 'Cut',
          disabled: !hasSelection,
          onClick: () => {
            if (!selectedTextRef.current) return;
            navigator.clipboard.writeText(selectedTextRef.current);
            focusTarget(targetRef.current);
            document.execCommand('delete');
          },
        });
      }

      items.push({
        label: 'Copy',
        disabled: !hasSelection,
        onClick: () => {
          if (selectedTextRef.current) {
            navigator.clipboard.writeText(selectedTextRef.current);
          }
        },
      });

      if (editable) {
        items.push({
          label: 'Paste',
          onClick: () => {
            focusTarget(targetRef.current);
            navigator.clipboard
              .readText()
              .then((text) => {
                if (text) {
                  document.execCommand('insertText', false, text);
                }
              })
              .catch(() => {});
          },
        });
      }

      items.push({ divider: true });

      items.push({
        label: 'Select All',
        onClick: () => {
          const el = targetRef.current;
          if (
            el instanceof HTMLInputElement ||
            el instanceof HTMLTextAreaElement
          ) {
            el.focus();
            el.select();
          } else {
            document.execCommand('selectAll');
          }
        },
      });

      setMenu({ position: { x: event.clientX, y: event.clientY }, items });
    };

    document.addEventListener('contextmenu', handleContextMenu);
    return () => document.removeEventListener('contextmenu', handleContextMenu);
  }, []);

  if (!menu) return null;

  return (
    <ContextMenu
      items={menu.items}
      position={menu.position}
      onClose={handleClose}
    />
  );
};

function focusTarget(target: Element | null): void {
  if (target instanceof HTMLElement) {
    target.focus();
  }
}

export default TextContextMenu;
