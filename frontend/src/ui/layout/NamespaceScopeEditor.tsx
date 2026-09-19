/**
 * frontend/src/ui/layout/NamespaceScopeEditor.tsx
 *
 * The sidebar's inline "accessible namespaces" editor
 * (docs/architecture/namespace-scope.md): the namespaces section itself is the
 * editor — an add-namespace affordance plus per-row remove controls on hover
 * or focus (the row buttons live in Sidebar.tsx). No modal, no settings surface; the editing
 * affordances are also the only "scope active" signal the design needs.
 */

import { ErrorSurface } from '@shared/components/errors/ErrorSurface';
import { PlusIcon } from '@shared/components/icons/SharedIcons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  addNamespaceToScope,
  loadNamespaceScope,
  NAMESPACE_SCOPE_SOFT_WARNING_THRESHOLD,
  removeNamespaceFromScope,
  saveNamespaceScope,
} from './namespaceScope';

export interface NamespaceScopeState {
  /** The persisted scope for the active cluster (empty = unscoped). */
  scope: string[];
  /** True once the initial load for the active cluster finished. */
  loaded: boolean;
  saving: boolean;
  error: NamespaceScopeError | null;
  addNamespace: (name: string) => boolean;
  removeNamespace: (name: string) => void;
  clearError: () => void;
}

type NamespaceScopeError =
  | { kind: 'validation'; message: string }
  | { kind: 'operational'; error: unknown; context: Record<string, unknown> };

type ScopeSnapshot = Pick<NamespaceScopeState, 'scope' | 'loaded' | 'saving' | 'error'>;

export function useNamespaceScope(clusterId: string | undefined): NamespaceScopeState {
  // A new owner also distinguishes A -> B -> A from the first visit to A.
  const owner = useMemo(() => ({ clusterId }), [clusterId]);
  const emptySnapshot: ScopeSnapshot = {
    scope: [],
    loaded: !clusterId,
    saving: false,
    error: null,
  };
  const [state, setState] = useState(() => ({ owner, ...emptySnapshot }));
  const snapshot = state.owner === owner ? state : emptySnapshot;
  const { scope } = snapshot;
  const update = useCallback(
    (changes: Partial<ScopeSnapshot>) => {
      setState((current) => (current.owner === owner ? { ...current, ...changes } : current));
    },
    [owner]
  );

  useEffect(() => {
    let cancelled = false;
    setState({ owner, scope: [], loaded: !clusterId, saving: false, error: null });
    if (clusterId) {
      void loadNamespaceScope(clusterId).then(
        (names) => {
          if (!cancelled) {
            update({ scope: names, loaded: true });
          }
        },
        () => {
          // Unreadable settings degrade to "no scope" — same as the backend.
          if (!cancelled) {
            update({ loaded: true });
          }
        }
      );
    }
    return () => {
      cancelled = true;
    };
  }, [clusterId, owner, update]);

  const apply = useCallback(
    async (next: string[]) => {
      if (!clusterId) {
        // A save without an owner must surface an error instead of silently dropping an edit.
        update({
          error: {
            kind: 'operational',
            error: new Error('No active cluster selected — cannot save the namespace scope.'),
            context: { action: 'saveNamespaceScope', source: 'NamespaceScopeEditor' },
          },
        });
        return;
      }
      update({ saving: true, error: null });
      try {
        update({ scope: await saveNamespaceScope(clusterId, next) });
      } catch (error) {
        update({
          error: {
            kind: 'operational',
            error,
            context: {
              action: 'saveNamespaceScope',
              source: 'NamespaceScopeEditor',
              clusterId,
            },
          },
        });
      } finally {
        update({ saving: false });
      }
    },
    [clusterId, update]
  );

  const addNamespace = useCallback(
    (name: string): boolean => {
      const result = addNamespaceToScope(scope, name);
      if (result.error) {
        update({ error: { kind: 'validation', message: result.error } });
        return false;
      }
      void apply(result.next ?? scope);
      return true;
    },
    [scope, apply, update]
  );
  const removeNamespace = useCallback(
    (name: string) => {
      void apply(removeNamespaceFromScope(scope, name));
    },
    [scope, apply]
  );
  const clearError = useCallback(() => update({ error: null }), [update]);
  return {
    scope,
    loaded: snapshot.loaded,
    saving: snapshot.saving,
    error: snapshot.error,
    addNamespace,
    removeNamespace,
    clearError,
  };
}

interface NamespaceScopeAddRowProps {
  state: NamespaceScopeState;
}

/**
 * The "Add namespace" row: a sidebar item that turns into an inline input.
 * Enter commits (backend validates and rebuilds), Escape cancels.
 */
export function NamespaceScopeAddRow({ state }: Readonly<NamespaceScopeAddRowProps>) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const returnFocus = useRef(false);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
    }
  }, [editing]);

  const commit = () => {
    const name = value.trim();
    if (name === '') {
      returnFocus.current = true;
      setEditing(false);
      return;
    }
    if (state.addNamespace(name)) {
      returnFocus.current = true;
      setValue('');
      setEditing(false);
    }
  };

  return (
    <div className="namespace-scope-editor">
      {editing ? (
        <input
          ref={inputRef}
          className="namespace-scope-input"
          type="text"
          value={value}
          placeholder="namespace name"
          aria-label="Namespace name"
          spellCheck={false}
          disabled={state.saving}
          onChange={(event) => {
            state.clearError();
            setValue(event.target.value);
          }}
          onKeyDown={(event) => {
            // The editor owns its keys (docs/frontend/keyboard.md): stop
            // propagation so sidebar/global shortcuts never see them, and
            // prevent the default on the keys we consume — an unconsumed
            // Enter reaching the native layer beeps on macOS.
            if (event.key === 'Tab') {
              return;
            }
            event.stopPropagation();
            if (event.key === 'Enter') {
              event.preventDefault();
              commit();
            } else if (event.key === 'Escape') {
              event.preventDefault();
              returnFocus.current = true;
              setValue('');
              setEditing(false);
              state.clearError();
            }
          }}
          onBlur={() => {
            if (value.trim() === '') {
              setEditing(false);
              state.clearError();
            }
          }}
        />
      ) : (
        <button
          type="button"
          className="sidebar-item namespace-scope-add"
          ref={(element) => {
            if (element && returnFocus.current) {
              returnFocus.current = false;
              element.focus();
            }
          }}
          onClick={() => setEditing(true)}
        >
          <PlusIcon width={14} height={14} />
          <span>Add namespace</span>
        </button>
      )}
      {state.error ? (
        <div className="namespace-scope-error">
          {state.error.kind === 'operational' ? (
            <ErrorSurface
              kind="operational"
              error={state.error.error}
              context={state.error.context}
            />
          ) : (
            <ErrorSurface kind="validation" message={state.error.message} />
          )}
        </div>
      ) : null}
      {state.scope.length > NAMESPACE_SCOPE_SOFT_WARNING_THRESHOLD ? (
        <div className="namespace-scope-warning">
          Large scopes open one watch per resource kind per namespace.
        </div>
      ) : null}
    </div>
  );
}
