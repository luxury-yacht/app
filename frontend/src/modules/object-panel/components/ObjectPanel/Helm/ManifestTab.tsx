/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Helm/ManifestTab.tsx
 *
 * Module source for ManifestTab.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import CodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { yaml as yamlLang } from '@codemirror/lang-yaml';
import { EditorView } from '@codemirror/view';
import LoadingSpinner from '@shared/components/LoadingSpinner';
import { refreshOrchestrator } from '@/core/refresh';
import { useRefreshScopedDomain } from '@/core/refresh/store';
import '../Yaml/YamlTab.css';
import { buildCodeTheme } from '@/core/codemirror/theme';
import { useSearchShortcutTarget } from '@ui/shortcuts';
import { createSearchExtensions, closeSearchPanel } from '@/core/codemirror/search';
import {
  SearchQuery,
  findNext,
  findPrevious,
  getSearchQuery,
  setSearchQuery,
} from '@codemirror/search';

const INACTIVE_SCOPE = '__inactive__';

interface ManifestTabProps {
  scope: string | null;
  isActive?: boolean;
}

const ManifestTab: React.FC<ManifestTabProps> = ({ scope, isActive = false }) => {
  const editorRef = useRef<ReactCodeMirrorRef>(null);
  const editorViewRef = useRef<EditorView | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [isDarkTheme, setIsDarkTheme] = useState(() => {
    return document.documentElement.getAttribute('data-theme') === 'dark';
  });

  useEffect(() => {
    const checkTheme = () => {
      setIsDarkTheme(document.documentElement.getAttribute('data-theme') === 'dark');
    };

    const observer = new MutationObserver(checkTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'class'],
    });

    return () => observer.disconnect();
  }, []);

  const effectiveScope = scope ?? INACTIVE_SCOPE;
  const snapshot = useRefreshScopedDomain('object-helm-manifest', effectiveScope);

  useEffect(() => {
    if (!scope) {
      return undefined;
    }

    const enabled = isActive;
    refreshOrchestrator.setScopedDomainEnabled('object-helm-manifest', scope, enabled);
    if (enabled) {
      void refreshOrchestrator.fetchScopedDomain('object-helm-manifest', scope, { isManual: true });
    }

    return () => {
      refreshOrchestrator.setScopedDomainEnabled('object-helm-manifest', scope, false);
      refreshOrchestrator.resetScopedDomain('object-helm-manifest', scope);
    };
  }, [scope, isActive]);

  const manifestContent = snapshot.data?.manifest ?? '';
  const manifestLoading =
    snapshot.status === 'loading' ||
    snapshot.status === 'initialising' ||
    (snapshot.status === 'updating' && !manifestContent);
  const manifestError = snapshot.error ?? null;

  const { theme: codeMirrorTheme, highlight: highlightExtension } = useMemo(
    () => buildCodeTheme(isDarkTheme),
    [isDarkTheme]
  );

  const searchExtensions = useMemo(() => createSearchExtensions({ enableKeymap: false }), []);

  const editorExtensions = useMemo(
    () => [yamlLang(), EditorView.lineWrapping, highlightExtension, ...searchExtensions],
    [highlightExtension, searchExtensions]
  );

  const applySearchQuery = useCallback((view: EditorView | null, term: string) => {
    if (!view) {
      return;
    }
    const current = getSearchQuery(view.state);
    const query = new SearchQuery({
      search: term,
      caseSensitive: current.caseSensitive,
      literal: current.literal,
      regexp: current.regexp,
      wholeWord: current.wholeWord,
      replace: current.replace,
    });
    view.dispatch({ effects: setSearchQuery.of(query) });
  }, []);

  const focusSearchInput = useCallback(
    (useSelection: boolean): boolean => {
      const view = editorViewRef.current;
      if (!view || !isActive) {
        return false;
      }
      if (useSelection) {
        const selection = view.state.sliceDoc(
          view.state.selection.main.from,
          view.state.selection.main.to
        );
        if (selection && !selection.includes('\n')) {
          setSearchTerm(selection);
          applySearchQuery(view, selection);
        }
      }
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
      return true;
    },
    [applySearchQuery, isActive]
  );

  const handleSearchChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const value = event.target.value;
      setSearchTerm(value);
      applySearchQuery(editorViewRef.current, value);
    },
    [applySearchQuery]
  );

  const handleFindNext = useCallback(() => {
    const view = editorViewRef.current;
    if (!view || !searchTerm) {
      return;
    }
    findNext(view);
    view.focus();
  }, [searchTerm]);

  const handleFindPrevious = useCallback(() => {
    const view = editorViewRef.current;
    if (!view || !searchTerm) {
      return;
    }
    findPrevious(view);
    view.focus();
  }, [searchTerm]);

  const handleSearchKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        event.currentTarget.select();
        return;
      }

      if (event.key === 'Enter') {
        event.preventDefault();
        if (event.shiftKey) {
          handleFindPrevious();
        } else {
          handleFindNext();
        }
      } else if (event.key === 'Escape') {
        event.preventDefault();
        searchInputRef.current?.blur();
        editorViewRef.current?.focus();
      }
    },
    [handleFindNext, handleFindPrevious]
  );

  const handleEditorCreated = useCallback(
    (view: EditorView) => {
      editorViewRef.current = view;
      setSearchTerm('');
      applySearchQuery(view, '');
      closeSearchPanel(view);
    },
    [applySearchQuery]
  );

  useEffect(() => {
    if (editorRef.current?.view) {
      editorViewRef.current = editorRef.current.view;
      setSearchTerm('');
      applySearchQuery(editorRef.current.view, '');
      closeSearchPanel(editorRef.current.view);
    }
  }, [applySearchQuery, manifestContent]);

  useSearchShortcutTarget({
    isActive,
    focus: () => focusSearchInput(true),
    priority: 20,
    label: 'Helm manifest search',
  });

  if (manifestLoading) {
    return (
      <div className="object-panel-tab-content">
        <LoadingSpinner message="Loading manifest..." />
      </div>
    );
  }

  if (manifestError) {
    return (
      <div className="object-panel-tab-content">
        <div className="yaml-display-error">
          <div className="error-message">Error loading manifest: {manifestError}</div>
        </div>
      </div>
    );
  }

  if (!manifestContent) {
    return (
      <div className="object-panel-tab-content">
        <div className="yaml-display-empty">
          <p>No manifest content available</p>
        </div>
      </div>
    );
  }

  return (
    <div className="object-panel-tab-content">
      <div className="yaml-display">
        <div className="yaml-header">
          <div className="yaml-controls">
            <div className="find-controls">
              <input
                ref={searchInputRef}
                className="find-input"
                type="text"
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                placeholder="Find…"
                value={searchTerm}
                onChange={handleSearchChange}
                onKeyDown={handleSearchKeyDown}
              />
              <div className="find-nav">
                <button
                  className="button generic"
                  onClick={handleFindPrevious}
                  disabled={!searchTerm}
                  aria-label="Previous match"
                  title="Previous match"
                >
                  {'<'}
                </button>
                <button
                  className="button generic"
                  onClick={handleFindNext}
                  disabled={!searchTerm}
                  aria-label="Next match"
                  title="Next match"
                >
                  {'>'}
                </button>
              </div>
            </div>
          </div>
        </div>
        <div className="yaml-content">
          <div className="codemirror-shell">
            <CodeMirror
              ref={editorRef}
              value={manifestContent}
              height="100%"
              theme={codeMirrorTheme}
              extensions={editorExtensions}
              editable={false}
              basicSetup={{
                highlightActiveLine: false,
                highlightActiveLineGutter: false,
                lineNumbers: true,
                foldGutter: false,
                searchKeymap: false,
              }}
              onCreateEditor={handleEditorCreated}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default ManifestTab;
