/**
 * frontend/src/ui/layout/NamespaceScopeEditor.tsx
 *
 * The sidebar's inline "accessible namespaces" editor
 * (docs/plans/namespace-scope.md): the namespaces section itself is the
 * editor — an add-namespace affordance plus per-row hover delete (the row
 * buttons live in Sidebar.tsx). No modal, no settings surface; the editing
 * affordances are also the only "scope active" signal the design needs.
 */

import { PlusIcon } from '@shared/components/icons/SharedIcons';
import { useCallback, useEffect, useRef, useState } from 'react';
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
  error: string | null;
  addNamespace: (name: string) => boolean;
  removeNamespace: (name: string) => void;
  clearError: () => void;
}

export function useNamespaceScope(clusterId: string | undefined): NamespaceScopeState {
  const [scope, setScope] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setScope([]);
    setError(null);
    setLoaded(false);
    if (!clusterId) {
      setLoaded(true);
      return;
    }
    void loadNamespaceScope(clusterId).then(
      (names) => {
        if (!cancelled) {
          setScope(names);
          setLoaded(true);
        }
      },
      () => {
        // Unreadable settings degrade to "no scope" — same as the backend.
        if (!cancelled) {
          setLoaded(true);
        }
      }
    );
    return () => {
      cancelled = true;
    };
  }, [clusterId]);

  const apply = useCallback(
    async (next: string[]) => {
      if (!clusterId) {
        // Never swallow an edit: without a cluster id the save cannot be
        // attributed, and a silent no-op looks like the bug it masks.
        setError('No active cluster selected — cannot save the namespace scope.');
        return;
      }
      setSaving(true);
      setError(null);
      try {
        setScope(await saveNamespaceScope(clusterId, next));
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setSaving(false);
      }
    },
    [clusterId]
  );

  const addNamespace = useCallback(
    (name: string): boolean => {
      const result = addNamespaceToScope(scope, name);
      if (result.error) {
        setError(result.error);
        return false;
      }
      void apply(result.next ?? scope);
      return true;
    },
    [scope, apply]
  );

  const removeNamespace = useCallback(
    (name: string) => {
      void apply(removeNamespaceFromScope(scope, name));
    },
    [scope, apply]
  );

  const clearError = useCallback(() => setError(null), []);

  return { scope, loaded, saving, error, addNamespace, removeNamespace, clearError };
}

interface NamespaceScopeAddRowProps {
  state: NamespaceScopeState;
}

/**
 * The "Add namespace" row: a sidebar item that turns into an inline input.
 * Enter commits (backend validates and rebuilds), Escape cancels.
 */
export function NamespaceScopeAddRow({ state }: NamespaceScopeAddRowProps) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
    }
  }, [editing]);

  const commit = () => {
    const name = value.trim();
    if (name === '') {
      setEditing(false);
      return;
    }
    if (state.addNamespace(name)) {
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
            event.stopPropagation();
            if (event.key === 'Enter') {
              event.preventDefault();
              commit();
            } else if (event.key === 'Escape') {
              event.preventDefault();
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
          tabIndex={-1}
          onClick={() => setEditing(true)}
        >
          <PlusIcon width={14} height={14} />
          <span>Add namespace</span>
        </button>
      )}
      {state.error ? <div className="namespace-scope-error">{state.error}</div> : null}
      {state.scope.length > NAMESPACE_SCOPE_SOFT_WARNING_THRESHOLD ? (
        <div className="namespace-scope-warning">
          Large scopes open one watch per resource kind per namespace.
        </div>
      ) : null}
    </div>
  );
}
