import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useEffect,
  type RefObject,
} from 'react';
import { resolveEventElement, isInputElement } from '@ui/shortcuts/utils';

type TabDirection = 'forward' | 'backward';
type KeyboardNavigationResult = 'handled' | 'bubble' | 'native' | void;

interface TabNavigateArgs {
  direction: TabDirection;
  event: KeyboardEvent;
}

interface TabEnterArgs {
  direction: TabDirection;
  event?: KeyboardEvent;
}

interface TabScopeOptions {
  ref: RefObject<HTMLElement | null>;
  priority?: number;
  onNavigate?: (args: TabNavigateArgs) => KeyboardNavigationResult;
  onEnter?: (args: TabEnterArgs) => void;
  allowNativeSelector?: string;
  disabled?: boolean;
}

interface KeyboardNavigationContextValue {
  registerScope: (options: TabScopeOptions) => string;
  unregisterScope: (id: string) => void;
  updateScope: (id: string, options: Partial<TabScopeOptions>) => void;
  handleKeyEvent: (event: KeyboardEvent) => boolean;
}

interface InternalScope extends TabScopeOptions {
  id: string;
  priority: number;
  registeredAt: number;
}

const KeyboardNavigationContext = createContext<KeyboardNavigationContextValue | null>(null);

export const useKeyboardNavigationContext = () => {
  const ctx = useContext(KeyboardNavigationContext);
  if (!ctx) {
    throw new Error('useKeyboardNavigationContext must be used within KeyboardNavigationProvider');
  }
  return ctx;
};

let scopeCounter = 0;

export const KeyboardNavigationProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const scopesRef = useRef<Map<string, InternalScope>>(new Map());
  const activeScopeIdRef = useRef<string | null>(null);

  const setScope = useCallback((id: string, scope: InternalScope | null) => {
    if (scope) {
      scopesRef.current.set(id, scope);
    } else {
      scopesRef.current.delete(id);
      if (activeScopeIdRef.current === id) {
        activeScopeIdRef.current = null;
      }
    }
  }, []);

  const registerScope = useCallback(
    (options: TabScopeOptions): string => {
      const id = `tab-scope-${++scopeCounter}`;
      const scope: InternalScope = {
        ...options,
        id,
        priority: options.priority ?? 0,
        registeredAt: performance.now(),
      };
      setScope(id, scope);
      return id;
    },
    [setScope]
  );

  const unregisterScope = useCallback(
    (id: string) => {
      setScope(id, null);
    },
    [setScope]
  );

  const updateScope = useCallback((id: string, options: Partial<TabScopeOptions>) => {
    const existing = scopesRef.current.get(id);
    if (!existing) {
      return;
    }
    const updated: InternalScope = {
      ...existing,
      ...options,
      priority: options.priority ?? existing.priority,
    };
    scopesRef.current.set(id, updated);
  }, []);

  const getOrderedScopes = useCallback((): InternalScope[] => {
    const scopes = Array.from(scopesRef.current.values()).filter(
      (scope) => !scope.disabled && scope.ref.current
    );
    return scopes.sort((a, b) => {
      if (a.priority !== b.priority) {
        return b.priority - a.priority;
      }
      return a.registeredAt - b.registeredAt;
    });
  }, []);

  const findScopeForElement = useCallback(
    (element: Element | null): InternalScope | null => {
      if (!element) {
        return null;
      }
      const scopes = getOrderedScopes();
      const ancestors = new Set<Element>();
      let current: Element | null = element;
      while (current) {
        ancestors.add(current);
        current = current.parentElement;
      }
      for (const scope of scopes) {
        const scopeElement = scope.ref.current;
        if (scopeElement && ancestors.has(scopeElement)) {
          return scope;
        }
      }
      return null;
    },
    [getOrderedScopes]
  );

  const shouldAllowNativeTab = useCallback((element: Element | null): boolean => {
    if (!element) {
      return false;
    }
    if (element.closest('[data-tab-native="true"]')) {
      return true;
    }
    return isInputElement(element);
  }, []);

  const focusScope = useCallback(
    (scope: InternalScope, direction: TabDirection, event?: KeyboardEvent): boolean => {
      activeScopeIdRef.current = scope.id;
      if (scope.onEnter) {
        scope.onEnter({ direction, event });
        return true;
      }
      const el = scope.ref.current;
      if (el && typeof el.focus === 'function') {
        el.focus();
        return true;
      }
      return false;
    },
    []
  );

  const focusNextScope = useCallback(
    (currentId: string | null, direction: TabDirection, event: KeyboardEvent): boolean => {
      const scopes = getOrderedScopes();
      if (scopes.length === 0) {
        return false;
      }
      const currentIndex = currentId ? scopes.findIndex((scope) => scope.id === currentId) : -1;

      if (direction === 'forward') {
        const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % scopes.length;
        const nextScope = scopes[nextIndex];
        return focusScope(nextScope, direction, event);
      }

      const startIndex = currentIndex === -1 ? scopes.length : currentIndex;
      const nextIndex = (startIndex - 1 + scopes.length) % scopes.length;
      const nextScope = scopes[nextIndex];
      return focusScope(nextScope, direction, event);
    },
    [focusScope, getOrderedScopes]
  );

  const handleKeyEvent = useCallback(
    (event: KeyboardEvent): boolean => {
      if (event.key !== 'Tab') {
        return false;
      }

      const targetElement = resolveEventElement(event.target);
      if (shouldAllowNativeTab(targetElement)) {
        return false;
      }

      const direction: TabDirection = event.shiftKey ? 'backward' : 'forward';
      const scope = findScopeForElement(targetElement);

      const allowNativeSelector = scope?.allowNativeSelector;
      if (allowNativeSelector && targetElement && targetElement.closest(allowNativeSelector)) {
        return false;
      }

      const result = scope?.onNavigate?.({ direction, event }) ?? 'bubble';
      if (result === 'native') {
        return false;
      }
      if (result === 'handled') {
        event.preventDefault();
        event.stopPropagation();
        activeScopeIdRef.current = scope?.id ?? null;
        return true;
      }

      const handledByFallback = focusNextScope(scope?.id ?? null, direction, event);
      if (handledByFallback) {
        event.preventDefault();
        event.stopPropagation();
        return true;
      }

      return false;
    },
    [findScopeForElement, focusNextScope, shouldAllowNativeTab]
  );

  const contextValue = useMemo<KeyboardNavigationContextValue>(
    () => ({
      registerScope,
      unregisterScope,
      updateScope,
      handleKeyEvent,
    }),
    [handleKeyEvent, registerScope, unregisterScope, updateScope]
  );

  return (
    <KeyboardNavigationContext.Provider value={contextValue}>
      {children}
    </KeyboardNavigationContext.Provider>
  );
};

export interface UseKeyboardNavigationScopeOptions extends TabScopeOptions {}

export const useKeyboardNavigationScope = ({
  ref,
  priority,
  onNavigate,
  onEnter,
  allowNativeSelector,
  disabled = false,
}: UseKeyboardNavigationScopeOptions) => {
  const { registerScope, unregisterScope, updateScope } = useKeyboardNavigationContext();
  const scopeIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (disabled) {
      if (scopeIdRef.current) {
        unregisterScope(scopeIdRef.current);
        scopeIdRef.current = null;
      }
      return;
    }

    const scopeOptions: TabScopeOptions = {
      ref,
      priority,
      onNavigate,
      onEnter,
      allowNativeSelector,
    };

    if (!scopeIdRef.current) {
      scopeIdRef.current = registerScope(scopeOptions);
    } else {
      updateScope(scopeIdRef.current, scopeOptions);
    }

    return () => {
      if (scopeIdRef.current) {
        unregisterScope(scopeIdRef.current);
        scopeIdRef.current = null;
      }
    };
  }, [
    allowNativeSelector,
    disabled,
    onEnter,
    onNavigate,
    priority,
    ref,
    registerScope,
    unregisterScope,
    updateScope,
  ]);
};
