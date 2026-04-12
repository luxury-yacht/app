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
  ShortcutContext as ShortcutContextType,
  ShortcutMap,
  ShortcutGroup,
  ShortcutModifiers,
} from '@/types/shortcuts';
import { getShortcutKey, modifiersMatch, isInputElement, resolveEventElement } from './utils';
import {
  KeyboardNavigationProvider,
  useKeyboardNavigationContext,
} from './keyboardNavigationContext';
import { EventsOn, EventsOff } from '@wailsjs/runtime/runtime';
import SearchShortcutHandler from './components/SearchShortcutHandler';

interface KeyboardProviderValue {
  // Registration
  registerShortcut: (shortcut: ShortcutDefinition) => string; // Returns shortcut ID
  unregisterShortcut: (id: string) => void;

  // Context management
  currentContext: ShortcutContextType;
  setContext: (context: Partial<ShortcutContextType>) => void;
  pushContext: (context: Partial<ShortcutContextType>) => void; // For nested contexts
  popContext: () => void;

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
  dispatchNativeAction: (action: KeyboardNativeAction) => boolean;
}

export type KeyboardNativeAction = 'copy' | 'selectAll';

export interface KeyboardSurfaceNativeActionContext {
  action: KeyboardNativeAction;
  activeElement: Element | null;
  selection: Selection | null;
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

export const shallowEqual = (a: Partial<ShortcutContextType>, b: Partial<ShortcutContextType>) => {
  const aKeys = Object.keys(a) as Array<keyof ShortcutContextType>;
  const bKeys = Object.keys(b) as Array<keyof ShortcutContextType>;

  if (aKeys.length !== bKeys.length) {
    return false;
  }

  for (const key of aKeys) {
    if (a[key] !== b[key]) {
      return false;
    }
  }

  return true;
};

export const matchesShortcutContext = (
  shortcut: RegisteredShortcut,
  currentContext: ShortcutContextType
): boolean => {
  if (!shortcut.enabled && shortcut.enabled !== undefined) return false;

  return shortcut.contexts.some((ctx) => {
    if (ctx.view === 'global') return true;
    if (ctx.view && ctx.view !== currentContext.view) return false;
    if (
      ctx.resourceKind &&
      ctx.resourceKind !== '*' &&
      ctx.resourceKind !== currentContext.resourceKind
    ) {
      return false;
    }
    if (ctx.objectKind && ctx.objectKind !== '*' && ctx.objectKind !== currentContext.objectKind) {
      return false;
    }
    if (ctx.panelOpen !== undefined && ctx.panelOpen !== currentContext.panelOpen) {
      return false;
    }
    if (ctx.tabActive !== undefined && ctx.tabActive !== currentContext.tabActive) {
      return false;
    }
    return true;
  });
};

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
        currentNode.classList?.contains('pod-logs-text') ||
        currentNode.classList?.contains('pod-logs-content')
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
  return (
    <KeyboardNavigationProvider>
      <KeyboardProviderInner disabled={disabled}>{children}</KeyboardProviderInner>
    </KeyboardNavigationProvider>
  );
}

const KeyboardProviderInner: React.FC<KeyboardProviderProps> = ({ children, disabled = false }) => {
  const [shortcuts, setShortcuts] = useState<ShortcutMap>(new Map());
  const [contextStack, setContextStack] = useState<ShortcutContextType[]>([
    { view: 'global', priority: 0 },
  ]);
  const [isEnabled, setIsEnabled] = useState(!disabled);
  const shortcutIdCounter = useRef(0);
  const surfaceIdCounter = useRef(0);
  const surfacesRef = useRef<Map<string, RegisteredKeyboardSurface>>(new Map());

  // Current context is the top of the stack merged with all below
  const currentContext = contextStack.reduce((acc, ctx) => ({ ...acc, ...ctx }), {});

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

  // Update context
  const setContext = useCallback((context: Partial<ShortcutContextType>) => {
    setContextStack((prev) => {
      const current = prev[prev.length - 1] ?? {};
      const merged = { ...current, ...context };

      if (shallowEqual(current, merged)) {
        return prev;
      }

      const stack = [...prev];
      stack[stack.length - 1] = merged;
      return stack;
    });
  }, []);

  // Push a new context layer
  const pushContext = useCallback((context: Partial<ShortcutContextType>) => {
    setContextStack((prev) => [
      ...prev,
      { ...context, priority: (context.priority || 0) + prev.length },
    ]);
  }, []);

  // Pop context layer
  const popContext = useCallback(() => {
    setContextStack((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));
  }, []);

  // Check if a shortcut matches the current context
  const matchesContext = useCallback(
    (shortcut: RegisteredShortcut) => matchesShortcutContext(shortcut, currentContext),
    [currentContext]
  );

  const tabNavigation = useKeyboardNavigationContext();

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
        const containingSurface = orderedSurfaces.find((surface) =>
          surface.rootRef.current?.contains(targetElement)
        );
        if (containingSurface) {
          return containingSurface;
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
    (action: KeyboardNativeAction): boolean => {
      const targetSurface = getTargetSurface(document.activeElement);
      if (!targetSurface?.onNativeAction) {
        return false;
      }

      return (
        targetSurface.onNativeAction({
          action,
          activeElement: document.activeElement,
          selection: window.getSelection(),
        }) === true
      );
    },
    [getTargetSurface]
  );

  // Handle keyboard events
  useEffect(() => {
    if (!isEnabled || disabled) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      const targetSurface = getTargetSurface(event.target);
      if (targetSurface) {
        const escapeResult =
          event.key === 'Escape' && targetSurface.onEscape ? targetSurface.onEscape(event) : false;
        const handledEscape = escapeResult === true || escapeResult === 'handled-no-prevent';
        const handledEscapeNoPrevent = escapeResult === 'handled-no-prevent';
        const keyResult =
          !handledEscape && targetSurface.onKeyDown ? targetSurface.onKeyDown(event) : false;
        const handledKey = keyResult === true || keyResult === 'handled-no-prevent';
        const handledKeyNoPrevent = keyResult === 'handled-no-prevent';

        if (handledEscape || handledKey) {
          if (!handledEscapeNoPrevent && !handledKeyNoPrevent) {
            event.preventDefault();
          }
          event.stopPropagation();
          return;
        }
      }

      if (tabNavigation.handleKeyEvent(event)) {
        return;
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
      const targetElement = resolveEventElement(event.target);
      if (isInputElement(event.target)) {
        const allowAttr = targetElement?.getAttribute('data-allow-shortcuts');
        if (allowAttr && allowAttr.toLowerCase() === 'false') {
          return;
        }

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
        .filter((s) => matchesContext(s) && modifiersMatch(event, s.modifiers))
        .sort((a, b) => {
          // Sort by priority (higher first)
          const aPriority = Math.max(...a.contexts.map((c) => c.priority || 0));
          const bPriority = Math.max(...b.contexts.map((c) => c.priority || 0));
          return bPriority - aPriority;
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

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [disabled, getTargetSurface, isEnabled, matchesContext, shortcuts, tabNavigation]);

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

    // Register event listeners
    EventsOn('menu:copy', handleMenuCopy);
    EventsOn('menu:selectAll', handleMenuSelectAll);

    // Cleanup
    return () => {
      EventsOff('menu:copy');
      EventsOff('menu:selectAll');
    };
  }, [dispatchNativeAction]);

  // Get available shortcuts for current context
  const getAvailableShortcuts = useCallback((): ShortcutGroup[] => {
    const groups = new Map<
      string,
      Array<{ key: string; modifiers?: ShortcutModifiers; description: string }>
    >();

    for (const shortcutList of shortcuts.values()) {
      for (const shortcut of shortcutList) {
        if (matchesContext(shortcut)) {
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
  }, [shortcuts, matchesContext]);

  // Check if a shortcut is available
  const isShortcutAvailable = useCallback(
    (key: string, modifiers?: ShortcutModifiers): boolean => {
      const shortcutKey = getShortcutKey(key, modifiers);
      const shortcutList = shortcuts.get(shortcutKey);
      return shortcutList ? shortcutList.some(matchesContext) : false;
    },
    [shortcuts, matchesContext]
  );

  const value: KeyboardProviderValue = {
    registerShortcut,
    unregisterShortcut,
    currentContext,
    setContext,
    pushContext,
    popContext,
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
