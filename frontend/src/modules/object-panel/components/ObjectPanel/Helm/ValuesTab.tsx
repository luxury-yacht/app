/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Helm/ValuesTab.tsx
 *
 * UI component for ValuesTab.
 * Handles rendering and interactions for the object panel feature.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import CodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { yaml as yamlLang } from '@codemirror/lang-yaml';
import { EditorView } from '@codemirror/view';
import * as YAML from 'yaml';
import LoadingSpinner from '@shared/components/LoadingSpinner';
import SegmentedButton from '@shared/components/SegmentedButton';
import { refreshOrchestrator } from '@/core/refresh';
import { useRefreshScopedDomain } from '@/core/refresh/store';
import { errorHandler } from '@utils/errorHandler';
import './ValuesTab.css';
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

type HelmValuesData = Record<string, any>;

interface ValuesTabProps {
  scope: string | null;
  isActive?: boolean;
}

const ValuesTab: React.FC<ValuesTabProps> = ({ scope, isActive = false }) => {
  const editorRef = useRef<ReactCodeMirrorRef>(null);
  const editorViewRef = useRef<EditorView | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [showMode, setShowMode] = useState<'defaults' | 'overrides' | 'merged'>('defaults');
  const [searchTerm, setSearchTerm] = useState('');
  const [isDarkTheme, setIsDarkTheme] = useState(
    () => document.documentElement.getAttribute('data-theme') === 'dark'
  );

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
  const snapshot = useRefreshScopedDomain('object-helm-values', effectiveScope);

  // Enable/disable the scoped domain based on tab activity. preserveState
  // keeps the store entry alive when the tab unmounts so diagnostics can still
  // see it. Full cleanup (reset) is handled by ObjectPanelContent when the
  // panel closes.
  useEffect(() => {
    if (!scope) {
      return undefined;
    }

    const enabled = isActive;
    refreshOrchestrator.setScopedDomainEnabled('object-helm-values', scope, enabled);
    if (enabled) {
      void refreshOrchestrator.fetchScopedDomain('object-helm-values', scope, { isManual: true });
    }

    return () => {
      refreshOrchestrator.setScopedDomainEnabled('object-helm-values', scope, false, {
        preserveState: true,
      });
    };
  }, [scope, isActive]);

  const valuesData = snapshot.data?.values as HelmValuesData | undefined;
  const valuesLoading =
    snapshot.status === 'loading' ||
    snapshot.status === 'initialising' ||
    (snapshot.status === 'updating' && !valuesData);
  const valuesError = snapshot.error ?? null;

  const hasPath = useCallback((obj: any, path: string[]): boolean => {
    if (!obj) return false;
    let current = obj;
    for (const key of path) {
      if (current === null || current === undefined || !(key in current)) {
        return false;
      }
      current = current[key];
    }
    return true;
  }, []);

  const getValueAtPath = useCallback((obj: any, path: string[]): any => {
    let current = obj;
    for (const key of path) {
      if (current === null || current === undefined) return undefined;
      current = current[key];
    }
    return current;
  }, []);

  const getDefaultValues = useCallback(
    (allVals: any, userVals: any, path: string[] = []): any => {
      if (allVals === null || allVals === undefined) return allVals;
      if (typeof allVals !== 'object' || Array.isArray(allVals)) {
        if (hasPath(userVals, path)) {
          return undefined;
        }
        return allVals;
      }
      const result: any = {};
      for (const key in allVals) {
        const newPath = [...path, key];
        const value = allVals[key];
        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
          const defaultVal = getDefaultValues(value, userVals, newPath);
          if (defaultVal !== undefined && Object.keys(defaultVal).length > 0) {
            result[key] = defaultVal;
          }
        } else if (!hasPath(userVals, newPath)) {
          result[key] = value;
        }
      }
      return result;
    },
    [hasPath]
  );

  const markOverriddenValues = useCallback(
    (obj: any, userValues: any, path: string[] = []): any => {
      if (obj === null || obj === undefined) return obj;
      if (typeof obj !== 'object' || Array.isArray(obj)) {
        const isOverridden = hasPath(userValues, path);
        if (isOverridden) {
          const userValue = getValueAtPath(userValues, path);
          return userValue;
        }
        return obj;
      }

      const result: any = {};
      for (const key in obj) {
        const newPath = [...path, key];
        const value = obj[key];
        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
          result[key] = markOverriddenValues(value, userValues, newPath);
        } else {
          const isOverridden = hasPath(userValues, newPath);
          if (isOverridden) {
            const userValue = getValueAtPath(userValues, newPath);
            result[key] = userValue;
          } else {
            result[key] = value;
          }
        }
      }
      return result;
    },
    [getValueAtPath, hasPath]
  );

  const getActualOverrides = useCallback(
    (userVals: any, _allVals: any, path: string[] = []): any => {
      if (userVals === null || userVals === undefined) return userVals;
      if (typeof userVals !== 'object' || Array.isArray(userVals)) {
        return userVals;
      }
      const result: any = {};
      for (const key in userVals) {
        result[key] = getActualOverrides(userVals[key], _allVals?.[key], [...path, key]);
      }
      return result;
    },
    []
  );

  const displayContent = useMemo(() => {
    if (!valuesData) {
      return '';
    }

    const allValues = valuesData.allValues ?? valuesData;
    const userValues = valuesData.userValues ?? {};

    let content: any;
    switch (showMode) {
      case 'defaults':
        content = getDefaultValues(allValues, userValues);
        break;
      case 'overrides':
        content = getActualOverrides(userValues, allValues);
        break;
      case 'merged':
      default:
        content = markOverriddenValues(allValues, userValues);
        break;
    }

    try {
      return YAML.stringify(content ?? {}, {
        indent: 2,
        lineWidth: 0,
        doubleQuotedAsJSON: false,
        singleQuote: false,
        defaultKeyType: 'PLAIN',
        defaultStringType: 'PLAIN',
      });
    } catch (e) {
      errorHandler.handle(e, { action: 'processHelmValues' });
      return YAML.stringify(content ?? {});
    }
  }, [valuesData, showMode, getDefaultValues, getActualOverrides, markOverriddenValues]);

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
  }, [applySearchQuery, displayContent]);

  useSearchShortcutTarget({
    isActive,
    focus: () => focusSearchInput(true),
    priority: 20,
    label: 'Helm values search',
  });

  if (valuesLoading) {
    return (
      <div className="object-panel-tab-content">
        <LoadingSpinner message="Loading values..." />
      </div>
    );
  }

  if (valuesError) {
    return (
      <div className="object-panel-tab-content">
        <div className="yaml-display-error">
          <div className="error-message">Error loading values: {valuesError}</div>
        </div>
      </div>
    );
  }

  if (!valuesData) {
    return (
      <div className="object-panel-tab-content">
        <div className="yaml-display-empty">
          <p>No values available</p>
        </div>
      </div>
    );
  }

  return (
    <div className="object-panel-tab-content">
      <div className="values-display">
        <div className="yaml-header">
          <div className="values-mode-controls">
            <SegmentedButton
              options={[
                { label: 'Defaults', value: 'defaults' },
                { label: 'Overrides', value: 'overrides' },
                { label: 'Merged', value: 'merged' },
              ]}
              value={showMode}
              onChange={(value) => setShowMode(value as typeof showMode)}
            />
          </div>
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
        <div className="yaml-display">
          <div className="yaml-content">
            <div className="codemirror-shell">
              <CodeMirror
                ref={editorRef}
                value={displayContent}
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
    </div>
  );
};

export default ValuesTab;
