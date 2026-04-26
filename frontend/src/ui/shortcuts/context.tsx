/**
 * frontend/src/ui/shortcuts/context.tsx
 *
 * Module source for context.
 * Implements context logic for the UI layer.
 */

import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import {
  ShortcutDefinition,
  RegisteredShortcut,
  ShortcutMap,
  ShortcutGroup,
  ShortcutModifiers,
} from '@/types/shortcuts';
import { getShortcutKey, modifiersMatch, isInputElement, resolveEventElement } from './utils';
import { EventsOn, EventsOff } from '@wailsjs/runtime/runtime';
import SearchShortcutHandler from './components/SearchShortcutHandler';

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

export type KeyboardNativeAction = 'copy' | 'selectAll' | 'paste';

export interface KeyboardSurfaceNativeActionContext {
  action: KeyboardNativeAction;
  activeElement: Element | null;
  selection: Selection | null;
  text?: string;
}

export type KeyboardSurfaceKeyResult = boolean | 'handled-no-prevent' | void;

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
  onNativeAction?: (context: KeyboardSurfaceNativeActionContext) => boolean | void;
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

export const deriveCopyText = (selection: Selection | null): string | null => {
  if (!selection || selection.isCollapsed) {
    return null;
  }

  const selectedText = selection.toString();
  if (!selectedText) {
    return null;
  }

  let currentNode: Node | null = selection.anchorNode;
  let isYamlContent = false;

  while (currentNode && currentNode !== document.body) {
    if (currentNode instanceof Element) {
      if (
        currentNode.classList?.contains('yaml-pre') ||
        currentNode.classList?.contains('yaml-content')
      ) {
        isYamlContent = true;
        break;
      }
      if (
        currentNode.classList?.contains('logs-viewer-text') ||
        currentNode.classList?.contains('logs-viewer-content')
      ) {
        break;
      }
    }
    currentNode = currentNode.parentNode;
  }

  return isYamlContent ? selectedText.replace(/^[ \t]*\d+[ \t]*/gm, '') : selectedText;
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
      for (const [key, shortcuts] of next.entries()) {
        const filtered = shortcuts.filter((s) => s.id !== id);
        if (filtered.length === 0) {
          next.delete(key);
        } else {
          next.set(key, filtered);
        }
      }
      return next;
    });
  }, []);

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

      const fallbackSurface =
        orderedSurfaces.find((surface) => surface.blocking) ??
        orderedSurfaces.find((surface) => surface.captureWhenActive);

      return fallbackSurface ? [fallbackSurface] : [];
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

  const applyNativePasteFallback = useCallback((text: string): boolean => {
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLInputElement || activeElement instanceof HTMLTextAreaElement) {
      if (activeElement.readOnly || activeElement.disabled) {
        return false;
      }
      const start = activeElement.selectionStart ?? activeElement.value.length;
      const end = activeElement.selectionEnd ?? start;
      activeElement.setRangeText(text, start, end, 'end');
      activeElement.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    }

    if (activeElement instanceof HTMLElement && activeElement.isContentEditable) {
      if (typeof document.execCommand === 'function') {
        return document.execCommand('insertText', false, text);
      }
    }

    return false;
  }, []);

  // Handle keyboard events
  useEffect(() => {
    if (!isEnabled || disabled) return;

    const handleCapturedTabKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') {
        return;
      }

      for (const surface of getSurfaceCandidates(event.target)) {
        if (!surface.onKeyDown) {
          continue;
        }

        const keyResult = surface.onKeyDown(event);
        const handledKey = keyResult === true || keyResult === 'handled-no-prevent';
        const handledKeyNoPrevent = keyResult === 'handled-no-prevent';

        if (!handledKey) {
          continue;
        }

        if (!handledKeyNoPrevent) {
          event.preventDefault();
        }
        event.stopPropagation();
        return;
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Tab') {
        return;
      }

      const targetSurface = getTargetSurface(event.target);
      if (event.key === 'Escape') {
        for (const surface of getSurfaceCandidates(event.target)) {
          if (surface.onEscape) {
            const escapeResult = surface.onEscape(event);
            const handledEscape = escapeResult === true || escapeResult === 'handled-no-prevent';
            const handledEscapeNoPrevent = escapeResult === 'handled-no-prevent';

            if (handledEscape) {
              if (!handledEscapeNoPrevent) {
                event.preventDefault();
              }
              event.stopPropagation();
              return;
            }
          }

          if (surface.suppressShortcuts) {
            return;
          }
        }
      }

      if (targetSurface) {
        const keyResult = targetSurface.onKeyDown ? targetSurface.onKeyDown(event) : false;
        const handledKey = keyResult === true || keyResult === 'handled-no-prevent';
        const handledKeyNoPrevent = keyResult === 'handled-no-prevent';

        if (handledKey) {
          if (!handledKeyNoPrevent) {
            event.preventDefault();
          }
          event.stopPropagation();
          return;
        }
      }

      if (targetSurface?.suppressShortcuts) {
        return;
      }

      const key = event.key;
      const keyLower = key.toLowerCase();
      const hasCtrlOrMeta = event.metaKey || event.ctrlKey;
      const hasAnyModifier = hasCtrlOrMeta || event.shiftKey || event.altKey;
      const isStandardEditKey =
        keyLower === 'c' || keyLower === 'x' || keyLower === 'v' || keyLower === 'a';

      if (hasCtrlOrMeta && !event.shiftKey && !event.altKey && isStandardEditKey) {
        return;
      }

      // Ignore if user is typing in an input field
      if (isInputElement(event.target)) {
        if (!hasAnyModifier) {
          return;
        }
      }

      const shortcutKey = getShortcutKey(event.key, {
        ctrl: event.ctrlKey,
        shift: event.shiftKey,
        alt: event.altKey,
        meta: event.metaKey,
      });

      const matchingShortcuts = shortcuts.get(shortcutKey);
      if (!matchingShortcuts || matchingShortcuts.length === 0) {
        return;
      }

      // Find matching shortcuts for current context
      const matching = matchingShortcuts
        .filter((s) => (s.enabled || s.enabled === undefined) && modifiersMatch(event, s.modifiers))
        .sort((a, b) => {
          return (b.priority ?? 0) - (a.priority ?? 0);
        });

      if (matching.length > 0) {
        // Execute the highest priority matching shortcut
        const result = matching[0].handler(event);
        if (result !== false) {
          event.preventDefault();
          event.stopPropagation();
        }
      }
    };

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
    EventsOn('menu:copy', handleMenuCopy);
    EventsOn('menu:paste', handleMenuPaste);
    EventsOn('menu:selectAll', handleMenuSelectAll);

    // Cleanup
    return () => {
      EventsOff('menu:copy');
      EventsOff('menu:paste');
      EventsOff('menu:selectAll');
    };
  }, [applyNativePasteFallback, dispatchNativeAction]);

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

    return Array.from(groups.entries()).map(([category, shortcuts]) => ({
      category,
      shortcuts: shortcuts.sort((a, b) => a.key.localeCompare(b.key)),
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

  return (
    <KeyboardContext.Provider value={value}>
      <SearchShortcutHandler />
      {children}
    </KeyboardContext.Provider>
  );
};
