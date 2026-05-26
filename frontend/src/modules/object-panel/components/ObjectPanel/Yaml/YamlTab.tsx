/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Yaml/YamlTab.tsx
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as YAML from 'yaml';
import ClusterDataPausedState from '@shared/components/ClusterDataPausedState';
import LoadingSpinner from '@shared/components/LoadingSpinner';
import { CloseIcon } from '@shared/components/icons/SharedIcons';
import IconBar, { type IconBarItem } from '@shared/components/IconBar/IconBar';
import { useShortcut } from '@ui/shortcuts';
import { errorHandler } from '@utils/errorHandler';
import { readObjectYAMLByGVK, requestData, requestRefreshDomain } from '@/core/data-access';
import { refreshOrchestrator } from '@/core/refresh';
import { useAutoRefreshLoadingState } from '@/core/refresh/hooks/useAutoRefreshLoadingState';
import { applyPassiveLoadingPolicy } from '@/core/refresh/loadingPolicy';
import { useRefreshScopedDomain } from '@/core/refresh/store';
import type { DiffLine } from '@shared/components/diff/lineDiff';
import { computeBudgetedLineDiff } from '@shared/components/diff/lineDiff';
import { YAML_TAB_DIFF_BUDGETS } from '@shared/components/diff/diffBudgets';
import { formatTooLargeDiffMessage } from '@shared/components/diff/diffUtils';
import './YamlTab.css';
import { parseObjectIdentity, validateYamlDraft, type ObjectIdentity } from './yamlValidation';
import { parseObjectYamlError } from './yamlErrors';
import { resolveProtectedYamlRanges } from './yamlFieldPolicy';
import { YamlEditor, type YamlEditorHandle } from '@shared/components/yaml';

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
import {
  YamlCancelIcon,
  YamlEditIcon,
  YamlManagedFieldsIcon,
  YamlSaveIcon,
} from '@shared/components/icons/YamlIcons';

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
  editDisabledReason = null,
  clusterId,
}) => {
  const { isPaused, isManualRefreshActive } = useAutoRefreshLoadingState();
  const [isEditing, setIsEditing] = useState(false);
  const [showManagedFields, setShowManagedFields] = useState(false);
  const [draftYaml, setDraftYaml] = useState('');
  const [lintError, setLintError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionDetails, setActionDetails] = useState<string[]>([]);
  const [protectedEditMessage, setProtectedEditMessage] = useState<string | null>(null);
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
  const [hasServerYamlError, setHasServerYamlError] = useState(false);
  const [expandedDiffs, setExpandedDiffs] = useState<Record<string, boolean>>({});

  const yamlEditorRef = useRef<YamlEditorHandle>(null);
  const recentVerifiedSemanticYamlsRef = useRef<RecentVerifiedSemanticEntry[]>([]);

  const effectiveScope = scope ?? INACTIVE_SCOPE;
  const snapshot = useRefreshScopedDomain('object-yaml', effectiveScope);
  const resolvedClusterId = clusterId?.trim() ?? '';

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
      void requestRefreshDomain({
        domain: 'object-yaml',
        scope,
        reason: 'startup',
      });
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
  const yamlLoadingState = applyPassiveLoadingPolicy({
    loading:
      snapshot.status === 'loading' ||
      snapshot.status === 'initialising' ||
      (snapshot.status === 'updating' && !yamlContent),
    hasLoaded: Boolean(snapshot.data),
    hasData: Boolean(yamlContent),
    isPaused,
    isManualRefreshActive,
  });
  const yamlLoading = yamlLoadingState.loading;
  const showPausedYamlState = yamlLoadingState.showPausedEmptyState;
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

  const prepareVisibleDraftYaml = useCallback(
    (rawYaml: string) => prepareDraftYaml(rawYaml, showManagedFields),
    [showManagedFields]
  );

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
      const latestYamlResult = await requestData({
        resource: 'object-yaml-by-gvk',
        reason: 'user',
        read: () =>
          readObjectYAMLByGVK(
            resolvedClusterId,
            identity.apiVersion,
            identity.kind,
            identity.namespace ?? '',
            identity.name
          ),
      });
      const latestYamlRaw =
        latestYamlResult.status === 'executed' ? (latestYamlResult.data ?? '') : '';
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

  useEffect(() => {
    if (!isEditing) {
      return;
    }
    window.requestAnimationFrame(() => yamlEditorRef.current?.focus());
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
    if (!overrideChanged) {
      return;
    }
    const sourceYaml = manualYamlOverride?.yaml ?? effectiveYamlContent ?? displayYaml ?? '';
    setDraftYaml(prepareVisibleDraftYaml(sourceYaml));
  }, [
    displayYaml,
    effectiveYamlContent,
    isEditing,
    manualYamlOverride,
    prepareVisibleDraftYaml,
    showManagedFields,
  ]);

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

  const handleEditorChange = useCallback(
    (value: string) => {
      if (!isEditing) {
        return;
      }
      setDraftYaml(value);
      setActionError(null);
      setActionDetails([]);
      setProtectedEditMessage(null);
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

    const seedYaml = manualYamlOverride?.yaml ?? effectiveYamlContent ?? displayYaml ?? '';
    const preparedDraft = prepareVisibleDraftYaml(normalizeYamlString(seedYaml));

    setDraftYaml(preparedDraft);
    setBaselineIdentity(identityForEditing);
    setBaselineResourceVersion(identityForEditing.resourceVersion ?? null);
    setBaselineMergeYaml(preparedDraft);
    setLintError(null);
    setActionError(null);
    setActionDetails([]);
    setProtectedEditMessage(null);
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
    effectiveYamlContent,
    latestObjectIdentity,
    manualYamlOverride,
    objectIdentity,
    prepareVisibleDraftYaml,
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
        prepareVisibleDraftYaml(
          normalizeYamlString(manualYamlOverride?.yaml ?? effectiveYamlContent ?? displayYaml ?? '')
        );
      const mergeResult = await mergeYamlWithLatestOnServer(
        resolvedClusterId,
        mergeBaseYaml,
        draftYaml,
        effectiveIdentity
      );
      const normalizedLatestYaml = normalizeYamlString(mergeResult.currentYAML);
      const preparedLatestYaml = prepareVisibleDraftYaml(normalizedLatestYaml);
      const mergedDraftYaml = prepareVisibleDraftYaml(normalizeYamlString(mergeResult.mergedYAML));
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
      setProtectedEditMessage(null);
      setHasRemoteDrift(false);
      setDriftForced(false);
      setBackendDriftCurrentYaml(null);
      setPostApplyNotice(null);
      setVerifiedPostApply(null);
      setPendingSnapshotAdoptionYaml(null);
      setHasServerYamlError(false);

      if (scope) {
        await requestRefreshDomain({
          domain: 'object-yaml',
          scope,
          reason: 'user',
        });
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
            prepareVisibleDraftYaml(normalizeYamlString(objectYamlError.currentYaml))
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
    effectiveYamlContent,
    isSaving,
    manualYamlOverride,
    prepareVisibleDraftYaml,
    resolvedClusterId,
    scope,
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
      prepareVisibleDraftYaml(
        normalizeYamlString(manualYamlOverride?.yaml ?? effectiveYamlContent ?? displayYaml ?? '')
      );

    setIsSaving(true);
    setActionError(null);
    setProtectedEditMessage(null);

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
        await requestRefreshDomain({
          domain: 'object-yaml',
          scope,
          reason: 'user',
        });
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
    effectiveYamlContent,
    effectiveIdentity,
    exitEditMode,
    hydrateLatestObject,
    isEditing,
    isSaving,
    manualYamlOverride,
    prepareVisibleDraftYaml,
    resolvedClusterId,
    scope,
    yamlContent,
    verifiedPostApply,
  ]);

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
  const yamlToolbarItems = useMemo<IconBarItem[]>(
    () => [
      ...(!isEditing
        ? [
            {
              type: 'toggle' as const,
              id: 'managed-fields',
              icon: <YamlManagedFieldsIcon width={16} height={16} />,
              active: showManagedFields,
              onClick: handleToggleManagedFields,
              title: showManagedFields ? 'Hide managedFields' : 'Show managedFields',
              ariaLabel: showManagedFields ? 'Hide managedFields' : 'Show managedFields',
            },
          ]
        : []),
      ...(isEditing
        ? [
            {
              type: 'action' as const,
              id: 'cancel-edit',
              icon: <YamlCancelIcon width={16} height={16} />,
              onClick: handleCancelClick,
              title: 'Cancel edit',
              ariaLabel: 'Cancel edit',
              disabled: isSaving,
            },
            {
              type: 'action' as const,
              id: 'save-yaml',
              icon: <YamlSaveIcon width={16} height={16} />,
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
                icon: <YamlEditIcon width={16} height={16} />,
                onClick: handleEnterEdit,
                title: 'Edit YAML',
                ariaLabel: 'Edit YAML',
              },
            ]
          : editDisabledReason
            ? [
                {
                  type: 'action' as const,
                  id: 'edit-yaml-disabled',
                  icon: <YamlEditIcon width={16} height={16} />,
                  onClick: () => undefined,
                  title: editDisabledReason,
                  ariaLabel: `Edit YAML unavailable: ${editDisabledReason}`,
                  disabled: true,
                },
              ]
            : []),
    ],
    [
      canEdit,
      disableSave,
      editDisabledReason,
      handleCancelClick,
      handleEnterEdit,
      handleSaveClick,
      handleToggleManagedFields,
      isEditing,
      isSaving,
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

  if (showPausedYamlState) {
    return (
      <div className="object-panel-tab-content">
        <div className="yaml-display-empty">
          <ClusterDataPausedState />
        </div>
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
        {isEditing &&
          (lintError || actionError || protectedEditMessage || showReloadMergeConflict) && (
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
              {protectedEditMessage && <p>{protectedEditMessage}</p>}
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
        <YamlEditor
          ref={yamlEditorRef}
          value={isEditing ? draftYaml : (displayYaml ?? '')}
          onChange={handleEditorChange}
          editable={isEditing}
          disabled={isSaving}
          active={isActive}
          shortcutLabel="YAML tab search"
          shortcutPriority={30}
          ariaLabel="Object YAML editor"
          showSearchOptions
          protectedRangeResolver={
            isEditing ? (value) => resolveProtectedYamlRanges(value, 'edit') : undefined
          }
          onProtectedEditBlocked={setProtectedEditMessage}
          largeDocumentNotice={
            isLargeManifest
              ? 'Large manifest detected. Editor performance may be reduced while editing.'
              : null
          }
          toolbarActions={
            <>
              <IconBar items={yamlToolbarItems} />
              {isEditing && hasRemoteDrift && (
                <button
                  className="button secondary"
                  type="button"
                  onClick={handleReloadAndMerge}
                  disabled={isSaving}
                >
                  Reload &amp; merge
                </button>
              )}
            </>
          }
          onEscape={() => {
            if (!isEditing || isSaving) {
              return false;
            }
            handleCancelClick();
            return true;
          }}
        />
      </div>
    </div>
  );
};

export default YamlTab;
