import { yaml as yamlLang } from '@codemirror/lang-yaml';
import {
  findNext,
  findPrevious,
  getSearchQuery,
  SearchQuery,
  setSearchQuery,
} from '@codemirror/search';
import { EditorSelection, EditorState, type Extension } from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  EditorView,
  type KeyBinding,
  keymap,
} from '@codemirror/view';
import ContextMenu, { type ContextMenuItem } from '@shared/components/ContextMenu';
import IconBar, { type IconBarItem } from '@shared/components/IconBar/IconBar';
import { RegexSearchIcon } from '@shared/components/icons/LogIcons';
import { CaseSensitiveIcon } from '@shared/components/icons/SharedIcons';
import { YamlNextIcon, YamlPreviousIcon } from '@shared/components/icons/YamlIcons';

import { useKeyboardSurface, useSearchShortcutTarget } from '@ui/shortcuts';
import { deriveCopyText } from '@ui/shortcuts/context';
import CodeMirror, { ExternalChange, type ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { ClipboardGetText } from '@wailsjs/runtime/runtime';
import type React from 'react';
import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import {
  copyCodeMirrorSelection,
  cutCodeMirrorSelection,
  getCodeMirrorSelectedText,
  selectCodeMirrorContent,
} from '@/core/codemirror/nativeActions';
import { closeSearchPanel, createSearchExtensions } from '@/core/codemirror/search';
import { buildCodeTheme } from '@/core/codemirror/theme';
import './YamlEditor.css';

export interface ProtectedYamlRange {
  from: number;
  to: number;
  tooltip?: string;
  blockedMessage?: string;
}

export type ProtectedYamlRangeResolver = (value: string) => ProtectedYamlRange[];

export interface YamlEditorHandle {
  focus: () => void;
  selectAll: () => boolean;
  getSelectedText: () => string;
  getView: () => EditorView | null;
}

export interface YamlEditorProps {
  value: string;
  onChange?: (value: string) => void;
  editable?: boolean;
  disabled?: boolean;
  ariaLabel: string;
  active?: boolean;
  shortcutLabel?: string;
  shortcutPriority?: number;
  height?: string;
  className?: string;
  searchPlaceholder?: string;
  showSearch?: boolean;
  showSearchOptions?: boolean;
  lineWrapping?: boolean;
  toolbarActions?: React.ReactNode;
  largeDocumentNotice?: string | null;
  extraExtensions?: Extension[];
  keyBindings?: KeyBinding[];
  protectedRanges?: ProtectedYamlRange[];
  protectedRangeResolver?: ProtectedYamlRangeResolver;
  protectedTooltip?: string;
  protectedBlockedMessage?: string;
  onProtectedEditBlocked?: (reason: string) => void;
  onEscape?: () => boolean;
  onCreateEditor?: (view: EditorView) => void;
}

type YamlSearchState = {
  caseSensitiveMatches: boolean;
  regexMatches: boolean;
};

const DEFAULT_SEARCH_STATE: YamlSearchState = {
  caseSensitiveMatches: false,
  regexMatches: false,
};

const DEFAULT_PROTECTED_TOOLTIP = 'Managed by Kubernetes. Shown for context and cannot be edited.';
const DEFAULT_PROTECTED_BLOCKED_MESSAGE = 'Managed Kubernetes fields cannot be edited.';

const rangesForDocument = (
  text: string,
  staticRanges: ProtectedYamlRange[] | undefined,
  resolver: ProtectedYamlRangeResolver | undefined
): ProtectedYamlRange[] => {
  const rawRanges = resolver ? resolver(text) : (staticRanges ?? []);
  return rawRanges
    .map((range) => ({
      ...range,
      from: Math.max(0, Math.min(text.length, range.from)),
      to: Math.max(0, Math.min(text.length, range.to)),
    }))
    .filter((range) => range.to > range.from)
    .sort((left, right) => left.from - right.from || left.to - right.to);
};

const changeTouchesRange = (
  from: number,
  to: number,
  ranges: ProtectedYamlRange[]
): ProtectedYamlRange | null => {
  for (const range of ranges) {
    if (from === to) {
      if (from >= range.from && from <= range.to) {
        return range;
      }
      continue;
    }
    if (from <= range.to && to > range.from) {
      return range;
    }
  }
  return null;
};

const visualRangesForDocument = (
  text: string,
  ranges: ProtectedYamlRange[]
): ProtectedYamlRange[] => {
  const visualRanges: ProtectedYamlRange[] = [];

  ranges.forEach((range) => {
    let position = range.from;
    while (position < range.to) {
      const lineBreak = text.indexOf('\n', position);
      const lineEnd = lineBreak === -1 ? text.length : Math.min(lineBreak, range.to);
      let from = position;
      let to = lineEnd;

      while (from < to && /\s/.test(text[from])) {
        from += 1;
      }
      while (to > from && /\s/.test(text[to - 1])) {
        to -= 1;
      }

      if (to > from) {
        visualRanges.push({
          ...range,
          from,
          to,
        });
      }

      if (lineBreak === -1 || lineBreak >= range.to) {
        break;
      }
      position = lineBreak + 1;
    }
  });

  return visualRanges;
};

const buildProtectedDecorationSet = (
  text: string,
  ranges: ProtectedYamlRange[],
  defaultTooltip: string
): DecorationSet => {
  return Decoration.set(
    visualRangesForDocument(text, ranges).map((range) =>
      Decoration.mark({
        class: 'cm-yaml-protected-range',
        attributes: {
          title: range.tooltip ?? defaultTooltip,
        },
      }).range(range.from, range.to)
    )
  ) as DecorationSet;
};

const insertTextAtSelection = (view: EditorView | null, text: string): boolean => {
  if (!view) {
    return false;
  }
  const { from, to } = view.state.selection.main;
  view.dispatch({
    changes: { from, to, insert: text },
    selection: EditorSelection.cursor(from + text.length),
  });
  view.focus();
  return true;
};

const YamlEditor = ({
  value,
  onChange,
  editable = false,
  disabled = false,
  ariaLabel,
  active = true,
  shortcutLabel = 'YAML editor search',
  shortcutPriority = 30,
  height = '100%',
  className,
  searchPlaceholder = 'Find...',
  showSearch = true,
  showSearchOptions = false,
  lineWrapping = true,
  toolbarActions,
  largeDocumentNotice = null,
  extraExtensions = [],
  keyBindings = [],
  protectedRanges,
  protectedRangeResolver,
  protectedTooltip = DEFAULT_PROTECTED_TOOLTIP,
  protectedBlockedMessage = DEFAULT_PROTECTED_BLOCKED_MESSAGE,
  onProtectedEditBlocked,
  onEscape,
  onCreateEditor,
  ref,
}: YamlEditorProps & { ref?: React.Ref<YamlEditorHandle> }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [searchState, setSearchState] = useState<YamlSearchState>(DEFAULT_SEARCH_STATE);
  const [contextMenu, setContextMenu] = useState<{
    position: { x: number; y: number };
    items: ContextMenuItem[];
  } | null>(null);
  const [isDarkMode, setIsDarkMode] = useState(
    () => document.documentElement.getAttribute('data-appearance-mode') === 'dark'
  );

  const editorRef = useRef<ReactCodeMirrorRef>(null);
  const editorViewRef = useRef<EditorView | null>(null);
  const editorSurfaceRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const canEdit = editable && !disabled;

  useEffect(() => {
    const checkAppearanceMode = () => {
      setIsDarkMode(document.documentElement.getAttribute('data-appearance-mode') === 'dark');
    };

    const observer = new MutationObserver(checkAppearanceMode);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-appearance-mode', 'class'],
    });

    return () => observer.disconnect();
  }, []);

  const { theme: codeMirrorTheme, highlight: highlightExtension } = useMemo(
    () => buildCodeTheme(isDarkMode),
    [isDarkMode]
  );

  const searchExtensions = useMemo<Extension[]>(
    () => createSearchExtensions({ enableKeymap: false }),
    []
  );

  const applySearchQuery = useCallback(
    (view: EditorView | null, term: string) => {
      if (!view) {
        return;
      }
      const current = getSearchQuery(view.state);
      const query = new SearchQuery({
        search: term,
        caseSensitive: searchState.caseSensitiveMatches,
        literal: !searchState.regexMatches,
        regexp: searchState.regexMatches,
        wholeWord: current.wholeWord,
        replace: current.replace,
      });
      view.dispatch({ effects: setSearchQuery.of(query) });
    },
    [searchState.caseSensitiveMatches, searchState.regexMatches]
  );

  const clearSearchQuery = useCallback((view: EditorView | null) => {
    if (!view) {
      return;
    }
    const current = getSearchQuery(view.state);
    const query = new SearchQuery({
      search: '',
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
      if (!active) {
        return false;
      }
      const view = editorViewRef.current;
      if (!view) {
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
    [active, applySearchQuery]
  );

  const handleSearchChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const term = event.target.value;
      const view = editorViewRef.current;
      setSearchTerm(term);
      if (view) {
        view.dispatch({
          selection: EditorSelection.cursor(term ? 0 : view.state.selection.main.from),
        });
      }
      applySearchQuery(view, term);
      if (view && term) {
        findNext(view);
      }
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
      } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
        event.preventDefault();
        handleFindPrevious();
      } else if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
        event.preventDefault();
        handleFindNext();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        searchInputRef.current?.blur();
        editorViewRef.current?.focus();
      }
    },
    [handleFindNext, handleFindPrevious]
  );

  const protectedExtensions = useMemo<Extension[]>(() => {
    if (!protectedRangeResolver && !protectedRanges?.length) {
      return [];
    }

    const protectedDecorationExtension = EditorView.decorations.compute(['doc'], (state) => {
      const currentText = state.doc.toString();
      return buildProtectedDecorationSet(
        currentText,
        rangesForDocument(currentText, protectedRanges, protectedRangeResolver),
        protectedTooltip
      );
    });
    const protectedTransactionExtension = EditorState.transactionFilter.of((transaction) => {
      if (!transaction.docChanged) {
        return transaction;
      }
      if (typeof transaction.annotation === 'function' && transaction.annotation(ExternalChange)) {
        return transaction;
      }
      const ranges = rangesForDocument(
        transaction.startState.doc.toString(),
        protectedRanges,
        protectedRangeResolver
      );
      let touchedRange: ProtectedYamlRange | null = null;
      transaction.changes.iterChanges((fromA, toA) => {
        if (!touchedRange) {
          touchedRange = changeTouchesRange(fromA, toA, ranges);
        }
      });
      const blockedRange = touchedRange as ProtectedYamlRange | null;
      if (!blockedRange) {
        return transaction;
      }
      const message = blockedRange.blockedMessage ?? protectedBlockedMessage;
      onProtectedEditBlocked?.(message);
      return [];
    });

    return [protectedDecorationExtension, protectedTransactionExtension];
  }, [
    onProtectedEditBlocked,
    protectedBlockedMessage,
    protectedRangeResolver,
    protectedRanges,
    protectedTooltip,
  ]);

  const editorKeyBindings = useMemo<KeyBinding[]>(
    () => [
      {
        key: 'Mod-f',
        preventDefault: true,
        run: () => focusSearchInput(true),
      },
      {
        key: 'Shift-Mod-f',
        preventDefault: true,
        run: () => focusSearchInput(true),
      },
      ...(!disabled ? keyBindings : []),
    ],
    [disabled, focusSearchInput, keyBindings]
  );

  const contextMenuExtension = useMemo<Extension>(
    () =>
      EditorView.domEventHandlers({
        contextmenu: (event: MouseEvent, view: EditorView) => {
          event.preventDefault();

          const selectedText =
            getCodeMirrorSelectedText(view) || deriveCopyText(window.getSelection()) || '';
          const hasSelection = Boolean(selectedText);
          const items: ContextMenuItem[] = [];

          if (canEdit) {
            items.push({
              label: 'Cut',
              disabled: !hasSelection,
              onClick: () => {
                cutCodeMirrorSelection(view);
              },
            });
          }

          items.push({
            label: 'Copy',
            disabled: !hasSelection,
            onClick: () => {
              if (selectedText) {
                void navigator.clipboard.writeText(selectedText);
              }
            },
          });

          if (canEdit) {
            items.push({
              label: 'Paste',
              onClick: () => {
                // The browser clipboard-read API is permission-gated inside
                // the Wails WebView; read through the Go-side clipboard, the
                // same source the Edit menu paste uses.
                void ClipboardGetText()
                  .then((text) => {
                    if (!text) {
                      return;
                    }
                    insertTextAtSelection(view, text);
                  })
                  .catch(() => undefined);
              },
            });
          }

          items.push({ divider: true });
          items.push({
            label: 'Select All',
            onClick: () => selectCodeMirrorContent(view),
          });

          setContextMenu({
            position: { x: event.clientX, y: event.clientY },
            items,
          });
          return true;
        },
      }),
    [canEdit]
  );

  // Read-only content is not editable and would otherwise be unfocusable,
  // which keeps document.activeElement outside the editor — clipboard and
  // select-all shortcuts route to the surface that contains the focused
  // element, so the read-mode editor must be able to take focus.
  const readModeFocusExtensions = useMemo<Extension[]>(
    () => (canEdit ? [] : [EditorView.contentAttributes.of({ tabindex: '0' })]),
    [canEdit]
  );

  const editorExtensions = useMemo<Extension[]>(
    () => [
      yamlLang(),
      ...(lineWrapping ? [EditorView.lineWrapping] : []),
      highlightExtension,
      ...searchExtensions,
      ...protectedExtensions,
      ...readModeFocusExtensions,
      keymap.of(editorKeyBindings),
      contextMenuExtension,
      ...extraExtensions,
    ],
    [
      contextMenuExtension,
      editorKeyBindings,
      extraExtensions,
      highlightExtension,
      lineWrapping,
      protectedExtensions,
      readModeFocusExtensions,
      searchExtensions,
    ]
  );

  const handleEditorCreated = useCallback(
    (view: EditorView) => {
      editorViewRef.current = view;
      setSearchTerm('');
      clearSearchQuery(view);
      closeSearchPanel(view);
      onCreateEditor?.(view);
    },
    [clearSearchQuery, onCreateEditor]
  );

  useEffect(() => {
    void value;
    const view = editorRef.current?.view;
    if (view) {
      editorViewRef.current = view;
      setSearchTerm('');
      clearSearchQuery(view);
      closeSearchPanel(view);
    }
  }, [clearSearchQuery, value]);

  useEffect(() => {
    applySearchQuery(editorViewRef.current, searchTerm);
  }, [applySearchQuery, searchTerm]);

  useSearchShortcutTarget({
    isActive: active,
    focus: () => focusSearchInput(true),
    priority: shortcutPriority,
    label: shortcutLabel,
  });

  useKeyboardSurface({
    kind: 'editor',
    rootRef: editorSurfaceRef,
    active,
    priority: shortcutPriority,
    onEscape: () => onEscape?.() ?? false,
    onNativeAction: ({ action, text }) => {
      if (action === 'copy') {
        return copyCodeMirrorSelection(editorViewRef.current);
      }
      if (action === 'cut') {
        return canEdit ? cutCodeMirrorSelection(editorViewRef.current) : false;
      }
      if (action === 'selectAll') {
        return selectCodeMirrorContent(editorViewRef.current);
      }
      if (action !== 'paste' || !canEdit || typeof text !== 'string') {
        return false;
      }
      return insertTextAtSelection(editorViewRef.current, text);
    },
  });

  useImperativeHandle(
    ref,
    () => ({
      focus: () => editorViewRef.current?.focus(),
      selectAll: () => selectCodeMirrorContent(editorViewRef.current),
      getSelectedText: () => getCodeMirrorSelectedText(editorViewRef.current),
      getView: () => editorViewRef.current,
    }),
    []
  );

  const searchIconBarItems = useMemo<IconBarItem[]>(
    () => [
      {
        type: 'action',
        id: 'search-previous',
        icon: <YamlPreviousIcon width={16} height={16} />,
        onClick: handleFindPrevious,
        title: 'Previous match',
        ariaLabel: 'Previous match',
        disabled: !searchTerm,
      },
      {
        type: 'action',
        id: 'search-next',
        icon: <YamlNextIcon width={16} height={16} />,
        onClick: handleFindNext,
        title: 'Next match',
        ariaLabel: 'Next match',
        disabled: !searchTerm,
      },
      ...(showSearchOptions
        ? ([
            {
              type: 'toggle' as const,
              id: 'case-sensitive-search',
              icon: <CaseSensitiveIcon width={18} height={18} />,
              active: searchState.caseSensitiveMatches,
              onClick: () =>
                setSearchState((current) =>
                  current.regexMatches
                    ? current
                    : {
                        ...current,
                        caseSensitiveMatches: !current.caseSensitiveMatches,
                      }
                ),
              title: 'Case-sensitive search',
              ariaLabel: 'Case-sensitive search',
              disabled: searchState.regexMatches,
            },
            {
              type: 'toggle' as const,
              id: 'regex-search',
              icon: <RegexSearchIcon width={16} height={16} />,
              active: searchState.regexMatches,
              onClick: () =>
                setSearchState((current) => ({
                  ...current,
                  regexMatches: !current.regexMatches,
                  caseSensitiveMatches: !current.regexMatches
                    ? false
                    : current.caseSensitiveMatches,
                })),
              title: 'Enable regular expression search',
              ariaLabel: 'Enable regular expression search',
            },
          ] satisfies IconBarItem[])
        : []),
    ],
    [
      handleFindNext,
      handleFindPrevious,
      searchState.caseSensitiveMatches,
      searchState.regexMatches,
      searchTerm,
      showSearchOptions,
    ]
  );

  const handleContextMenuClose = useCallback(() => setContextMenu(null), []);

  return (
    <div className={`yaml-editor ${className ?? ''}`}>
      {!!(showSearch || toolbarActions) && (
        <div className="yaml-header yaml-editor-header">
          {!!showSearch && (
            <div className="yaml-search-controls">
              <div className="find-controls">
                <input
                  ref={searchInputRef}
                  className="find-input"
                  type="text"
                  placeholder={searchPlaceholder}
                  value={searchTerm}
                  onChange={handleSearchChange}
                  onKeyDown={handleSearchKeyDown}
                />
              </div>
              <IconBar items={searchIconBarItems} />
            </div>
          )}
          {!!toolbarActions && <div className="yaml-editor-toolbar">{toolbarActions}</div>}
        </div>
      )}
      <div className="yaml-editor-content">
        {!!largeDocumentNotice && <div className="yaml-editor-notice">{largeDocumentNotice}</div>}
        <div ref={editorSurfaceRef} className="codemirror-shell yaml-editor-shell">
          <CodeMirror
            ref={editorRef}
            value={value}
            height={height}
            editable={canEdit}
            basicSetup={{
              highlightActiveLine: true,
              highlightActiveLineGutter: true,
              lineNumbers: true,
              foldGutter: false,
              searchKeymap: false,
            }}
            theme={codeMirrorTheme}
            extensions={editorExtensions}
            onChange={(nextValue) => {
              if (canEdit) {
                onChange?.(nextValue);
              }
            }}
            onCreateEditor={handleEditorCreated}
            aria-label={ariaLabel}
          />
        </div>
        {!!contextMenu && (
          <ContextMenu
            items={contextMenu.items}
            position={contextMenu.position}
            onClose={handleContextMenuClose}
          />
        )}
      </div>
    </div>
  );
};

YamlEditor.displayName = 'YamlEditor';

export default YamlEditor;
