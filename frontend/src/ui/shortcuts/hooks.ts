/**
 * frontend/src/ui/shortcuts/hooks.ts
 *
 * Module source for hooks.
 * Implements hooks logic for the UI layer.
 */

import { useEffect, useMemo, useRef } from 'react';
import { useKeyboardContext } from './context';
import {
  ShortcutModifiers,
  ShortcutContext,
  ViewContext,
  ResourceContext,
} from '@/types/shortcuts';

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

const buildContexts = (
  providedContexts: ShortcutContext[] | undefined,
  view: ViewContext | undefined,
  resourceKind: ResourceContext | undefined,
  objectKind: string | undefined,
  whenPanelOpen: 'object' | 'logs' | 'settings' | undefined,
  whenTabActive: string | undefined,
  priority: number | undefined
): ShortcutContext[] => {
  if (providedContexts && providedContexts.length > 0) {
    return providedContexts;
  }

  const context: ShortcutContext = {};

  if (view !== undefined) context.view = view;
  if (resourceKind !== undefined) context.resourceKind = resourceKind;
  if (objectKind !== undefined) context.objectKind = objectKind;
  if (whenPanelOpen !== undefined) context.panelOpen = whenPanelOpen;
  if (whenTabActive !== undefined) context.tabActive = whenTabActive;
  if (priority !== undefined) context.priority = priority;

  if (Object.keys(context).length === 0) {
    context.view = 'global';
  }

  return [context];
};

interface UseShortcutOptions {
  key: string;
  handler: (event?: KeyboardEvent) => void | boolean;
  modifiers?: ShortcutModifiers;
  contexts?: ShortcutContext[];
  description?: string;
  category?: string;
  enabled?: boolean;
  // Convenience props for common contexts
  view?: ViewContext;
  resourceKind?: ResourceContext;
  objectKind?: string;
  whenPanelOpen?: 'object' | 'logs' | 'settings';
  whenTabActive?: string;
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
 *   view: 'logs'
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
 * // Multiple contexts
 * useShortcut({
 *   key: 'Delete',
 *   handler: () => deleteSelected(),
 *   contexts: [
 *     { view: 'list', resourceKind: 'pods' },
 *     { view: 'list', resourceKind: 'deployments' }
 *   ],
 *   description: 'Delete selected resource'
 * });
 */
export function useShortcut(options: UseShortcutOptions) {
  const {
    key,
    handler,
    modifiers,
    contexts: providedContexts,
    description = '',
    category,
    enabled = true,
    view,
    resourceKind: resourceKind,
    objectKind,
    whenPanelOpen,
    whenTabActive,
    priority,
  } = options;

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

  const resolvedContexts = useMemo(
    () =>
      buildContexts(
        providedContexts,
        view,
        resourceKind,
        objectKind,
        whenPanelOpen,
        whenTabActive,
        priority
      ),
    [providedContexts, view, resourceKind, objectKind, whenPanelOpen, whenTabActive, priority]
  );

  useEffect(() => {
    const id = registerShortcut({
      key,
      modifiers: normalizedModifiers,
      contexts: resolvedContexts,
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
    resolvedContexts,
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
 * ], { view: 'list' });
 */
export function useShortcuts(
  shortcuts: Array<
    Omit<
      UseShortcutOptions,
      'view' | 'resourceKind' | 'objectKind' | 'whenPanelOpen' | 'whenTabActive' | 'priority'
    >
  >,
  commonOptions?: Pick<
    UseShortcutOptions,
    | 'view'
    | 'resourceKind'
    | 'objectKind'
    | 'whenPanelOpen'
    | 'whenTabActive'
    | 'priority'
    | 'category'
  >
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
      const contexts = buildContexts(
        merged.contexts,
        merged.view,
        merged.resourceKind,
        merged.objectKind,
        merged.whenPanelOpen,
        merged.whenTabActive,
        merged.priority
      );

      return registerShortcut({
        key: merged.key,
        modifiers: normalizedModifiers,
        contexts,
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
