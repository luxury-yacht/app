/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Yaml/YamlTab.tsx
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import CodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { yaml as yamlLang } from '@codemirror/lang-yaml';
import { EditorView, keymap, type KeyBinding } from '@codemirror/view';
import { EditorSelection, type Extension } from '@codemirror/state';
import * as YAML from 'yaml';
import LoadingSpinner from '@shared/components/LoadingSpinner';
import ContextMenu, { type ContextMenuItem } from '@shared/components/ContextMenu';
import {
  CaseSensitiveIcon,
  CloseIcon,
  CollapseIcon,
  OpenIcon,
} from '@shared/components/icons/MenuIcons';
import IconBar, { type IconBarItem } from '@shared/components/IconBar/IconBar';
import { RegexSearchIcon } from '@shared/components/icons/LogIcons';
import { deriveCopyText } from '@ui/shortcuts/context';
import { useKeyboardSurface, useShortcut, useSearchShortcutTarget } from '@ui/shortcuts';
import { errorHandler } from '@utils/errorHandler';
import { refreshOrchestrator } from '@/core/refresh';
import { useRefreshScopedDomain } from '@/core/refresh/store';
import { GetObjectYAMLByGVK } from '@wailsjs/go/backend/App';
import type { DiffLine } from '@shared/components/diff/lineDiff';
import { computeBudgetedLineDiff } from '@shared/components/diff/lineDiff';
import { YAML_TAB_DIFF_BUDGETS } from '@shared/components/diff/diffBudgets';
import { formatTooLargeDiffMessage } from '@shared/components/diff/diffUtils';
import './YamlTab.css';
import { parseObjectIdentity, validateYamlDraft, type ObjectIdentity } from './yamlValidation';
import { parseObjectYamlError } from './yamlErrors';
import { buildCodeTheme } from '@/core/codemirror/theme';
import {
  copyCodeMirrorSelection,
  getCodeMirrorSelectedText,
  selectCodeMirrorContent,
} from '@/core/codemirror/nativeActions';
import { createSearchExtensions, closeSearchPanel } from '@/core/codemirror/search';
import {
  SearchQuery,
  findNext,
  findPrevious,
  getSearchQuery,
  setSearchQuery,
} from '@codemirror/search';

// Import from extracted modules
import type { YamlTabProps } from './yamlTabTypes';
import {
  INACTIVE_SCOPE,
  LINT_DEBOUNCE_MS,
  LARGE_MANIFEST_THRESHOLD,
  YAML_STRINGIFY_OPTIONS,
} from './yamlTabConfig';
import {
  normalizeYamlString,
  prepareDraftYaml,
  applyResourceVersionToYaml,
  applyYamlOnServer,
  mergeYamlWithLatestOnServer,
  sanitizeYamlForSemanticCompare,
} from './yamlTabUtils';
import { YamlCancelIcon, YamlEditIcon, YamlManagedFieldsIcon, YamlSaveIcon } from './YamlTabIcons';

export type { YamlTabProps } from './yamlTabTypes';

type YamlTabDiffResult = {
  lines: DiffLine[];
  tooLarge: boolean;
  tooLargeMessage: string | null;
};

type PostApplyNotice = {
  kind: 'diff' | 'warning' | 'stale';
  message: string;
  diff: YamlTabDiffResult | null;
};

type VerifiedPostApplyState = {
  identity: ObjectIdentity;
  semanticYaml: string;
};

type RecentVerifiedSemanticEntry = {
  reference: string;
  semanticYaml: string;
};

type YamlSearchState = {
  caseSensitiveMatches: boolean;
  regexMatches: boolean;
};

const DEFAULT_YAML_SEARCH_STATE: YamlSearchState = {
  caseSensitiveMatches: false,
  regexMatches: false,
};

const isSameObjectReference = (left: ObjectIdentity, right: ObjectIdentity): boolean =>
  left.apiVersion === right.apiVersion &&
  left.kind === right.kind &&
  left.name === right.name &&
  (left.uid && right.uid ? left.uid === right.uid : true) &&
  (left.namespace ?? '') === (right.namespace ?? '');

const buildObjectReferenceKey = (identity: ObjectIdentity): string =>
  [
    identity.apiVersion,
    identity.kind,
    identity.namespace ?? '',
    identity.name,
    identity.uid ?? '',
  ].join('|');

const normalizeYamlTabDiff = (diff: YamlTabDiffResult): YamlTabDiffResult => {
  if (diff.tooLarge) {
    return diff;
  }
  if (diff.lines.length > YAML_TAB_DIFF_BUDGETS.maxRenderableRows) {
    return {
      lines: [],
      tooLarge: true,
      tooLargeMessage: formatTooLargeDiffMessage(
        diff.lines.length,
        YAML_TAB_DIFF_BUDGETS.maxRenderableRows
      ),
    };
  }
  return diff;
};

const buildYamlTabDiff = (before: string, after: string): YamlTabDiffResult => {
  const diff = computeBudgetedLineDiff(before, after, YAML_TAB_DIFF_BUDGETS);
  return normalizeYamlTabDiff({
    lines: diff.lines,
    tooLarge: diff.tooLarge,
    tooLargeMessage:
      diff.tooLargeReason === 'input'
        ? formatTooLargeDiffMessage(
            Math.max(diff.leftLineCount, diff.rightLineCount),
            YAML_TAB_DIFF_BUDGETS.maxLinesPerSide
          )
        : null,
  });
};

const renderYamlDiffToggle = (
  diff: YamlTabDiffResult,
  keyPrefix: string,
  showFullDiff: boolean,
  onToggleFullDiff: (key: string) => void
) => {
  if (diff.tooLarge) {
    return null;
  }
  if (diff.lines.length === 0) {
    return null;
  }
  const hasContextLines = diff.lines.some((line) => line.type === 'context');
  const visibleLines = showFullDiff
    ? diff.lines
    : diff.lines.filter((line) => line.type !== 'context');
  if (visibleLines.length === 0) {
    return null;
  }
  return hasContextLines ? (
    <button
      className="button generic"
      type="button"
      aria-expanded={showFullDiff}
      onClick={() => onToggleFullDiff(keyPrefix)}
    >
      {showFullDiff ? 'Show only changes' : 'Show full diff'}
    </button>
  ) : null;
};

const renderYamlDiff = (diff: YamlTabDiffResult, keyPrefix: string, showFullDiff: boolean) => {
  if (diff.tooLarge) {
    return null;
  }
  if (diff.lines.length === 0) {
    return null;
  }
  const visibleLines = showFullDiff
    ? diff.lines
    : diff.lines.filter((line) => line.type !== 'context');
  if (visibleLines.length === 0) {
    return null;
  }
  return (
    <div className="yaml-drift-diff" role="status" aria-live="polite">
      <pre>
        {visibleLines.map((line, index) => {
          const lineKeyIndex = showFullDiff ? index : diff.lines.indexOf(line);
          const prefix = line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' ';
          const left =
            line.leftLineNumber !== undefined && line.leftLineNumber !== null
              ? line.leftLineNumber.toString().padStart(4, ' ')
              : '    ';
          const right =
            line.rightLineNumber !== undefined && line.rightLineNumber !== null
              ? line.rightLineNumber.toString().padStart(4, ' ')
              : '    ';
          return (
            <span
              key={`${keyPrefix}-${lineKeyIndex}`}
              className={`yaml-drift-diff-line yaml-drift-diff-line-${line.type}`}
            >
              {left}
              {' | '}
              {right}
              {' | '}
              {prefix} {line.value}
            </span>
          );
        })}
      </pre>
    </div>
  );
};

const YamlTab: React.FC<YamlTabProps> = ({
  scope,
  isActive = false,
  canEdit = false,
  clusterId,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [showManagedFields, setShowManagedFields] = useState(false);
  const [draftYaml, setDraftYaml] = useState('');
  const [lintError, setLintError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionDetails, setActionDetails] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [baselineIdentity, setBaselineIdentity] = useState<ObjectIdentity | null>(null);
  const [baselineResourceVersion, setBaselineResourceVersion] = useState<string | null>(null);
  const [baselineMergeYaml, setBaselineMergeYaml] = useState('');
  const [hasRemoteDrift, setHasRemoteDrift] = useState(false);
  const [driftForced, setDriftForced] = useState(false);
  const [backendDriftCurrentYaml, setBackendDriftCurrentYaml] = useState<string | null>(null);
  const [postApplyNotice, setPostApplyNotice] = useState<PostApplyNotice | null>(null);
  const [verifiedPostApply, setVerifiedPostApply] = useState<VerifiedPostApplyState | null>(null);
  const [pendingSnapshotAdoptionYaml, setPendingSnapshotAdoptionYaml] = useState<string | null>(
    null
  );
  const [latestObjectIdentity, setLatestObjectIdentity] = useState<ObjectIdentity | null>(null);
  const [manualYamlOverride, setManualYamlOverride] = useState<{
    yaml: string;
    resourceVersion: string | null;
  } | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchState, setSearchState] = useState<YamlSearchState>(DEFAULT_YAML_SEARCH_STATE);
  const [hasServerYamlError, setHasServerYamlError] = useState(false);
  const [expandedDiffs, setExpandedDiffs] = useState<Record<string, boolean>>({});
  const [contextMenu, setContextMenu] = useState<{
    position: { x: number; y: number };
    items: ContextMenuItem[];
  } | null>(null);

  const editorRef = useRef<ReactCodeMirrorRef>(null);
  const editorViewRef = useRef<EditorView | null>(null);
  const editorSurfaceRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const recentVerifiedSemanticYamlsRef = useRef<RecentVerifiedSemanticEntry[]>([]);

  const effectiveScope = scope ?? INACTIVE_SCOPE;
  const snapshot = useRefreshScopedDomain('object-yaml', effectiveScope);
  const resolvedClusterId = clusterId?.trim() ?? '';

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

  // Enable/disable the scoped domain based on tab activity. While editing,
  // pause the background refresher so routine controller updates do not keep
  // replacing the live snapshot and spuriously trip drift detection. Saves use
  // kubectl-edit-style patching against the live object, so background drift
  // should not force a reload before saving.
  //
  // preserveState keeps the store entry alive when the tab unmounts so
  // diagnostics can still see it. Full cleanup (reset) is handled by
  // ObjectPanelContent when the panel closes.
  useEffect(() => {
    if (!scope) {
      return undefined;
    }

    const enabled = isActive && !isEditing;
    refreshOrchestrator.setScopedDomainEnabled('object-yaml', scope, enabled);
    if (enabled) {
      void refreshOrchestrator.fetchScopedDomain('object-yaml', scope, { isManual: true });
    }

    return () => {
      refreshOrchestrator.setScopedDomainEnabled('object-yaml', scope, false, {
        preserveState: true,
      });
    };
  }, [scope, isActive, isEditing]);

  useShortcut({
    key: 'm',
    handler: useCallback(() => {
      if (!isActive || isEditing) return false;
      setShowManagedFields((prev) => !prev);
      return true;
    }, [isActive, isEditing]),
    description: 'Toggle managedFields',
    category: 'YAML Tab',
    enabled: true,
    priority: 20,
  });

  const yamlContent = snapshot.data?.yaml ?? '';
  const yamlLoading =
    snapshot.status === 'loading' ||
    snapshot.status === 'initialising' ||
    (snapshot.status === 'updating' && !yamlContent);
  const yamlError = snapshot.error ?? null;

  const effectiveYamlContent = manualYamlOverride?.yaml ?? yamlContent;

  const displayYaml = useMemo(() => {
    if (!effectiveYamlContent) {
      return effectiveYamlContent;
    }

    try {
      const doc = YAML.parseDocument(effectiveYamlContent);
      const obj = doc.toJSON();

      if (!showManagedFields && obj && obj.metadata && obj.metadata.managedFields) {
        delete obj.metadata.managedFields;
      }

      return YAML.stringify(obj, YAML_STRINGIFY_OPTIONS);
    } catch (e) {
      errorHandler.handle(e, { action: 'processYAML' });
      return effectiveYamlContent;
    }
  }, [effectiveYamlContent, showManagedFields]);

  const objectIdentity = useMemo(
    () => parseObjectIdentity(effectiveYamlContent),
    [effectiveYamlContent]
  );
  const effectiveIdentity = baselineIdentity ?? latestObjectIdentity ?? objectIdentity ?? null;

  useEffect(() => {
    if (!objectIdentity) {
      return;
    }
    setLatestObjectIdentity((prev) => {
      if (manualYamlOverride) {
        return prev ?? objectIdentity;
      }
      return objectIdentity;
    });
  }, [manualYamlOverride, objectIdentity]);

  useEffect(() => {
    if (!manualYamlOverride || !latestObjectIdentity) {
      return;
    }
    const snapshotNormalizedYaml = normalizeYamlString(yamlContent);
    const snapshotIdentity = parseObjectIdentity(snapshotNormalizedYaml);
    const overrideIdentity = parseObjectIdentity(manualYamlOverride.yaml);
    if (
      snapshotIdentity &&
      overrideIdentity &&
      isSameObjectReference(snapshotIdentity, overrideIdentity)
    ) {
      if (pendingSnapshotAdoptionYaml && snapshotNormalizedYaml === pendingSnapshotAdoptionYaml) {
        return;
      }

      if (
        snapshotIdentity.resourceVersion &&
        snapshotIdentity.resourceVersion === latestObjectIdentity.resourceVersion
      ) {
        setManualYamlOverride(null);
        setPendingSnapshotAdoptionYaml(null);
        return;
      }

      if (verifiedPostApply) {
        const snapshotSemanticYaml = sanitizeYamlForSemanticCompare(snapshotNormalizedYaml);
        const currentObjectReference = buildObjectReferenceKey(verifiedPostApply.identity);
        if (
          snapshotSemanticYaml === verifiedPostApply.semanticYaml ||
          recentVerifiedSemanticYamlsRef.current.some(
            (entry) =>
              entry.reference === currentObjectReference &&
              entry.semanticYaml === snapshotSemanticYaml
          )
        ) {
          return;
        }

        setManualYamlOverride(null);
        setPendingSnapshotAdoptionYaml(null);
        return;
      }

      if (pendingSnapshotAdoptionYaml && snapshotNormalizedYaml !== pendingSnapshotAdoptionYaml) {
        setManualYamlOverride(null);
        setPendingSnapshotAdoptionYaml(null);
        return;
      }
    }
    if (
      snapshotIdentity?.resourceVersion &&
      snapshotIdentity.resourceVersion === latestObjectIdentity.resourceVersion
    ) {
      setManualYamlOverride(null);
      setPendingSnapshotAdoptionYaml(null);
      return;
    }
  }, [
    latestObjectIdentity,
    manualYamlOverride,
    pendingSnapshotAdoptionYaml,
    verifiedPostApply,
    yamlContent,
  ]);

  const activeYaml = isEditing ? draftYaml : (displayYaml ?? '');

  const driftDiff = useMemo(() => {
    if (backendDriftCurrentYaml) {
      return buildYamlTabDiff(backendDriftCurrentYaml, draftYaml);
    }
    if (!isEditing || (!hasRemoteDrift && !driftForced)) {
      return null;
    }
    const latestYaml = displayYaml ?? '';
    if (!latestYaml) {
      return null;
    }
    return buildYamlTabDiff(latestYaml, draftYaml);
  }, [backendDriftCurrentYaml, displayYaml, draftYaml, driftForced, hasRemoteDrift, isEditing]);

  const { theme: codeMirrorTheme, highlight: highlightExtension } = useMemo(
    () => buildCodeTheme(isDarkTheme),
    [isDarkTheme]
  );

  const searchExtensions = useMemo<Extension[]>(
    () => createSearchExtensions({ enableKeymap: false }),
    []
  );

  const baseEditorExtensions = useMemo<Extension[]>(() => {
    return [yamlLang(), EditorView.lineWrapping, highlightExtension, ...searchExtensions];
  }, [highlightExtension, searchExtensions]);

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

  const focusSearchInput = useCallback(
    (useSelection: boolean): boolean => {
      if (!isActive) {
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

  const toggleDiffExpansion = useCallback((diffKey: string) => {
    setExpandedDiffs((current) => ({
      ...current,
      [diffKey]: !current[diffKey],
    }));
  }, []);

  useEffect(() => {
    if (!postApplyNotice || postApplyNotice.kind !== 'warning' || manualYamlOverride) {
      return;
    }
    setPostApplyNotice(null);
  }, [manualYamlOverride, postApplyNotice]);

  useEffect(() => {
    if (!verifiedPostApply || isEditing || manualYamlOverride || !yamlContent) {
      return;
    }

    const snapshotYaml = normalizeYamlString(yamlContent);
    const snapshotIdentity = parseObjectIdentity(snapshotYaml);
    if (!snapshotIdentity || !isSameObjectReference(snapshotIdentity, verifiedPostApply.identity)) {
      setVerifiedPostApply(null);
      setPostApplyNotice((current) => (current?.kind === 'stale' ? null : current));
      return;
    }

    const verifiedResourceVersion = verifiedPostApply.identity.resourceVersion ?? null;
    const snapshotResourceVersion = snapshotIdentity.resourceVersion ?? null;
    if (
      !verifiedResourceVersion ||
      !snapshotResourceVersion ||
      snapshotResourceVersion === verifiedResourceVersion
    ) {
      setPostApplyNotice((current) => (current?.kind === 'stale' ? null : current));
      return;
    }

    const snapshotSemanticYaml = sanitizeYamlForSemanticCompare(snapshotYaml);
    if (snapshotSemanticYaml === verifiedPostApply.semanticYaml) {
      setPostApplyNotice((current) => (current?.kind === 'stale' ? null : current));
      return;
    }

    setPostApplyNotice({
      kind: 'stale',
      message:
        'The live object changed again after save. Review the diff below for later controller mutations or concurrent edits.',
      diff: buildYamlTabDiff(verifiedPostApply.semanticYaml, snapshotSemanticYaml),
    });
  }, [isEditing, manualYamlOverride, verifiedPostApply, yamlContent]);

  const hydrateLatestObject = useCallback(
    async (identity: ObjectIdentity) => {
      // Always go through the GVK-aware fetch. parseObjectIdentity (the
      // sole producer of ObjectIdentity in this component) refuses to
      // return an identity without an apiVersion, so the kind-only
      // fallback that used to live here was unreachable. Removing it
      // closes the last frontend caller of the legacy first-match-wins
      // resolver.
      if (!identity.apiVersion) {
        throw new Error(
          `Cannot fetch latest YAML for ${identity.kind}/${identity.name}: apiVersion missing`
        );
      }
      const latestYamlRaw = await GetObjectYAMLByGVK(
        resolvedClusterId,
        identity.apiVersion,
        identity.kind,
        identity.namespace ?? '',
        identity.name
      );
      const normalizedYaml = normalizeYamlString(latestYamlRaw);
      const parsedIdentity = parseObjectIdentity(normalizedYaml);
      const resolvedIdentity: ObjectIdentity = parsedIdentity
        ? {
            ...parsedIdentity,
            resourceVersion: parsedIdentity.resourceVersion ?? identity.resourceVersion ?? null,
          }
        : {
            apiVersion: identity.apiVersion,
            kind: identity.kind,
            name: identity.name,
            namespace: identity.namespace ?? null,
            uid: identity.uid ?? null,
            resourceVersion: identity.resourceVersion ?? null,
          };

      setLatestObjectIdentity(resolvedIdentity);
      setManualYamlOverride({
        yaml: normalizedYaml,
        resourceVersion: resolvedIdentity.resourceVersion,
      });
      return { latestIdentity: resolvedIdentity, normalizedYaml };
    },
    [resolvedClusterId]
  );

  const handleEditorCreated = useCallback(
    (view: EditorView) => {
      editorViewRef.current = view;
      setSearchTerm('');
      applySearchQuery(view, '');
      closeSearchPanel(view);
      if (isEditing) {
        window.requestAnimationFrame(() => view.focus());
      }
    },
    [applySearchQuery, isEditing]
  );

  useEffect(() => {
    const view = editorRef.current?.view;
    if (view) {
      editorViewRef.current = view;
      setSearchTerm('');
      applySearchQuery(view, '');
      closeSearchPanel(view);
    }
  }, [activeYaml, applySearchQuery]);

  useEffect(() => {
    applySearchQuery(editorViewRef.current, searchTerm);
  }, [applySearchQuery, searchTerm]);

  useSearchShortcutTarget({
    isActive,
    focus: () => focusSearchInput(true),
    priority: 30,
    label: 'YAML tab search',
  });

  useKeyboardSurface({
    kind: 'editor',
    rootRef: editorSurfaceRef,
    active: isActive,
    onEscape: () => {
      if (!isEditing || isSaving) {
        return false;
      }
      handleCancelClick();
      return true;
    },
    onNativeAction: ({ action, text }) => {
      if (action === 'copy') {
        return copyCodeMirrorSelection(editorViewRef.current);
      }
      if (action === 'selectAll') {
        return selectCodeMirrorContent(editorViewRef.current);
      }
      if (action !== 'paste' || !isEditing || isSaving || typeof text !== 'string') {
        return false;
      }
      const view = editorViewRef.current;
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
    },
  });

  useEffect(() => {
    if (!isEditing) {
      return;
    }
    const view = editorViewRef.current;
    if (view) {
      window.requestAnimationFrame(() => view.focus());
    }
  }, [isEditing]);

  const previousShowManagedRef = useRef(showManagedFields);
  const previousOverrideYamlRef = useRef(manualYamlOverride?.yaml ?? null);
  const skipNextOverrideDraftSyncRef = useRef(false);

  useEffect(() => {
    if (!isEditing) {
      previousShowManagedRef.current = showManagedFields;
      previousOverrideYamlRef.current = manualYamlOverride?.yaml ?? null;
      return;
    }
    const showChanged = previousShowManagedRef.current !== showManagedFields;
    const overrideYaml = manualYamlOverride?.yaml ?? null;
    const overrideChanged = previousOverrideYamlRef.current !== overrideYaml;
    previousShowManagedRef.current = showManagedFields;
    previousOverrideYamlRef.current = overrideYaml;
    if (skipNextOverrideDraftSyncRef.current && overrideChanged && !showChanged) {
      skipNextOverrideDraftSyncRef.current = false;
      return;
    }
    if (!showChanged && !overrideChanged) {
      return;
    }
    const sourceYaml = manualYamlOverride?.yaml ?? displayYaml ?? '';
    setDraftYaml(prepareDraftYaml(sourceYaml, showManagedFields));
  }, [displayYaml, isEditing, manualYamlOverride, showManagedFields]);

  useEffect(() => {
    if (!isEditing) {
      setHasRemoteDrift(false);
      setBackendDriftCurrentYaml(null);
      setDriftForced(false);
      setExpandedDiffs({});
      return;
    }

    if (driftForced) {
      setHasRemoteDrift(true);
      return;
    }

    const currentVersion =
      latestObjectIdentity?.resourceVersion ?? objectIdentity?.resourceVersion ?? null;
    if (!baselineResourceVersion || !currentVersion) {
      setHasRemoteDrift(false);
      setBackendDriftCurrentYaml(null);
      return;
    }
    const driftDetected = currentVersion !== baselineResourceVersion;
    setHasRemoteDrift(driftDetected);
    if (!driftDetected) {
      setBackendDriftCurrentYaml(null);
    }
  }, [baselineResourceVersion, driftForced, isEditing, latestObjectIdentity, objectIdentity]);

  useEffect(() => {
    if (!isEditing) {
      setLintError(null);
      return;
    }
    const timeout = window.setTimeout(() => {
      const validation = validateYamlDraft(
        draftYaml,
        baselineIdentity ?? latestObjectIdentity ?? objectIdentity ?? null,
        baselineResourceVersion
      );
      setLintError(validation.isValid ? null : validation.message);
    }, LINT_DEBOUNCE_MS);
    return () => window.clearTimeout(timeout);
  }, [
    baselineIdentity,
    baselineResourceVersion,
    draftYaml,
    isEditing,
    latestObjectIdentity,
    objectIdentity,
  ]);

  useEffect(
    () => () => {
      editorViewRef.current = null;
    },
    []
  );

  const handleEditorChange = useCallback(
    (value: string) => {
      if (!isEditing) {
        return;
      }
      setDraftYaml(value);
      setActionError(null);
      setActionDetails([]);
      setHasServerYamlError(false);
    },
    [isEditing]
  );

  const handleToggleManagedFields = useCallback(() => {
    setShowManagedFields((prev) => !prev);
  }, []);

  const handleEnterEdit = useCallback(() => {
    if (!canEdit) {
      return;
    }
    const identityForEditing = latestObjectIdentity ?? objectIdentity ?? null;
    if (!identityForEditing) {
      setActionError('Unable to resolve object identity. Reload the tab and try again.');
      setActionDetails([]);
      return;
    }

    const seedYaml = manualYamlOverride?.yaml ?? displayYaml ?? '';
    const preparedDraft = prepareDraftYaml(normalizeYamlString(seedYaml), showManagedFields);

    setDraftYaml(preparedDraft);
    setBaselineIdentity(identityForEditing);
    setBaselineResourceVersion(identityForEditing.resourceVersion ?? null);
    setBaselineMergeYaml(preparedDraft);
    setLintError(null);
    setActionError(null);
    setActionDetails([]);
    setHasRemoteDrift(false);
    setDriftForced(false);
    setBackendDriftCurrentYaml(null);
    setPostApplyNotice(null);
    setPendingSnapshotAdoptionYaml(null);
    setHasServerYamlError(false);
    setExpandedDiffs({});
    setLatestObjectIdentity(identityForEditing);
    setManualYamlOverride(
      (current) =>
        current ?? {
          yaml: normalizeYamlString(seedYaml),
          resourceVersion: identityForEditing.resourceVersion ?? null,
        }
    );
    setIsEditing(true);
  }, [
    canEdit,
    displayYaml,
    latestObjectIdentity,
    manualYamlOverride,
    objectIdentity,
    showManagedFields,
  ]);

  const exitEditMode = useCallback(() => {
    setIsEditing(false);
    setDraftYaml('');
    setBaselineIdentity(null);
    setBaselineResourceVersion(null);
    setBaselineMergeYaml('');
    setLintError(null);
    setActionError(null);
    setActionDetails([]);
    setHasRemoteDrift(false);
    setDriftForced(false);
    setBackendDriftCurrentYaml(null);
    setIsSaving(false);
    setHasServerYamlError(false);
    setExpandedDiffs({});
    setPendingSnapshotAdoptionYaml(null);
  }, []);

  const previousScopeRef = useRef(scope);
  useEffect(() => {
    const previousScope = previousScopeRef.current;
    previousScopeRef.current = scope;

    if (!isEditing) {
      return;
    }

    if (scope) {
      return;
    }

    if (previousScope && !scope) {
      setPostApplyNotice(null);
      exitEditMode();
    }
  }, [exitEditMode, isEditing, scope]);

  const handleCancelClick = useCallback(() => {
    if (isSaving) {
      return;
    }
    setPostApplyNotice(null);
    exitEditMode();
  }, [exitEditMode, isSaving]);

  const handleReloadAndMerge = useCallback(async () => {
    if (isSaving || !effectiveIdentity) {
      return;
    }

    try {
      const mergeBaseYaml =
        baselineMergeYaml ||
        prepareDraftYaml(
          normalizeYamlString(manualYamlOverride?.yaml ?? displayYaml ?? ''),
          showManagedFields
        );
      const mergeResult = await mergeYamlWithLatestOnServer(
        resolvedClusterId,
        mergeBaseYaml,
        draftYaml,
        effectiveIdentity
      );
      const normalizedLatestYaml = normalizeYamlString(mergeResult.currentYAML);
      const preparedLatestYaml = prepareDraftYaml(normalizedLatestYaml, showManagedFields);
      const mergedDraftYaml = prepareDraftYaml(
        normalizeYamlString(mergeResult.mergedYAML),
        showManagedFields
      );
      const parsedIdentity = parseObjectIdentity(normalizedLatestYaml);
      const latestIdentity: ObjectIdentity = parsedIdentity
        ? {
            ...parsedIdentity,
            resourceVersion: parsedIdentity.resourceVersion ?? mergeResult.resourceVersion ?? null,
          }
        : {
            apiVersion: effectiveIdentity.apiVersion,
            kind: effectiveIdentity.kind,
            name: effectiveIdentity.name,
            namespace: effectiveIdentity.namespace ?? null,
            uid: effectiveIdentity.uid ?? null,
            resourceVersion: mergeResult.resourceVersion ?? null,
          };

      skipNextOverrideDraftSyncRef.current = true;
      setBaselineIdentity(latestIdentity);
      setBaselineResourceVersion(latestIdentity.resourceVersion ?? null);
      setBaselineMergeYaml(preparedLatestYaml);
      setDraftYaml(mergedDraftYaml);
      setLatestObjectIdentity(latestIdentity);
      setManualYamlOverride({
        yaml: normalizedLatestYaml,
        resourceVersion: latestIdentity.resourceVersion ?? null,
      });
      setLintError(null);
      setActionError(null);
      setActionDetails([]);
      setHasRemoteDrift(false);
      setDriftForced(false);
      setBackendDriftCurrentYaml(null);
      setPostApplyNotice(null);
      setVerifiedPostApply(null);
      setPendingSnapshotAdoptionYaml(null);
      setHasServerYamlError(false);

      if (scope) {
        await refreshOrchestrator.fetchScopedDomain('object-yaml', scope, { isManual: true });
      }
    } catch (err) {
      const objectYamlError = parseObjectYamlError(err);
      if (objectYamlError) {
        setActionError(objectYamlError.message);
        setActionDetails(objectYamlError.causes ?? []);
        setHasRemoteDrift(true);
        setDriftForced(true);
        setHasServerYamlError(false);
        if (objectYamlError.currentYaml) {
          setBackendDriftCurrentYaml(
            prepareDraftYaml(normalizeYamlString(objectYamlError.currentYaml), showManagedFields)
          );
        }
      } else {
        const message = err instanceof Error ? err.message : 'Failed to reload latest YAML.';
        setActionError(message);
        setActionDetails([]);
      }
      errorHandler.handle(err, { action: 'reloadAndMerge' });
    }
  }, [
    baselineMergeYaml,
    displayYaml,
    draftYaml,
    effectiveIdentity,
    isSaving,
    manualYamlOverride,
    resolvedClusterId,
    scope,
    showManagedFields,
  ]);

  const handleSaveClick = useCallback(async () => {
    if (!isEditing || isSaving) {
      return;
    }
    const identity = effectiveIdentity;
    if (!identity) {
      setActionError('Unable to resolve object identity. Reload and try again.');
      return;
    }

    const validation = validateYamlDraft(draftYaml, identity, baselineResourceVersion);
    if (!validation.isValid) {
      setLintError(validation.message);
      return;
    }

    const baselineYaml =
      baselineMergeYaml ||
      prepareDraftYaml(
        normalizeYamlString(manualYamlOverride?.yaml ?? displayYaml ?? ''),
        showManagedFields
      );

    setIsSaving(true);
    setActionError(null);

    try {
      const snapshotYamlBeforeSave = normalizeYamlString(yamlContent);
      setPendingSnapshotAdoptionYaml(snapshotYamlBeforeSave);
      const applyResponse = await applyYamlOnServer(
        resolvedClusterId,
        baselineYaml,
        validation.normalizedYAML,
        identity,
        baselineResourceVersion ?? identity.resourceVersion ?? ''
      );
      const appliedResourceVersion =
        applyResponse?.resourceVersion ??
        validation.resourceVersion ??
        baselineResourceVersion ??
        identity.resourceVersion ??
        '';
      const immediateYaml = applyResourceVersionToYaml(
        validation.normalizedYAML,
        appliedResourceVersion
      );
      setLatestObjectIdentity({
        ...identity,
        resourceVersion: appliedResourceVersion,
      });
      setManualYamlOverride({
        yaml: immediateYaml,
        resourceVersion: appliedResourceVersion,
      });

      try {
        const { latestIdentity, normalizedYaml } = await hydrateLatestObject(identity);
        const submittedYaml = sanitizeYamlForSemanticCompare(immediateYaml);
        const storedYaml = sanitizeYamlForSemanticCompare(normalizedYaml);
        if (verifiedPostApply?.semanticYaml) {
          recentVerifiedSemanticYamlsRef.current = [
            {
              reference: buildObjectReferenceKey(verifiedPostApply.identity),
              semanticYaml: verifiedPostApply.semanticYaml,
            },
            ...recentVerifiedSemanticYamlsRef.current.filter(
              (entry) =>
                !(
                  entry.reference === buildObjectReferenceKey(verifiedPostApply.identity) &&
                  entry.semanticYaml === verifiedPostApply.semanticYaml
                )
            ),
          ].slice(0, 4);
        }
        setVerifiedPostApply({
          identity: latestIdentity,
          semanticYaml: storedYaml,
        });
        if (submittedYaml !== storedYaml) {
          setPostApplyNotice({
            kind: 'diff',
            message:
              'Your changes were applied to the latest live object, which also included other changes made while you were editing. Review the diff below to see how the final stored object differs from the exact YAML you submitted.',
            diff: buildYamlTabDiff(submittedYaml, storedYaml),
          });
        } else {
          setPostApplyNotice(null);
        }
      } catch (fetchErr) {
        setVerifiedPostApply(null);
        setPostApplyNotice({
          kind: 'warning',
          message:
            'YAML applied, but the editor could not reload the final live object. The manifest shown here is the submitted YAML with the returned resourceVersion, not a verified live read.',
          diff: null,
        });
        errorHandler.handle(fetchErr, { action: 'loadLatestObjectYAML' });
      }
      exitEditMode();
      setPendingSnapshotAdoptionYaml(snapshotYamlBeforeSave);
      if (scope) {
        await refreshOrchestrator.fetchScopedDomain('object-yaml', scope, { isManual: true });
      }
      setActionDetails([]);
    } catch (err) {
      const parsed = parseObjectYamlError(err);
      if (parsed) {
        setActionError(parsed.message);
        setActionDetails(parsed.causes ?? []);
        setHasServerYamlError(true);
        errorHandler.handle(err, { action: 'saveObjectYAML' });
        setPendingSnapshotAdoptionYaml(null);
        setIsSaving(false);
        return;
      }

      const message = err instanceof Error ? err.message : 'Failed to save YAML changes.';
      setActionError(message);
      setActionDetails([]);
      setPostApplyNotice(null);
      setVerifiedPostApply(null);
      setPendingSnapshotAdoptionYaml(null);
      setHasServerYamlError(false);
      errorHandler.handle(err, { action: 'saveObjectYAML' });
    } finally {
      setIsSaving(false);
    }
  }, [
    baselineMergeYaml,
    baselineResourceVersion,
    displayYaml,
    draftYaml,
    effectiveIdentity,
    exitEditMode,
    hydrateLatestObject,
    isEditing,
    isSaving,
    manualYamlOverride,
    resolvedClusterId,
    scope,
    showManagedFields,
    yamlContent,
    verifiedPostApply,
  ]);

  const editorKeyBindings = useMemo<KeyBinding[]>(() => {
    const bindings: KeyBinding[] = [
      {
        key: 'Mod-f',
        run: () => focusSearchInput(true),
      },
      {
        key: 'Shift-Mod-f',
        run: () => focusSearchInput(true),
      },
      {
        key: 'Mod-s',
        preventDefault: true,
        run: () => {
          if (!isEditing || isSaving) {
            return false;
          }
          handleSaveClick();
          return true;
        },
      },
      {
        key: 'Escape',
        run: () => {
          if (!isEditing || isSaving) {
            return false;
          }
          handleCancelClick();
          return true;
        },
      },
    ];
    return bindings;
  }, [focusSearchInput, handleCancelClick, handleSaveClick, isEditing, isSaving]);

  const editorKeymapExtension = useMemo<Extension>(
    () => keymap.of(editorKeyBindings),
    [editorKeyBindings]
  );

  // --- Right-click context menu for the CodeMirror editor ---
  // Use a ref so the CM extension callback always sees the latest isEditing value.
  const isEditingRef = useRef(isEditing);
  useEffect(() => {
    isEditingRef.current = isEditing;
  }, [isEditing]);

  const handleContextMenuClose = useCallback(() => setContextMenu(null), []);

  const contextMenuExtension = useMemo<Extension>(
    () =>
      EditorView.domEventHandlers({
        contextmenu: (event: MouseEvent, view: EditorView) => {
          event.preventDefault();

          // Snapshot selected text before the menu steals focus.
          const selectedText =
            getCodeMirrorSelectedText(view) || deriveCopyText(window.getSelection()) || '';
          const hasSelection = !!selectedText;
          const editing = isEditingRef.current;

          const items: ContextMenuItem[] = [];

          if (editing) {
            items.push({
              label: 'Cut',
              disabled: !hasSelection,
              onClick: () => {
                if (!selectedText) return;
                navigator.clipboard.writeText(selectedText);
                const { from, to } = view.state.selection.main;
                if (from !== to) {
                  view.dispatch({ changes: { from, to, insert: '' } });
                }
              },
            });
          }

          items.push({
            label: 'Copy',
            disabled: !hasSelection,
            onClick: () => {
              if (selectedText) {
                navigator.clipboard.writeText(selectedText);
              }
            },
          });

          if (editing) {
            items.push({
              label: 'Paste',
              onClick: () => {
                navigator.clipboard
                  .readText()
                  .then((text) => {
                    if (!text) return;
                    const { from, to } = view.state.selection.main;
                    view.dispatch({
                      changes: { from, to, insert: text },
                      selection: EditorSelection.cursor(from + text.length),
                    });
                    view.focus();
                  })
                  .catch(() => {});
              },
            });
          }

          items.push({ divider: true });

          items.push({
            label: 'Select All',
            onClick: () => {
              // Use DOM selection so it works in both read-only and edit modes.
              const cmContent = view.contentDOM;
              const sel = window.getSelection();
              if (sel && cmContent) {
                sel.removeAllRanges();
                const range = document.createRange();
                range.selectNodeContents(cmContent);
                sel.addRange(range);
              }
            },
          });

          setContextMenu({
            position: { x: event.clientX, y: event.clientY },
            items,
          });
          return true;
        },
      }),
    []
  );

  const editorExtensions = useMemo<Extension[]>(
    () => [...baseEditorExtensions, editorKeymapExtension, contextMenuExtension],
    [baseEditorExtensions, editorKeymapExtension, contextMenuExtension]
  );

  useShortcut({
    key: 's',
    modifiers: { meta: true },
    handler: () => {
      if (!isEditing || isSaving) {
        return false;
      }
      handleSaveClick();
      return true;
    },
    description: 'Save YAML changes',
    category: 'YAML Tab',
    enabled: isEditing && !isSaving,
    priority: 30,
  });

  useShortcut({
    key: 's',
    modifiers: { ctrl: true },
    handler: () => {
      if (!isEditing || isSaving) {
        return false;
      }
      handleSaveClick();
      return true;
    },
    description: 'Save YAML changes',
    category: 'YAML Tab',
    enabled: isEditing && !isSaving,
    priority: 30,
  });

  useShortcut({
    key: 'Escape',
    handler: () => {
      if (!isEditing || isSaving) {
        return false;
      }
      handleCancelClick();
      return true;
    },
    description: 'Cancel YAML edit',
    category: 'YAML Tab',
    enabled: isEditing && !isSaving,
    priority: 30,
  });

  const hasYamlError = Boolean(lintError) || hasServerYamlError;
  const disableSave = isSaving || hasYamlError;
  const searchIconBarItems = useMemo<IconBarItem[]>(
    () => [
      {
        type: 'action',
        id: 'search-previous',
        icon: <CollapseIcon />,
        onClick: handleFindPrevious,
        title: 'Previous match',
        ariaLabel: 'Previous match',
        disabled: !searchTerm,
      },
      {
        type: 'action',
        id: 'search-next',
        icon: <OpenIcon />,
        onClick: handleFindNext,
        title: 'Next match',
        ariaLabel: 'Next match',
        disabled: !searchTerm,
      },
      {
        type: 'toggle',
        id: 'case-sensitive-search',
        icon: <CaseSensitiveIcon width={16} height={16} />,
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
        type: 'toggle',
        id: 'regex-search',
        icon: <RegexSearchIcon />,
        active: searchState.regexMatches,
        onClick: () =>
          setSearchState((current) => ({
            ...current,
            regexMatches: !current.regexMatches,
            caseSensitiveMatches: !current.regexMatches ? false : current.caseSensitiveMatches,
          })),
        title: 'Enable regular expression search',
        ariaLabel: 'Enable regular expression search',
      },
      { type: 'separator' },
      {
        type: 'toggle',
        id: 'managed-fields',
        icon: <YamlManagedFieldsIcon />,
        active: showManagedFields,
        onClick: handleToggleManagedFields,
        title: showManagedFields ? 'Hide managedFields' : 'Show managedFields',
        ariaLabel: showManagedFields ? 'Hide managedFields' : 'Show managedFields',
      },
      ...(isEditing
        ? [
            {
              type: 'action' as const,
              id: 'cancel-edit',
              icon: <YamlCancelIcon />,
              onClick: handleCancelClick,
              title: 'Cancel edit',
              ariaLabel: 'Cancel edit',
              disabled: isSaving,
            },
            {
              type: 'action' as const,
              id: 'save-yaml',
              icon: <YamlSaveIcon />,
              onClick: handleSaveClick,
              title: isSaving ? 'Saving YAML' : 'Save YAML',
              ariaLabel: 'Save YAML',
              disabled: disableSave,
            },
          ]
        : canEdit
          ? [
              {
                type: 'action' as const,
                id: 'edit-yaml',
                icon: <YamlEditIcon />,
                onClick: handleEnterEdit,
                title: 'Edit YAML',
                ariaLabel: 'Edit YAML',
              },
            ]
          : []),
    ],
    [
      canEdit,
      disableSave,
      handleCancelClick,
      handleEnterEdit,
      handleFindNext,
      handleFindPrevious,
      handleSaveClick,
      handleToggleManagedFields,
      isEditing,
      isSaving,
      searchTerm,
      searchState,
      showManagedFields,
    ]
  );

  if (yamlLoading) {
    return (
      <div className="object-panel-tab-content">
        <LoadingSpinner message="Loading YAML..." />
      </div>
    );
  }

  if (yamlError) {
    return (
      <div className="object-panel-tab-content">
        <div className="yaml-display-error">
          <div className="error-message">Error loading YAML: {yamlError}</div>
        </div>
      </div>
    );
  }

  if (!yamlContent) {
    return (
      <div className="object-panel-tab-content">
        <div className="yaml-display-empty">
          <p>No YAML content available</p>
        </div>
      </div>
    );
  }

  const showReloadMergeConflict = Boolean(backendDriftCurrentYaml) || driftForced;
  const driftDiffKey = backendDriftCurrentYaml ? 'drift-backend' : 'drift-live';
  const postApplyDiffKey = postApplyNotice ? `post-apply-${postApplyNotice.kind}` : 'post-apply';
  const isLargeManifest = activeYaml.length > LARGE_MANIFEST_THRESHOLD;
  return (
    <div className="object-panel-tab-content">
      <div className="yaml-display">
        <div className="yaml-header">
          <div className="yaml-search-controls">
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
            </div>
            <IconBar items={searchIconBarItems} />
          </div>
          {isEditing && hasRemoteDrift && (
            <div className="yaml-controls">
              <button
                className="button secondary"
                type="button"
                onClick={handleReloadAndMerge}
                disabled={isSaving}
              >
                Reload &amp; merge
              </button>
            </div>
          )}
        </div>
        {isEditing && (lintError || actionError || showReloadMergeConflict) && (
          <div className="yaml-validation-message">
            {showReloadMergeConflict && (
              <>
                <div className="yaml-notice-header">
                  <p>
                    Reload &amp; merge could not reconcile your draft with the latest YAML. Your
                    draft is unchanged. Save will still patch your edited fields onto the live
                    object, like kubectl edit.
                  </p>
                  {driftDiff &&
                    renderYamlDiffToggle(
                      driftDiff,
                      driftDiffKey,
                      Boolean(expandedDiffs[driftDiffKey]),
                      toggleDiffExpansion
                    )}
                </div>
                {driftDiff &&
                  renderYamlDiff(driftDiff, driftDiffKey, Boolean(expandedDiffs[driftDiffKey]))}
                {driftDiff?.tooLarge && (
                  <p className="yaml-drift-warning">
                    {driftDiff.tooLargeMessage ??
                      'This diff is too large to display in the current view.'}{' '}
                    Reload the YAML to review the latest version before retrying.
                  </p>
                )}
              </>
            )}
            {lintError && <p>{lintError}</p>}
            {actionError && (!lintError || actionError !== lintError) && <p>{actionError}</p>}
            {actionDetails.length > 0 && (
              <ul className="yaml-error-details">
                {actionDetails.map((detail, index) => (
                  <li key={`detail-${index}`}>{detail}</li>
                ))}
              </ul>
            )}
          </div>
        )}
        {!isEditing && postApplyNotice && (
          <div
            className={`yaml-post-apply-notice yaml-post-apply-notice-${postApplyNotice.kind}`}
            role="status"
            aria-live="polite"
          >
            <div className="yaml-notice-header">
              <p>{postApplyNotice.message}</p>
              <div className="yaml-notice-actions">
                {postApplyNotice.diff &&
                  renderYamlDiffToggle(
                    postApplyNotice.diff,
                    postApplyDiffKey,
                    Boolean(expandedDiffs[postApplyDiffKey]),
                    toggleDiffExpansion
                  )}
                <button
                  className="yaml-notice-close"
                  type="button"
                  aria-label="Close diff notice"
                  onClick={() => setPostApplyNotice(null)}
                >
                  <CloseIcon width={14} height={14} />
                </button>
              </div>
            </div>
            {postApplyNotice.diff &&
              renderYamlDiff(
                postApplyNotice.diff,
                postApplyDiffKey,
                Boolean(expandedDiffs[postApplyDiffKey])
              )}
            {postApplyNotice.diff?.tooLarge && (
              <p className="yaml-drift-warning">
                {postApplyNotice.diff.tooLargeMessage ??
                  'The post-apply diff is too large to display in the current view.'}
              </p>
            )}
          </div>
        )}
        <div className="yaml-content">
          {isLargeManifest && (
            <div className="yaml-editor-notice">
              Large manifest detected. Editor performance may be reduced while editing.
            </div>
          )}
          <div ref={editorSurfaceRef} className="codemirror-shell">
            <CodeMirror
              ref={editorRef}
              value={isEditing ? draftYaml : (displayYaml ?? '')}
              height="100%"
              editable={isEditing && !isSaving}
              basicSetup={{
                highlightActiveLine: true,
                highlightActiveLineGutter: true,
                lineNumbers: true,
                foldGutter: false,
                searchKeymap: false,
              }}
              theme={codeMirrorTheme}
              extensions={editorExtensions}
              onChange={handleEditorChange}
              onCreateEditor={handleEditorCreated}
            />
          </div>
          {contextMenu && (
            <ContextMenu
              items={contextMenu.items}
              position={contextMenu.position}
              onClose={handleContextMenuClose}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default YamlTab;
