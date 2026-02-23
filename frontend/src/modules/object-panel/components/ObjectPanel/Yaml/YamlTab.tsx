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
import { useShortcut, useSearchShortcutTarget } from '@ui/shortcuts';
import { errorHandler } from '@utils/errorHandler';
import { refreshOrchestrator } from '@/core/refresh';
import { useRefreshScopedDomain } from '@/core/refresh/store';
import { GetObjectYAML } from '@wailsjs/go/backend/App';
import './YamlTab.css';
import { parseObjectIdentity, validateYamlDraft, type ObjectIdentity } from './yamlValidation';
import { computeLineDiff, type DiffResult } from './yamlDiff';
import { coerceDiffResult, parseObjectYamlError } from './yamlErrors';
import { buildCodeTheme } from '@/core/codemirror/theme';
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
  validateYamlOnServer,
  applyYamlOnServer,
} from './yamlTabUtils';

export type { YamlTabProps } from './yamlTabTypes';

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
  const [hasRemoteDrift, setHasRemoteDrift] = useState(false);
  const [driftForced, setDriftForced] = useState(false);
  const [backendDriftDiff, setBackendDriftDiff] = useState<DiffResult | null>(null);
  const [latestObjectIdentity, setLatestObjectIdentity] = useState<ObjectIdentity | null>(null);
  const [manualYamlOverride, setManualYamlOverride] = useState<{
    yaml: string;
    resourceVersion: string | null;
  } | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [hasServerYamlError, setHasServerYamlError] = useState(false);

  const editorRef = useRef<ReactCodeMirrorRef>(null);
  const editorViewRef = useRef<EditorView | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

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

  // Enable/disable the scoped domain based on tab activity. preserveState
  // keeps the store entry alive when the tab unmounts so diagnostics can still
  // see it. Full cleanup (reset) is handled by ObjectPanelContent when the
  // panel closes.
  useEffect(() => {
    if (!scope) {
      return undefined;
    }

    const enabled = isActive;
    refreshOrchestrator.setScopedDomainEnabled('object-yaml', scope, enabled);
    if (enabled) {
      void refreshOrchestrator.fetchScopedDomain('object-yaml', scope, { isManual: true });
    }

    return () => {
      refreshOrchestrator.setScopedDomainEnabled('object-yaml', scope, false, {
        preserveState: true,
      });
    };
  }, [scope, isActive]);

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
    view: 'global',
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
    const snapshotIdentity = parseObjectIdentity(yamlContent);
    if (
      snapshotIdentity?.resourceVersion &&
      snapshotIdentity.resourceVersion === latestObjectIdentity.resourceVersion
    ) {
      setManualYamlOverride(null);
    }
  }, [latestObjectIdentity, manualYamlOverride, yamlContent]);

  const activeYaml = isEditing ? draftYaml : (displayYaml ?? '');

  const driftDiff = useMemo(() => {
    if (backendDriftDiff) {
      return backendDriftDiff;
    }
    if (!isEditing || (!hasRemoteDrift && !driftForced)) {
      return null;
    }
    const latestYaml = displayYaml ?? '';
    if (!latestYaml) {
      return null;
    }
    return computeLineDiff(latestYaml, draftYaml);
  }, [backendDriftDiff, displayYaml, draftYaml, driftForced, hasRemoteDrift, isEditing]);

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
      } else if (event.key === 'Escape') {
        event.preventDefault();
        searchInputRef.current?.blur();
        editorViewRef.current?.focus();
      }
    },
    [handleFindNext, handleFindPrevious]
  );

  useEffect(() => {
    if (!manualYamlOverride) {
      return;
    }
    const snapshotIdentity = parseObjectIdentity(yamlContent);
    if (
      snapshotIdentity?.resourceVersion &&
      snapshotIdentity.resourceVersion === manualYamlOverride.resourceVersion
    ) {
      setManualYamlOverride(null);
    }
  }, [manualYamlOverride, yamlContent]);

  const hydrateLatestObject = useCallback(
    async (identity: ObjectIdentity) => {
      const latestYamlRaw = await GetObjectYAML(
        resolvedClusterId,
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

  useSearchShortcutTarget({
    isActive,
    focus: () => focusSearchInput(true),
    priority: 30,
    label: 'YAML tab search',
  });

  useEffect(() => {
    if (!manualYamlOverride) {
      return;
    }
    const snapshotIdentity = parseObjectIdentity(yamlContent);
    if (
      snapshotIdentity?.resourceVersion &&
      manualYamlOverride.resourceVersion &&
      snapshotIdentity.resourceVersion === manualYamlOverride.resourceVersion
    ) {
      setManualYamlOverride(null);
    }
  }, [manualYamlOverride, yamlContent]);

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
    if (!showChanged && !overrideChanged) {
      return;
    }
    const sourceYaml = manualYamlOverride?.yaml ?? displayYaml ?? '';
    setDraftYaml(prepareDraftYaml(sourceYaml, showManagedFields));
  }, [displayYaml, isEditing, manualYamlOverride, showManagedFields]);

  useEffect(() => {
    if (!isEditing) {
      setHasRemoteDrift(false);
      setBackendDriftDiff(null);
      setDriftForced(false);
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
      setBackendDriftDiff(null);
      return;
    }
    const driftDetected = currentVersion !== baselineResourceVersion;
    setHasRemoteDrift(driftDetected);
    if (!driftDetected) {
      setBackendDriftDiff(null);
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

  const handleToggleManagedFields = () => {
    setShowManagedFields((prev) => !prev);
  };

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
    setLintError(null);
    setActionError(null);
    setActionDetails([]);
    setHasRemoteDrift(false);
    setDriftForced(false);
    setBackendDriftDiff(null);
    setHasServerYamlError(false);
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
    setLintError(null);
    setActionError(null);
    setActionDetails([]);
    setHasRemoteDrift(false);
    setDriftForced(false);
    setBackendDriftDiff(null);
    setIsSaving(false);
    setHasServerYamlError(false);
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
      exitEditMode();
    }
  }, [exitEditMode, isEditing, scope]);

  const handleCancelClick = useCallback(() => {
    if (isSaving) {
      return;
    }
    exitEditMode();
  }, [exitEditMode, isSaving]);

  const handleReloadAndMerge = useCallback(async () => {
    if (isSaving || !effectiveIdentity) {
      return;
    }

    try {
      const { latestIdentity, normalizedYaml } = await hydrateLatestObject(effectiveIdentity);

      setBaselineIdentity(latestIdentity);
      setBaselineResourceVersion(latestIdentity.resourceVersion ?? null);
      setDraftYaml(prepareDraftYaml(normalizedYaml, showManagedFields));
      setLintError(null);
      setActionError(null);
      setActionDetails([]);
      setHasRemoteDrift(false);
      setDriftForced(false);
      setBackendDriftDiff(null);
      setHasServerYamlError(false);

      if (scope) {
        await refreshOrchestrator.fetchScopedDomain('object-yaml', scope, { isManual: true });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to reload latest YAML.';
      setActionError(message);
      setActionDetails([]);
      errorHandler.handle(err, { action: 'reloadAndMerge' });
    }
  }, [effectiveIdentity, hydrateLatestObject, isSaving, scope, showManagedFields]);

  const handleSaveClick = useCallback(async () => {
    if (!isEditing || isSaving) {
      return;
    }
    if (hasRemoteDrift) {
      setActionError(
        'The object changed while you were editing. Reload to avoid overwriting someone else’s changes.'
      );
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

    const baselineVersion = baselineResourceVersion ?? identity.resourceVersion ?? null;
    if (!baselineVersion) {
      setActionError('metadata.resourceVersion is required to save changes. Reload and try again.');
      return;
    }

    setIsSaving(true);
    setActionError(null);

    try {
      const validationResponse = await validateYamlOnServer(
        resolvedClusterId,
        validation.normalizedYAML,
        identity,
        baselineVersion
      );

      const resourceVersionForApply = validationResponse?.resourceVersion ?? baselineVersion;

      let payloadForApply = validation.normalizedYAML;
      if (
        validationResponse?.resourceVersion &&
        validationResponse.resourceVersion !== baselineVersion
      ) {
        payloadForApply = applyResourceVersionToYaml(
          validation.normalizedYAML,
          validationResponse.resourceVersion
        );
        setDraftYaml(prepareDraftYaml(payloadForApply, showManagedFields));
      }

      const applyResponse = await applyYamlOnServer(
        resolvedClusterId,
        payloadForApply,
        identity,
        resourceVersionForApply
      );
      const appliedResourceVersion = applyResponse?.resourceVersion ?? resourceVersionForApply;
      const immediateYaml = applyResourceVersionToYaml(payloadForApply, appliedResourceVersion);
      setLatestObjectIdentity({
        ...identity,
        resourceVersion: appliedResourceVersion,
      });
      setManualYamlOverride({
        yaml: immediateYaml,
        resourceVersion: appliedResourceVersion,
      });

      try {
        await hydrateLatestObject(identity);
      } catch (fetchErr) {
        const fallbackYaml = applyResourceVersionToYaml(payloadForApply, appliedResourceVersion);
        setManualYamlOverride({
          yaml: fallbackYaml,
          resourceVersion: appliedResourceVersion,
        });
        errorHandler.handle(fetchErr, { action: 'loadLatestObjectYAML' });
      }
      exitEditMode();
      if (scope) {
        await refreshOrchestrator.fetchScopedDomain('object-yaml', scope, { isManual: true });
      }
      setActionDetails([]);
    } catch (err) {
      const parsed = parseObjectYamlError(err);
      if (parsed) {
        if (parsed.code === 'ResourceVersionMismatch') {
          setDriftForced(true);
          setHasRemoteDrift(true);
          setActionError(parsed.message);
          setLintError(null);
          if (parsed.currentResourceVersion) {
            setBaselineResourceVersion(parsed.currentResourceVersion);
          }
          const backendDiff = coerceDiffResult(parsed);
          setBackendDriftDiff(backendDiff);
          setActionDetails(parsed.causes ?? []);
          setHasServerYamlError(false);
        } else {
          setActionError(parsed.message);
          setActionDetails(parsed.causes ?? []);
          setHasServerYamlError(true);
        }
        errorHandler.handle(err, { action: 'saveObjectYAML' });
        setIsSaving(false);
        return;
      }

      const message = err instanceof Error ? err.message : 'Failed to save YAML changes.';
      setActionError(message);
      setActionDetails([]);
      setHasServerYamlError(false);
      errorHandler.handle(err, { action: 'saveObjectYAML' });
    } finally {
      setIsSaving(false);
    }
  }, [
    baselineResourceVersion,
    draftYaml,
    effectiveIdentity,
    exitEditMode,
    hydrateLatestObject,
    hasRemoteDrift,
    isEditing,
    isSaving,
    resolvedClusterId,
    scope,
    showManagedFields,
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
        key: 'Mod-v',
        preventDefault: true,
        run: (view) => {
          if (!isEditing || isSaving) {
            return false;
          }
          if (typeof navigator === 'undefined' || !navigator.clipboard?.readText) {
            return false;
          }
          void navigator.clipboard
            .readText()
            .then((text) => {
              if (!isEditing || isSaving) {
                return;
              }
              const content = text ?? '';
              view.dispatch(
                view.state.changeByRange((range) => ({
                  changes: { from: range.from, to: range.to, insert: content },
                  range: EditorSelection.cursor(range.from + content.length),
                }))
              );
              view.focus();
            })
            .catch(() => {
              // Ignore clipboard read failures; default paste already prevented.
            });
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

  const editorExtensions = useMemo<Extension[]>(
    () => [...baseEditorExtensions, editorKeymapExtension],
    [baseEditorExtensions, editorKeymapExtension]
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
    view: 'global',
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
    view: 'global',
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
    view: 'global',
    priority: 30,
  });

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

  const hasYamlError = Boolean(lintError) || hasServerYamlError;
  const disableSave = isSaving || hasRemoteDrift || hasYamlError;
  const saveDisabledReason = hasYamlError
    ? (lintError ?? actionError ?? undefined)
    : hasRemoteDrift
      ? 'The object changed while you were editing. Reload to continue.'
      : undefined;
  const isLargeManifest = activeYaml.length > LARGE_MANIFEST_THRESHOLD;
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
            {!isEditing ? (
              <>
                <button className="button generic" onClick={handleToggleManagedFields}>
                  {showManagedFields ? 'Hide' : 'Show'} managedFields
                </button>
                {canEdit && (
                  <button className="button generic" onClick={handleEnterEdit}>
                    Edit
                  </button>
                )}
              </>
            ) : (
              <>
                <button className="button cancel" onClick={handleCancelClick} disabled={isSaving}>
                  Cancel
                </button>
                <button
                  className="button save"
                  onClick={handleSaveClick}
                  disabled={disableSave}
                  title={saveDisabledReason}
                >
                  {isSaving ? 'Saving…' : 'Save'}
                </button>
              </>
            )}
          </div>
        </div>
        {isEditing && (lintError || actionError || hasRemoteDrift) && (
          <div className="yaml-validation-message">
            {hasRemoteDrift && (
              <>
                <p>
                  The object changed while you were editing. Reload the YAML to continue, otherwise
                  you risk overwriting a newer version.
                </p>
                <div className="yaml-merge-actions">
                  <button
                    className="button secondary"
                    type="button"
                    onClick={handleReloadAndMerge}
                    disabled={isSaving}
                  >
                    Reload &amp; merge
                  </button>
                </div>
                {driftDiff && !driftDiff.truncated && driftDiff.lines.length > 0 && (
                  <div className="yaml-drift-diff" role="status" aria-live="polite">
                    <pre>
                      {driftDiff.lines.map((line, index) => {
                        const prefix =
                          line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' ';
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
                            key={`diff-${index}`}
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
                )}
                {driftDiff?.truncated && (
                  <p className="yaml-drift-warning">
                    The diff is too large to display. Reload the YAML to review the latest version
                    before retrying.
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
        <div className="yaml-content">
          {isLargeManifest && (
            <div className="yaml-editor-notice">
              Large manifest detected. Editor performance may be reduced while editing.
            </div>
          )}
          <div className="codemirror-shell">
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
        </div>
      </div>
    </div>
  );
};

export default YamlTab;
