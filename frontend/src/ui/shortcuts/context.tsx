/**
 * frontend/src/ui/shortcuts/context.tsx
 *
 * Module source for context.
 * Implements context logic for the UI layer.
 */

import { EventsOff, EventsOn } from '@wailsjs/runtime/runtime';
import type React from 'react';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type {
  RegisteredShortcut,
  ShortcutDefinition,
  ShortcutGroup,
  ShortcutMap,
  ShortcutModifiers,
} from '@/types/shortcuts';
import { isMacPlatform } from '@/utils/platform';
import { focusRegisteredSearchShortcutTarget } from './searchShortcutRegistry';
import { getShortcutKey, isInputElement, modifiersMatch, resolveEventElement } from './utils';

interface KeyboardProviderValue {
  // Registration
  registerShortcut: (shortcut: ShortcutDefinition) => string; // Returns shortcut ID
  unregisterShortcut: (id: string) => void;

  // Help and discovery
  getAvailableShortcuts: () => ShortcutGroup[];
  isShortcutAvailable: (key: string, modifiers?: ShortcutModifiers) => boolean;

  // Control
  setEnabled: (enabled: boolean) => void; // Global enable/disable
  isEnabled: boolean;

  // Surface registration
  registerSurface: (surface: KeyboardSurfaceOptions) => string;
  unregisterSurface: (id: string) => void;
  updateSurface: (id: string, surface: Partial<KeyboardSurfaceOptions>) => void;
  hasActiveBlockingSurface: () => boolean;

  // Native action bridge
  dispatchNativeAction: (action: KeyboardNativeAction, text?: string) => boolean;
}

export type KeyboardNativeAction = 'copy' | 'cut' | 'selectAll' | 'paste';

export interface KeyboardSurfaceNativeActionContext {
  action: KeyboardNativeAction;
  activeElement: Element | null;
  selection: Selection | null;
  text?: string;
}

export type KeyboardSurfaceKeyResult = boolean | 'handled-no-prevent' | undefined;

export interface KeyboardSurfaceOptions {
  kind: 'modal' | 'palette' | 'menu' | 'dropdown' | 'panel' | 'region' | 'editor';
  rootRef: React.RefObject<HTMLElement | null>;
  active?: boolean;
  priority?: number;
  blocking?: boolean;
  captureWhenActive?: boolean;
  suppressShortcuts?: boolean;
  onKeyDown?: (event: KeyboardEvent) => KeyboardSurfaceKeyResult;
  onEscape?: (event: KeyboardEvent) => KeyboardSurfaceKeyResult;
  onNativeAction?: (context: KeyboardSurfaceNativeActionContext) => boolean | undefined;
}

interface RegisteredKeyboardSurface extends KeyboardSurfaceOptions {
  id: string;
  active: boolean;
  priority: number;
  blocking: boolean;
  captureWhenActive: boolean;
  suppressShortcuts: boolean;
  registeredAt: number;
}

const KeyboardContext = createContext<KeyboardProviderValue | null>(null);

const getSurfaceContainmentDepth = (target: Element, root: HTMLElement | null): number => {
  if (!root) {
    return Number.POSITIVE_INFINITY;
  }

  let depth = 0;
  let current: Element | null = target;
  while (current) {
    if (current === root) {
      return depth;
    }
    current = current.parentElement;
    depth += 1;
  }

  return Number.POSITIVE_INFINITY;
};

export function useKeyboardContext() {
  const context = useContext(KeyboardContext);
  if (!context) {
    throw new Error('useKeyboardContext must be used within KeyboardProvider');
  }
  return context;
}

export function useOptionalKeyboardContext() {
  return useContext(KeyboardContext);
}

interface KeyboardProviderProps {
  children: React.ReactNode;
  disabled?: boolean; // Disable all shortcuts (e.g., when modal is open)
}

const YAML_COPY_CLASSES = ['yaml-pre', 'yaml-content'] as const;
const LOG_COPY_CLASSES = ['logs-viewer-text', 'logs-viewer-content'] as const;

const hasAnyClass = (element: Element, classNames: readonly string[]) =>
  classNames.some((className) => element.classList.contains(className));

const findCopySurface = (anchorNode: Node | null): 'yaml' | 'logs' | null => {
  let currentNode = anchorNode;
  while (currentNode && currentNode !== document.body) {
    if (currentNode instanceof Element) {
      if (hasAnyClass(currentNode, YAML_COPY_CLASSES)) {
        return 'yaml';
      }
      if (hasAnyClass(currentNode, LOG_COPY_CLASSES)) {
        return 'logs';
      }
    }
    currentNode = currentNode.parentNode;
  }
  return null;
};

export const deriveCopyText = (selection: Selection | null): string | null => {
  if (!selection || selection.isCollapsed) {
    return null;
  }

  const selectedText = selection.toString();
  if (!selectedText) {
    return null;
  }
  return findCopySurface(selection.anchorNode) === 'yaml'
    ? selectedText.replace(/^[ \t]*\d+[ \t]*/gm, '')
    : selectedText;
};

export const applySelectAll = (selection: Selection | null, activeElement: Element | null) => {
  if (!selection) {
    return;
  }

  if (activeElement && activeElement !== document.body) {
    selection.removeAllRanges();
    const range = document.createRange();
    range.selectNodeContents(activeElement);
    selection.addRange(range);
  } else if (typeof document.execCommand === 'function') {
    document.execCommand('selectAll');
  }
};

type TextEntryElement = HTMLInputElement | HTMLTextAreaElement;

const isTextEntryElement = (element: Element | null): element is TextEntryElement =>
  element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement;

const cutTextEntrySelection = (element: TextEntryElement): boolean => {
  if (element.readOnly || element.disabled) {
    return false;
  }
  const start = element.selectionStart;
  const end = element.selectionEnd;
  if (start === null || end === null || start === end) {
    return false;
  }
  void navigator.clipboard.writeText(element.value.slice(start, end));
  element.setRangeText('', start, end, 'end');
  element.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
};

const cutContentEditableSelection = (): boolean => {
  const text = deriveCopyText(window.getSelection());
  if (!text) {
    return false;
  }
  void navigator.clipboard.writeText(text);
  return typeof document.execCommand === 'function' ? document.execCommand('delete') : false;
};

const pasteIntoTextEntry = (element: TextEntryElement, text: string): boolean => {
  if (element.readOnly || element.disabled) {
    return false;
  }
  const start = element.selectionStart ?? element.value.length;
  const end = element.selectionEnd ?? start;
  element.setRangeText(text, start, end, 'end');
  element.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
};

const pasteIntoContentEditable = (text: string): boolean =>
  typeof document.execCommand === 'function'
    ? document.execCommand('insertText', false, text)
    : false;

const isHandledSurfaceResult = (result: KeyboardSurfaceKeyResult) =>
  result === true || result === 'handled-no-prevent';

const claimKeyboardEvent = (event: KeyboardEvent, result: KeyboardSurfaceKeyResult): boolean => {
  if (!isHandledSurfaceResult(result)) {
    return false;
  }
  if (result !== 'handled-no-prevent') {
    event.preventDefault();
  }
  event.stopPropagation();
  return true;
};

const dispatchSurfaceHandler = (
  event: KeyboardEvent,
  handler: ((event: KeyboardEvent) => KeyboardSurfaceKeyResult) | undefined
) => claimKeyboardEvent(event, handler?.(event));

const dispatchKeyThroughSurfaces = (
  event: KeyboardEvent,
  surfaces: RegisteredKeyboardSurface[]
): boolean => {
  for (const surface of surfaces) {
    if (dispatchSurfaceHandler(event, surface.onKeyDown)) {
      return true;
    }
  }
  return false;
};

const dispatchEscapeThroughSurfaces = (
  event: KeyboardEvent,
  surfaces: RegisteredKeyboardSurface[]
): boolean => {
  for (const surface of surfaces) {
    if (dispatchSurfaceHandler(event, surface.onEscape)) {
      return true;
    }
    if (dispatchSurfaceHandler(event, surface.onKeyDown)) {
      return true;
    }
    if (surface.suppressShortcuts) {
      return true;
    }
  }
  return false;
};

const STANDARD_EDIT_KEYS = new Set(['a', 'c', 'v', 'x']);

const isUnmodifiedStandardEditKey = (event: KeyboardEvent): boolean =>
  (event.metaKey || event.ctrlKey) &&
  !event.shiftKey &&
  !event.altKey &&
  STANDARD_EDIT_KEYS.has(event.key.toLowerCase());

const hasAnyShortcutModifier = (event: KeyboardEvent) =>
  event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;

const shouldDeferToNativeEditing = (event: KeyboardEvent): boolean => {
  if (isUnmodifiedStandardEditKey(event)) {
    return true;
  }
  return isInputElement(event.target) && !hasAnyShortcutModifier(event);
};

const findHighestPriorityShortcut = (
  event: KeyboardEvent,
  shortcuts: ShortcutMap
): RegisteredShortcut | null => {
  const shortcutKey = getShortcutKey(event.key, {
    ctrl: event.ctrlKey,
    shift: event.shiftKey,
    alt: event.altKey,
    meta: event.metaKey,
  });
  const candidates = shortcuts.get(shortcutKey);
  if (!candidates) {
    return null;
  }
  return (
    candidates
      .filter((shortcut) => shortcut.enabled !== false && modifiersMatch(event, shortcut.modifiers))
      .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))[0] ?? null
  );
};

const dispatchRegisteredShortcut = (event: KeyboardEvent, shortcuts: ShortcutMap) => {
  const shortcut = findHighestPriorityShortcut(event, shortcuts);
  if (!shortcut) {
    return;
  }
  const result = shortcut.handler(event);
  if (result !== false) {
    event.preventDefault();
    event.stopPropagation();
  }
};

interface KeyboardEventRoutingContext {
  getTargetSurface: (target: EventTarget | null) => RegisteredKeyboardSurface | null;
  getSurfaceCandidates: (target: EventTarget | null) => RegisteredKeyboardSurface[];
  shortcuts: ShortcutMap;
}

const routeEscapeKey = (event: KeyboardEvent, context: KeyboardEventRoutingContext): boolean => {
  if (event.key !== 'Escape') {
    return false;
  }
  return dispatchEscapeThroughSurfaces(event, context.getSurfaceCandidates(event.target));
};

const routeTargetSurfaceKey = (
  event: KeyboardEvent,
  targetSurface: RegisteredKeyboardSurface | null
): boolean => {
  if (event.key === 'Escape') {
    return false;
  }
  return dispatchSurfaceHandler(event, targetSurface?.onKeyDown);
};

const routeKeyboardEvent = (event: KeyboardEvent, context: KeyboardEventRoutingContext) => {
  if (event.key === 'Tab') {
    return;
  }
  const targetSurface = context.getTargetSurface(event.target);
  if (routeEscapeKey(event, context)) {
    return;
  }
  if (routeTargetSurfaceKey(event, targetSurface)) {
    return;
  }
  if (targetSurface?.suppressShortcuts) {
    return;
  }
  if (shouldDeferToNativeEditing(event)) {
    return;
  }
  dispatchRegisteredShortcut(event, context.shortcuts);
};

export function KeyboardProvider({ children, disabled = false }: KeyboardProviderProps) {
  return <KeyboardProviderInner disabled={disabled}>{children}</KeyboardProviderInner>;
}

const KeyboardProviderInner: React.FC<KeyboardProviderProps> = ({ children, disabled = false }) => {
  const [shortcuts, setShortcuts] = useState<ShortcutMap>(new Map());
  const [isEnabled, setIsEnabled] = useState(!disabled);
  const shortcutIdCounter = useRef(0);
  const surfaceIdCounter = useRef(0);
  const surfacesRef = useRef<Map<string, RegisteredKeyboardSurface>>(new Map());

  // Register a shortcut
  const registerShortcut = useCallback((shortcut: ShortcutDefinition): string => {
    const id = `shortcut-${++shortcutIdCounter.current}`;
    const registered: RegisteredShortcut = { ...shortcut, id };

    setShortcuts((prev) => {
      const next = new Map(prev);
      const key = getShortcutKey(shortcut.key, shortcut.modifiers);
      const existing = next.get(key) || [];
      next.set(key, [...existing, registered]);
      return next;
    });

    return id;
  }, []);

  // Unregister a shortcut
  const unregisterShortcut = useCallback((id: string) => {
    setShortcuts((prev) => {
      const next = new Map(prev);
      for (const [key, registeredShortcuts] of next.entries()) {
        const filtered = registeredShortcuts.filter((s) => s.id !== id);
        if (filtered.length === 0) {
          next.delete(key);
        } else {
          next.set(key, filtered);
        }
      }
      return next;
    });
  }, []);

  useEffect(() => {
    const id = registerShortcut({
      key: 'f',
      modifiers: isMacPlatform() ? { meta: true } : { ctrl: true },
      handler: () => Boolean(focusRegisteredSearchShortcutTarget()),
      description: 'Focus active search',
      category: 'Global',
      priority: 1000,
    });
    return () => unregisterShortcut(id);
  }, [registerShortcut, unregisterShortcut]);

  const getOrderedSurfaces = useCallback((): RegisteredKeyboardSurface[] => {
    return Array.from(surfacesRef.current.values())
      .filter((surface) => surface.active && surface.rootRef.current)
      .sort((a, b) => {
        if (a.blocking !== b.blocking) {
          return Number(b.blocking) - Number(a.blocking);
        }
        if (a.captureWhenActive !== b.captureWhenActive) {
          return Number(b.captureWhenActive) - Number(a.captureWhenActive);
        }
        if (a.priority !== b.priority) {
          return b.priority - a.priority;
        }
        return b.registeredAt - a.registeredAt;
      });
  }, []);

  const getTargetSurface = useCallback(
    (target: EventTarget | null): RegisteredKeyboardSurface | null => {
      const targetElement = resolveEventElement(target);
      const orderedSurfaces = getOrderedSurfaces();

      if (targetElement) {
        const containingSurfaces = orderedSurfaces.filter((surface) =>
          surface.rootRef.current?.contains(targetElement)
        );
        if (containingSurfaces.length > 0) {
          return containingSurfaces.sort((a, b) => {
            const depthDiff =
              getSurfaceContainmentDepth(targetElement, a.rootRef.current) -
              getSurfaceContainmentDepth(targetElement, b.rootRef.current);
            if (depthDiff !== 0) {
              return depthDiff;
            }
            return orderedSurfaces.indexOf(a) - orderedSurfaces.indexOf(b);
          })[0];
        }
      }

      return (
        orderedSurfaces.find((surface) => surface.blocking) ??
        orderedSurfaces.find((surface) => surface.captureWhenActive) ??
        null
      );
    },
    [getOrderedSurfaces]
  );

  const getSurfaceCandidates = useCallback(
    (target: EventTarget | null): RegisteredKeyboardSurface[] => {
      const targetElement = resolveEventElement(target);
      const orderedSurfaces = getOrderedSurfaces();

      if (targetElement) {
        const containingSurfaces = orderedSurfaces.filter((surface) =>
          surface.rootRef.current?.contains(targetElement)
        );
        if (containingSurfaces.length > 0) {
          const sortedContainingSurfaces = containingSurfaces.sort((a, b) => {
            const depthDiff =
              getSurfaceContainmentDepth(targetElement, a.rootRef.current) -
              getSurfaceContainmentDepth(targetElement, b.rootRef.current);
            if (depthDiff !== 0) {
              return depthDiff;
            }
            return orderedSurfaces.indexOf(a) - orderedSurfaces.indexOf(b);
          });

          return sortedContainingSurfaces;
        }
      }

      const blockingSurfaces = orderedSurfaces.filter((surface) => surface.blocking);
      if (blockingSurfaces.length > 0) {
        return blockingSurfaces;
      }

      return orderedSurfaces.filter((surface) => surface.captureWhenActive);
    },
    [getOrderedSurfaces]
  );

  const registerSurface = useCallback((surface: KeyboardSurfaceOptions): string => {
    const id = `surface-${++surfaceIdCounter.current}`;
    surfacesRef.current.set(id, {
      ...surface,
      id,
      active: surface.active ?? true,
      priority: surface.priority ?? 0,
      blocking: surface.blocking ?? false,
      captureWhenActive: surface.captureWhenActive ?? false,
      suppressShortcuts: surface.suppressShortcuts ?? false,
      registeredAt: surfaceIdCounter.current,
    });
    return id;
  }, []);

  const unregisterSurface = useCallback((id: string) => {
    surfacesRef.current.delete(id);
  }, []);

  const updateSurface = useCallback((id: string, surface: Partial<KeyboardSurfaceOptions>) => {
    const existing = surfacesRef.current.get(id);
    if (!existing) {
      return;
    }
    surfacesRef.current.set(id, {
      ...existing,
      ...surface,
      active: surface.active ?? existing.active,
      priority: surface.priority ?? existing.priority,
      blocking: surface.blocking ?? existing.blocking,
      captureWhenActive: surface.captureWhenActive ?? existing.captureWhenActive,
      suppressShortcuts: surface.suppressShortcuts ?? existing.suppressShortcuts,
    });
  }, []);

  const hasActiveBlockingSurface = useCallback(
    () => getOrderedSurfaces().some((surface) => surface.blocking),
    [getOrderedSurfaces]
  );

  const dispatchNativeAction = useCallback(
    (action: KeyboardNativeAction, text?: string): boolean => {
      const targetSurface = getTargetSurface(document.activeElement);
      if (!targetSurface?.onNativeAction) {
        return false;
      }

      return (
        targetSurface.onNativeAction({
          action,
          activeElement: document.activeElement,
          selection: window.getSelection(),
          text,
        }) === true
      );
    },
    [getTargetSurface]
  );

  const applyNativeCutFallback = useCallback((): boolean => {
    const activeElement = document.activeElement;
    if (isTextEntryElement(activeElement)) {
      return cutTextEntrySelection(activeElement);
    }
    if (activeElement instanceof HTMLElement && activeElement.isContentEditable) {
      return cutContentEditableSelection();
    }
    return false;
  }, []);

  const applyNativePasteFallback = useCallback((text: string): boolean => {
    const activeElement = document.activeElement;
    if (isTextEntryElement(activeElement)) {
      return pasteIntoTextEntry(activeElement, text);
    }
    if (activeElement instanceof HTMLElement && activeElement.isContentEditable) {
      return pasteIntoContentEditable(text);
    }
    return false;
  }, []);

  // Handle keyboard events
  useEffect(() => {
    if (!isEnabled || disabled) {
      return;
    }

    const handleCapturedTabKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Tab') {
        dispatchKeyThroughSurfaces(event, getSurfaceCandidates(event.target));
      }
    };

    const handleKeyDown = (event: KeyboardEvent) =>
      routeKeyboardEvent(event, { getTargetSurface, getSurfaceCandidates, shortcuts });

    document.addEventListener('keydown', handleCapturedTabKeyDown, true);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleCapturedTabKeyDown, true);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [disabled, getSurfaceCandidates, getTargetSurface, isEnabled, shortcuts]);

  // Handle menu events from Wails
  useEffect(() => {
    const handleMenuCopy = () => {
      if (dispatchNativeAction('copy')) {
        return;
      }
      const text = deriveCopyText(window.getSelection());
      if (text) {
        navigator.clipboard.writeText(text);
      }
    };

    const handleMenuCut = () => {
      if (dispatchNativeAction('cut')) {
        return;
      }
      applyNativeCutFallback();
    };

    const handleMenuSelectAll = () => {
      if (dispatchNativeAction('selectAll')) {
        return;
      }
      applySelectAll(window.getSelection(), document.activeElement as Element | null);
    };

    const handleMenuPaste = (text?: string) => {
      const content = typeof text === 'string' ? text : '';
      if (dispatchNativeAction('paste', content)) {
        return;
      }
      applyNativePasteFallback(content);
    };

    // Register event listeners
    EventsOn('menu:cut', handleMenuCut);
    EventsOn('menu:copy', handleMenuCopy);
    EventsOn('menu:paste', handleMenuPaste);
    EventsOn('menu:selectAll', handleMenuSelectAll);

    // Cleanup
    return () => {
      EventsOff('menu:cut');
      EventsOff('menu:copy');
      EventsOff('menu:paste');
      EventsOff('menu:selectAll');
    };
  }, [applyNativeCutFallback, applyNativePasteFallback, dispatchNativeAction]);

  // Get available shortcuts for current context
  const getAvailableShortcuts = useCallback((): ShortcutGroup[] => {
    const groups = new Map<
      string,
      Array<{ key: string; modifiers?: ShortcutModifiers; description: string }>
    >();

    for (const shortcutList of shortcuts.values()) {
      for (const shortcut of shortcutList) {
        if (shortcut.enabled || shortcut.enabled === undefined) {
          const category = shortcut.category || 'General';
          const existing = groups.get(category) || [];
          existing.push({
            key: shortcut.key,
            modifiers: shortcut.modifiers,
            description: shortcut.description,
          });
          groups.set(category, existing);
        }
      }
    }

    return Array.from(groups.entries()).map(([category, categoryShortcuts]) => ({
      category,
      shortcuts: categoryShortcuts.sort((a, b) => a.key.localeCompare(b.key)),
    }));
  }, [shortcuts]);

  // Check if a shortcut is available
  const isShortcutAvailable = useCallback(
    (key: string, modifiers?: ShortcutModifiers): boolean => {
      const shortcutKey = getShortcutKey(key, modifiers);
      const shortcutList = shortcuts.get(shortcutKey);
      return shortcutList
        ? shortcutList.some((shortcut) => shortcut.enabled || shortcut.enabled === undefined)
        : false;
    },
    [shortcuts]
  );

  const value: KeyboardProviderValue = {
    registerShortcut,
    unregisterShortcut,
    getAvailableShortcuts,
    isShortcutAvailable,
    setEnabled: setIsEnabled,
    isEnabled: isEnabled && !disabled,
    registerSurface,
    unregisterSurface,
    updateSurface,
    hasActiveBlockingSurface,
    dispatchNativeAction,
  };

  return <KeyboardContext.Provider value={value}>{children}</KeyboardContext.Provider>;
};
