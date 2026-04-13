/**
 * frontend/src/ui/shortcuts/hooks.ts
 *
 * Module source for hooks.
 * Implements hooks logic for the UI layer.
 */

import { useEffect, useMemo, useRef } from 'react';
import { useKeyboardContext } from './context';
import { ShortcutModifiers } from '@/types/shortcuts';

const normalizeModifiers = (modifiers?: ShortcutModifiers): ShortcutModifiers | undefined => {
  if (!modifiers) {
    return undefined;
  }

  const normalized: ShortcutModifiers = {
    ctrl: !!modifiers.ctrl,
    shift: !!modifiers.shift,
    alt: !!modifiers.alt,
    meta: !!modifiers.meta,
  };

  return normalized.ctrl || normalized.shift || normalized.alt || normalized.meta
    ? normalized
    : undefined;
};

interface UseShortcutOptions {
  key: string;
  handler: (event?: KeyboardEvent) => void | boolean;
  modifiers?: ShortcutModifiers;
  description?: string;
  category?: string;
  enabled?: boolean;
  priority?: number;
}

/**
 * Hook to register a keyboard shortcut
 *
 * @example
 * // Simple usage
 * useShortcut({
 *   key: 's',
 *   handler: () => toggleAutoScroll(),
 *   description: 'Toggle auto-scroll',
 *   priority: 20
 * });
 *
 * // With modifiers
 * useShortcut({
 *   key: 'k',
 *   modifiers: { meta: true },
 *   handler: () => openCommandPalette(),
 *   description: 'Open command palette'
 * });
 *
 * // With priority
 * useShortcut({
 *   key: 'Delete',
 *   handler: () => deleteSelected(),
 *   priority: 10,
 *   description: 'Delete selected resource'
 * });
 */
export function useShortcut(options: UseShortcutOptions) {
  const { key, handler, modifiers, description = '', category, enabled = true, priority } = options;

  const { registerShortcut, unregisterShortcut } = useKeyboardContext();
  const shortcutIdRef = useRef<string | null>(null);
  const handlerRef = useRef(handler);

  // Update handler ref when it changes
  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  const ctrl = !!modifiers?.ctrl;
  const shift = !!modifiers?.shift;
  const alt = !!modifiers?.alt;
  const meta = !!modifiers?.meta;

  const normalizedModifiers = useMemo<ShortcutModifiers | undefined>(() => {
    if (!ctrl && !shift && !alt && !meta) {
      return undefined;
    }
    return { ctrl, shift, alt, meta };
  }, [ctrl, shift, alt, meta]);

  useEffect(() => {
    const id = registerShortcut({
      key,
      modifiers: normalizedModifiers,
      priority,
      handler: (event) => handlerRef.current(event),
      description,
      category,
      enabled,
    });

    shortcutIdRef.current = id;

    return () => {
      if (shortcutIdRef.current) {
        unregisterShortcut(shortcutIdRef.current);
        shortcutIdRef.current = null;
      }
    };
  }, [
    key,
    description,
    category,
    enabled,
    registerShortcut,
    unregisterShortcut,
    normalizedModifiers,
    priority,
  ]);
}

/**
 * Hook to register multiple shortcuts at once
 *
 * @example
 * useShortcuts([
 *   { key: 'j', handler: selectNext, description: 'Select next' },
 *   { key: 'k', handler: selectPrev, description: 'Select previous' },
 *   { key: 'Enter', handler: openSelected, description: 'Open selected' },
 * ], { priority: 100 });
 */
export function useShortcuts(
  shortcuts: Array<Omit<UseShortcutOptions, 'priority'>>,
  commonOptions?: Pick<UseShortcutOptions, 'priority' | 'category' | 'enabled'>
) {
  const { registerShortcut, unregisterShortcut } = useKeyboardContext();
  const handlerRefs = useRef<Array<UseShortcutOptions['handler']>>([]);
  const shortcutIdsRef = useRef<string[]>([]);

  useEffect(() => {
    handlerRefs.current = shortcuts.map((shortcut) => shortcut.handler);
  }, [shortcuts]);

  const latestShortcutsRef = useRef(shortcuts);
  useEffect(() => {
    latestShortcutsRef.current = shortcuts;
  }, [shortcuts]);

  const latestCommonOptionsRef = useRef(commonOptions);
  useEffect(() => {
    latestCommonOptionsRef.current = commonOptions;
  }, [commonOptions]);

  const structuralSignature = useMemo(
    () =>
      JSON.stringify(
        shortcuts.map(({ handler: _handler, ...rest }) => ({
          ...rest,
        }))
      ),
    [shortcuts]
  );

  const commonSignature = useMemo(() => JSON.stringify(commonOptions ?? {}), [commonOptions]);

  useEffect(() => {
    const currentShortcuts = latestShortcutsRef.current;
    const registeredIds = currentShortcuts.map((shortcut, index) => {
      const merged = {
        description: '',
        enabled: true,
        ...latestCommonOptionsRef.current,
        ...shortcut,
      } as UseShortcutOptions;

      const normalizedModifiers = normalizeModifiers(merged.modifiers);

      return registerShortcut({
        key: merged.key,
        modifiers: normalizedModifiers,
        priority: merged.priority,
        handler: (event) => handlerRefs.current[index]?.(event),
        description: merged.description || '',
        category: merged.category,
        enabled: merged.enabled ?? true,
      });
    });

    shortcutIdsRef.current = registeredIds;

    return () => {
      registeredIds.forEach((id) => unregisterShortcut(id));
      shortcutIdsRef.current = [];
    };
  }, [structuralSignature, commonSignature, registerShortcut, unregisterShortcut]);
}
