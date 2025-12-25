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
}

const KeyboardContext = createContext<KeyboardProviderValue | null>(null);

export function useKeyboardContext() {
  const context = useContext(KeyboardContext);
  if (!context) {
    throw new Error('useKeyboardContext must be used within KeyboardProvider');
  }
  return context;
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

  // Handle keyboard events
  useEffect(() => {
    if (!isEnabled || disabled) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (tabNavigation.handleKeyEvent(event)) {
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
  }, [disabled, isEnabled, matchesContext, shortcuts, tabNavigation]);

  // Handle menu events from Wails
  useEffect(() => {
    const handleMenuCopy = () => {
      const text = deriveCopyText(window.getSelection());
      if (text) {
        navigator.clipboard.writeText(text);
      }
    };

    const handleMenuSelectAll = () => {
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
  }, []);

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
  };

  return (
    <KeyboardContext.Provider value={value}>
      <SearchShortcutHandler />
      {children}
    </KeyboardContext.Provider>
  );
};
