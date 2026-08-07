/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Yaml/yamlTransaction.ts
 *
 * Owns the object YAML edit transaction: baseline capture, draft updates,
 * live reload/merge, apply, post-apply verification, and refresh ordering.
 */

import { YAML_TAB_DIFF_BUDGETS } from '@shared/components/diff/diffBudgets';
import { formatTooLargeDiffMessage } from '@shared/components/diff/diffUtils';
import type { DiffLine } from '@shared/components/diff/lineDiff';
import { computeBudgetedLineDiff } from '@shared/components/diff/lineDiff';
import { errorHandler } from '@utils/errorHandler';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  readObjectYAMLForRef,
  requestData,
  requestRefreshDomain,
  setRefreshDomainEnabled,
} from '@/core/data-access';
import { parseObjectYamlError } from './yamlErrors';
import { LINT_DEBOUNCE_MS } from './yamlTabConfig';
import {
  applyResourceVersionToYaml,
  applyYamlOnServer,
  checkYamlOwnershipOnServer,
  mergeYamlWithLatestOnServer,
  normalizeYamlString,
  type ObjectYamlOwnershipConflict,
  sanitizeYamlForSemanticCompare,
} from './yamlTabUtils';
import {
  type ObjectIdentity,
  parseObjectIdentity,
  type ValidationSuccess,
  validateYamlDraft,
} from './yamlValidation';

export type YamlTransactionDiffResult = {
  lines: DiffLine[];
  tooLarge: boolean;
  tooLargeMessage: string | null;
};

export type YamlPostApplyNotice = {
  kind: 'diff' | 'warning' | 'stale';
  message: string;
  diff: YamlTransactionDiffResult | null;
};

export type VerifiedPostApplyState = {
  identity: ObjectIdentity;
  semanticYaml: string;
};

export type RecentVerifiedSemanticEntry = {
  reference: string;
  semanticYaml: string;
};

type ManualYamlOverride = {
  yaml: string;
  resourceVersion: string | null;
};

// A save held back by the ownership warning. The dialog is modal, so the
// captured validated payload cannot go stale while it is open.
type PendingOwnershipWarning = {
  conflicts: ObjectYamlOwnershipConflict[];
  identity: ObjectIdentity;
  validation: ValidationSuccess;
  baselineYaml: string;
};

export interface UseYamlTransactionArgs {
  scope: string | null;
  isActive: boolean;
  canEdit: boolean;
  clusterId: string | null | undefined;
  yamlContent: string;
  showManagedFields: boolean;
  prepareVisibleDraftYaml: (rawYaml: string) => string;
}

export interface UseYamlTransactionResult {
  isEditing: boolean;
  draftYaml: string;
  lintError: string | null;
  actionError: string | null;
  actionDetails: string[];
  protectedEditMessage: string | null;
  setProtectedEditMessage: (message: string | null) => void;
  isSaving: boolean;
  effectiveYamlContent: string;
  effectiveIdentity: ObjectIdentity | null;
  hasRemoteDrift: boolean;
  driftForced: boolean;
  backendDriftCurrentYaml: string | null;
  postApplyNotice: YamlPostApplyNotice | null;
  dismissPostApplyNotice: () => void;
  hasServerYamlError: boolean;
  handleEditorChange: (value: string) => void;
  handleEnterEdit: () => void;
  handleCancelClick: () => void;
  handleReloadAndMerge: () => Promise<void>;
  handleSaveClick: () => Promise<void>;
  pendingOwnershipConflicts: ObjectYamlOwnershipConflict[] | null;
  confirmOwnershipAndSave: () => Promise<void>;
  cancelOwnershipWarning: () => void;
}

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

export const matchesVerifiedSnapshot = (
  snapshotYaml: string,
  verifiedPostApply: VerifiedPostApplyState,
  recentVerifiedSemanticYamls: RecentVerifiedSemanticEntry[]
): boolean => {
  const snapshotSemanticYaml = sanitizeYamlForSemanticCompare(snapshotYaml);
  if (snapshotSemanticYaml === verifiedPostApply.semanticYaml) {
    return true;
  }
  const currentObjectReference = buildObjectReferenceKey(verifiedPostApply.identity);
  return recentVerifiedSemanticYamls.some(
    (entry) =>
      entry.reference === currentObjectReference && entry.semanticYaml === snapshotSemanticYaml
  );
};

const shouldClearSameObjectOverride = ({
  snapshotYaml,
  snapshotIdentity,
  latestObjectIdentity,
  pendingSnapshotAdoptionYaml,
  verifiedPostApply,
  recentVerifiedSemanticYamls,
}: {
  snapshotYaml: string;
  snapshotIdentity: ObjectIdentity;
  latestObjectIdentity: ObjectIdentity;
  pendingSnapshotAdoptionYaml: string | null;
  verifiedPostApply: VerifiedPostApplyState | null;
  recentVerifiedSemanticYamls: RecentVerifiedSemanticEntry[];
}): boolean => {
  if (pendingSnapshotAdoptionYaml === snapshotYaml) {
    return false;
  }
  if (snapshotIdentity.resourceVersion === latestObjectIdentity.resourceVersion) {
    return Boolean(snapshotIdentity.resourceVersion);
  }
  if (verifiedPostApply) {
    return !matchesVerifiedSnapshot(snapshotYaml, verifiedPostApply, recentVerifiedSemanticYamls);
  }
  return Boolean(pendingSnapshotAdoptionYaml);
};

const shouldClearManualYamlOverride = ({
  snapshotYaml,
  snapshotIdentity,
  overrideIdentity,
  latestObjectIdentity,
  pendingSnapshotAdoptionYaml,
  verifiedPostApply,
  recentVerifiedSemanticYamls,
}: {
  snapshotYaml: string;
  snapshotIdentity: ObjectIdentity | null;
  overrideIdentity: ObjectIdentity | null;
  latestObjectIdentity: ObjectIdentity;
  pendingSnapshotAdoptionYaml: string | null;
  verifiedPostApply: VerifiedPostApplyState | null;
  recentVerifiedSemanticYamls: RecentVerifiedSemanticEntry[];
}): boolean => {
  if (
    snapshotIdentity &&
    overrideIdentity &&
    isSameObjectReference(snapshotIdentity, overrideIdentity)
  ) {
    return shouldClearSameObjectOverride({
      snapshotYaml,
      snapshotIdentity,
      latestObjectIdentity,
      pendingSnapshotAdoptionYaml,
      verifiedPostApply,
      recentVerifiedSemanticYamls,
    });
  }
  return Boolean(
    snapshotIdentity?.resourceVersion &&
      snapshotIdentity.resourceVersion === latestObjectIdentity.resourceVersion
  );
};

type PostApplySnapshotDecision =
  | { kind: 'ignore' }
  | { kind: 'reset' }
  | { kind: 'clear-stale' }
  | { kind: 'stale'; notice: YamlPostApplyNotice };

const classifyPostApplySnapshot = ({
  verifiedPostApply,
  isEditing,
  hasManualOverride,
  yamlContent,
}: {
  verifiedPostApply: VerifiedPostApplyState | null;
  isEditing: boolean;
  hasManualOverride: boolean;
  yamlContent: string;
}): PostApplySnapshotDecision => {
  if (!verifiedPostApply || isEditing || hasManualOverride || !yamlContent) {
    return { kind: 'ignore' };
  }
  const snapshotYaml = normalizeYamlString(yamlContent);
  const snapshotIdentity = parseObjectIdentity(snapshotYaml);
  if (!snapshotIdentity || !isSameObjectReference(snapshotIdentity, verifiedPostApply.identity)) {
    return { kind: 'reset' };
  }
  const verifiedResourceVersion = verifiedPostApply.identity.resourceVersion ?? null;
  const snapshotResourceVersion = snapshotIdentity.resourceVersion ?? null;
  if (
    !verifiedResourceVersion ||
    !snapshotResourceVersion ||
    snapshotResourceVersion === verifiedResourceVersion
  ) {
    return { kind: 'clear-stale' };
  }
  const snapshotSemanticYaml = sanitizeYamlForSemanticCompare(snapshotYaml);
  if (snapshotSemanticYaml === verifiedPostApply.semanticYaml) {
    return { kind: 'clear-stale' };
  }
  return {
    kind: 'stale',
    notice: {
      kind: 'stale',
      message:
        'The live object changed again after save. Review the diff below for later controller mutations or concurrent edits.',
      diff: buildYamlTransactionDiff(verifiedPostApply.semanticYaml, snapshotSemanticYaml),
    },
  };
};

const clearStalePostApplyNotice = (
  current: YamlPostApplyNotice | null
): YamlPostApplyNotice | null => (current?.kind === 'stale' ? null : current);

type PreparedYamlMerge = {
  normalizedLatestYaml: string;
  preparedLatestYaml: string;
  mergedDraftYaml: string;
  latestIdentity: ObjectIdentity;
};

const resolveMergedObjectIdentity = (
  normalizedLatestYaml: string,
  effectiveIdentity: ObjectIdentity,
  resourceVersion: string | null | undefined
): ObjectIdentity => {
  const parsedIdentity = parseObjectIdentity(normalizedLatestYaml);
  if (parsedIdentity) {
    return {
      ...parsedIdentity,
      resourceVersion: parsedIdentity.resourceVersion ?? resourceVersion ?? null,
    };
  }
  return {
    apiVersion: effectiveIdentity.apiVersion,
    kind: effectiveIdentity.kind,
    name: effectiveIdentity.name,
    namespace: effectiveIdentity.namespace ?? null,
    uid: effectiveIdentity.uid ?? null,
    resourceVersion: resourceVersion ?? null,
  };
};

const prepareYamlMerge = (
  mergeResult: Awaited<ReturnType<typeof mergeYamlWithLatestOnServer>>,
  effectiveIdentity: ObjectIdentity,
  prepareVisibleDraftYaml: (rawYaml: string) => string
): PreparedYamlMerge => {
  const normalizedLatestYaml = normalizeYamlString(mergeResult.currentYAML);
  return {
    normalizedLatestYaml,
    preparedLatestYaml: prepareVisibleDraftYaml(normalizedLatestYaml),
    mergedDraftYaml: prepareVisibleDraftYaml(normalizeYamlString(mergeResult.mergedYAML)),
    latestIdentity: resolveMergedObjectIdentity(
      normalizedLatestYaml,
      effectiveIdentity,
      mergeResult.resourceVersion
    ),
  };
};

const requestPreparedYamlMerge = async ({
  clusterId,
  baselineMergeYaml,
  sourceYaml,
  draftYaml,
  effectiveIdentity,
  prepareVisibleDraftYaml,
}: {
  clusterId: string;
  baselineMergeYaml: string;
  sourceYaml: string;
  draftYaml: string;
  effectiveIdentity: ObjectIdentity;
  prepareVisibleDraftYaml: (rawYaml: string) => string;
}): Promise<PreparedYamlMerge> => {
  const mergeBaseYaml =
    baselineMergeYaml || prepareVisibleDraftYaml(normalizeYamlString(sourceYaml));
  const mergeResult = await mergeYamlWithLatestOnServer(
    clusterId,
    mergeBaseYaml,
    draftYaml,
    effectiveIdentity
  );
  return prepareYamlMerge(mergeResult, effectiveIdentity, prepareVisibleDraftYaml);
};

type ReloadMergeError =
  | { kind: 'object-yaml'; parsed: NonNullable<ReturnType<typeof parseObjectYamlError>> }
  | { kind: 'generic'; message: string };

const classifyReloadMergeError = (error: unknown): ReloadMergeError => {
  const parsed = parseObjectYamlError(error);
  if (parsed) {
    return { kind: 'object-yaml', parsed };
  }
  return {
    kind: 'generic',
    message: error instanceof Error ? error.message : 'Failed to reload latest YAML.',
  };
};

const addRecentVerifiedYaml = (
  current: RecentVerifiedSemanticEntry[],
  verified: VerifiedPostApplyState | null
): RecentVerifiedSemanticEntry[] => {
  if (!verified) {
    return current;
  }
  const candidate = {
    reference: buildObjectReferenceKey(verified.identity),
    semanticYaml: verified.semanticYaml,
  };
  return [
    candidate,
    ...current.filter(
      (entry) =>
        entry.reference !== candidate.reference || entry.semanticYaml !== candidate.semanticYaml
    ),
  ].slice(0, 4);
};

const buildPostApplyDiffNotice = (
  submittedYaml: string,
  storedYaml: string
): YamlPostApplyNotice | null => {
  if (submittedYaml === storedYaml) {
    return null;
  }
  return {
    kind: 'diff',
    message:
      'Your changes were applied to the latest live object, which also included other changes made while you were editing. Review the diff below to see how the final stored object differs from the exact YAML you submitted.',
    diff: buildYamlTransactionDiff(submittedYaml, storedYaml),
  };
};

type PreparedSaveRequest =
  | { kind: 'ignore' }
  | { kind: 'identity-error' }
  | { kind: 'validation-error'; message: string }
  | {
      kind: 'ready';
      identity: ObjectIdentity;
      validation: ValidationSuccess;
      baselineYaml: string;
    };

const prepareSaveRequest = ({
  isEditing,
  isSaving,
  effectiveIdentity,
  draftYaml,
  baselineResourceVersion,
  baselineMergeYaml,
  sourceYaml,
  prepareVisibleDraftYaml,
}: {
  isEditing: boolean;
  isSaving: boolean;
  effectiveIdentity: ObjectIdentity | null;
  draftYaml: string;
  baselineResourceVersion: string | null;
  baselineMergeYaml: string;
  sourceYaml: string;
  prepareVisibleDraftYaml: (rawYaml: string) => string;
}): PreparedSaveRequest => {
  if (!isEditing || isSaving) {
    return { kind: 'ignore' };
  }
  if (!effectiveIdentity) {
    return { kind: 'identity-error' };
  }
  const validation = validateYamlDraft(draftYaml, effectiveIdentity, baselineResourceVersion);
  if (!validation.isValid) {
    return { kind: 'validation-error', message: validation.message };
  }
  const baselineYaml =
    baselineMergeYaml || prepareVisibleDraftYaml(normalizeYamlString(sourceYaml));
  return { kind: 'ready', identity: effectiveIdentity, validation, baselineYaml };
};

const checkYamlOwnershipFailOpen = async ({
  clusterId,
  baselineYaml,
  validation,
  identity,
  resourceVersion,
}: {
  clusterId: string;
  baselineYaml: string;
  validation: ValidationSuccess;
  identity: ObjectIdentity;
  resourceVersion: string;
}): Promise<ObjectYamlOwnershipConflict[]> => {
  try {
    const ownership = await checkYamlOwnershipOnServer(
      clusterId,
      baselineYaml,
      validation.normalizedYAML,
      identity,
      resourceVersion
    );
    return ownership?.conflicts ?? [];
  } catch (error) {
    errorHandler.handle(error, { action: 'checkYamlOwnership' });
    return [];
  }
};

const normalizeYamlTransactionDiff = (
  diff: YamlTransactionDiffResult
): YamlTransactionDiffResult => {
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

export const buildYamlTransactionDiff = (
  before: string,
  after: string
): YamlTransactionDiffResult => {
  const diff = computeBudgetedLineDiff(before, after, YAML_TAB_DIFF_BUDGETS);
  return normalizeYamlTransactionDiff({
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

export const useYamlTransaction = ({
  scope,
  isActive,
  canEdit,
  clusterId,
  yamlContent,
  showManagedFields,
  prepareVisibleDraftYaml,
}: UseYamlTransactionArgs): UseYamlTransactionResult => {
  const [isEditing, setIsEditing] = useState(false);
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
  const [postApplyNotice, setPostApplyNotice] = useState<YamlPostApplyNotice | null>(null);
  const [pendingOwnershipWarning, setPendingOwnershipWarning] =
    useState<PendingOwnershipWarning | null>(null);
  const [verifiedPostApply, setVerifiedPostApply] = useState<VerifiedPostApplyState | null>(null);
  const [pendingSnapshotAdoptionYaml, setPendingSnapshotAdoptionYaml] = useState<string | null>(
    null
  );
  const [latestObjectIdentity, setLatestObjectIdentity] = useState<ObjectIdentity | null>(null);
  const [manualYamlOverride, setManualYamlOverride] = useState<ManualYamlOverride | null>(null);
  const [hasServerYamlError, setHasServerYamlError] = useState(false);

  const recentVerifiedSemanticYamlsRef = useRef<RecentVerifiedSemanticEntry[]>([]);
  const previousShowManagedRef = useRef(showManagedFields);
  const previousOverrideYamlRef = useRef(manualYamlOverride?.yaml ?? null);
  const skipNextOverrideDraftSyncRef = useRef(false);
  const previousScopeRef = useRef(scope);

  const resolvedClusterId = clusterId?.trim() ?? '';
  const effectiveYamlContent = manualYamlOverride?.yaml ?? yamlContent;
  const objectIdentity = useMemo(
    () => parseObjectIdentity(effectiveYamlContent),
    [effectiveYamlContent]
  );
  const effectiveIdentity = baselineIdentity ?? latestObjectIdentity ?? objectIdentity ?? null;

  useEffect(() => {
    if (!scope) {
      return undefined;
    }

    const enabled = isActive && !isEditing;
    setRefreshDomainEnabled({ domain: 'object-yaml', scope, enabled });
    if (enabled) {
      void requestRefreshDomain({
        domain: 'object-yaml',
        scope,
        reason: 'startup',
      });
    }

    return () => {
      setRefreshDomainEnabled({
        domain: 'object-yaml',
        scope,
        enabled: false,
        preserveState: true,
      });
    };
  }, [scope, isActive, isEditing]);

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
      !shouldClearManualYamlOverride({
        snapshotYaml: snapshotNormalizedYaml,
        snapshotIdentity,
        overrideIdentity,
        latestObjectIdentity,
        pendingSnapshotAdoptionYaml,
        verifiedPostApply,
        recentVerifiedSemanticYamls: recentVerifiedSemanticYamlsRef.current,
      })
    ) {
      return;
    }
    setManualYamlOverride(null);
    setPendingSnapshotAdoptionYaml(null);
  }, [
    latestObjectIdentity,
    manualYamlOverride,
    pendingSnapshotAdoptionYaml,
    verifiedPostApply,
    yamlContent,
  ]);

  useEffect(() => {
    if (postApplyNotice?.kind !== 'warning' || manualYamlOverride) {
      return;
    }
    setPostApplyNotice(null);
  }, [manualYamlOverride, postApplyNotice]);

  useEffect(() => {
    const decision = classifyPostApplySnapshot({
      verifiedPostApply,
      isEditing,
      hasManualOverride: Boolean(manualYamlOverride),
      yamlContent,
    });
    if (decision.kind === 'ignore') {
      return;
    }
    if (decision.kind === 'reset') {
      setVerifiedPostApply(null);
      setPostApplyNotice(clearStalePostApplyNotice);
      return;
    }
    if (decision.kind === 'clear-stale') {
      setPostApplyNotice(clearStalePostApplyNotice);
      return;
    }
    setPostApplyNotice(decision.notice);
  }, [isEditing, manualYamlOverride, verifiedPostApply, yamlContent]);

  const hydrateLatestObject = useCallback(
    async (identity: ObjectIdentity) => {
      if (!identity.apiVersion) {
        throw new Error(
          `Cannot fetch latest YAML for ${identity.kind}/${identity.name}: apiVersion missing`
        );
      }
      const latestYamlResult = await requestData({
        resource: 'object-yaml-by-gvk',
        reason: 'user',
        read: () =>
          readObjectYAMLForRef({
            clusterId: resolvedClusterId,
            apiVersion: identity.apiVersion,
            kind: identity.kind,
            namespace: identity.namespace,
            name: identity.name,
          }),
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
    const sourceYaml = manualYamlOverride?.yaml ?? effectiveYamlContent ?? '';
    setDraftYaml(prepareVisibleDraftYaml(sourceYaml));
  }, [
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
    setPendingSnapshotAdoptionYaml(null);
    setPendingOwnershipWarning(null);
  }, []);

  useEffect(() => {
    const previousScope = previousScopeRef.current;
    previousScopeRef.current = scope;

    if (!isEditing) {
      return;
    }

    if (scope) {
      return;
    }

    // `scope` is falsy here (the guard above returned otherwise), so only the
    // transition out of a previous scope matters.
    if (previousScope) {
      setPostApplyNotice(null);
      exitEditMode();
    }
  }, [exitEditMode, isEditing, scope]);

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

    const seedYaml = manualYamlOverride?.yaml ?? effectiveYamlContent ?? '';
    const normalizedSeedYaml = normalizeYamlString(seedYaml);
    const preparedDraft = prepareVisibleDraftYaml(normalizedSeedYaml);

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
    setLatestObjectIdentity(identityForEditing);
    setManualYamlOverride(
      (current) =>
        current ?? {
          yaml: normalizedSeedYaml,
          resourceVersion: identityForEditing.resourceVersion ?? null,
        }
    );
    setIsEditing(true);
  }, [
    canEdit,
    effectiveYamlContent,
    latestObjectIdentity,
    manualYamlOverride,
    objectIdentity,
    prepareVisibleDraftYaml,
  ]);

  const handleCancelClick = useCallback(() => {
    if (isSaving) {
      return;
    }
    setPostApplyNotice(null);
    exitEditMode();
  }, [exitEditMode, isSaving]);

  const handleReloadMergeError = useCallback(
    (caughtError: unknown) => {
      const error = classifyReloadMergeError(caughtError);
      if (error.kind === 'object-yaml') {
        setActionError(error.parsed.message);
        setActionDetails(error.parsed.causes ?? []);
        setHasRemoteDrift(true);
        setDriftForced(true);
        setHasServerYamlError(false);
        if (error.parsed.currentYaml) {
          setBackendDriftCurrentYaml(
            prepareVisibleDraftYaml(normalizeYamlString(error.parsed.currentYaml))
          );
        }
      } else {
        setActionError(error.message);
        setActionDetails([]);
      }
      errorHandler.handle(caughtError, { action: 'reloadAndMerge' });
    },
    [prepareVisibleDraftYaml]
  );

  const handleReloadAndMerge = useCallback(async () => {
    if (isSaving || !effectiveIdentity) {
      return;
    }

    try {
      const { normalizedLatestYaml, preparedLatestYaml, mergedDraftYaml, latestIdentity } =
        await requestPreparedYamlMerge({
          clusterId: resolvedClusterId,
          baselineMergeYaml,
          sourceYaml: manualYamlOverride?.yaml ?? yamlContent,
          draftYaml,
          effectiveIdentity,
          prepareVisibleDraftYaml,
        });

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
    } catch (error) {
      handleReloadMergeError(error);
    }
  }, [
    baselineMergeYaml,
    draftYaml,
    effectiveIdentity,
    handleReloadMergeError,
    isSaving,
    manualYamlOverride,
    prepareVisibleDraftYaml,
    resolvedClusterId,
    scope,
    yamlContent,
  ]);

  const verifyAppliedYaml = useCallback(
    async (identity: ObjectIdentity, immediateYaml: string) => {
      try {
        const { latestIdentity, normalizedYaml } = await hydrateLatestObject(identity);
        const submittedYaml = sanitizeYamlForSemanticCompare(immediateYaml);
        const storedYaml = sanitizeYamlForSemanticCompare(normalizedYaml);
        recentVerifiedSemanticYamlsRef.current = addRecentVerifiedYaml(
          recentVerifiedSemanticYamlsRef.current,
          verifiedPostApply
        );
        setVerifiedPostApply({
          identity: latestIdentity,
          semanticYaml: storedYaml,
        });
        setPostApplyNotice(buildPostApplyDiffNotice(submittedYaml, storedYaml));
      } catch (error) {
        setVerifiedPostApply(null);
        setPostApplyNotice({
          kind: 'warning',
          message:
            'YAML applied, but the editor could not reload the final live object. The manifest shown here is the submitted YAML with the returned resourceVersion, not a verified live read.',
          diff: null,
        });
        errorHandler.handle(error, { action: 'loadLatestObjectYAML' });
      }
    },
    [hydrateLatestObject, verifiedPostApply]
  );

  const handleSaveError = useCallback((caughtError: unknown) => {
    const parsed = parseObjectYamlError(caughtError);
    if (parsed) {
      setActionError(parsed.message);
      setActionDetails(parsed.causes ?? []);
      setHasServerYamlError(true);
      setPendingSnapshotAdoptionYaml(null);
      setIsSaving(false);
    } else {
      const message =
        caughtError instanceof Error ? caughtError.message : 'Failed to save YAML changes.';
      setActionError(message);
      setActionDetails([]);
      setPostApplyNotice(null);
      setVerifiedPostApply(null);
      setPendingSnapshotAdoptionYaml(null);
      setHasServerYamlError(false);
    }
    errorHandler.handle(caughtError, { action: 'saveObjectYAML' });
  }, []);

  const performSave = useCallback(
    async (identity: ObjectIdentity, validation: ValidationSuccess, baselineYaml: string) => {
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

        await verifyAppliedYaml(identity, immediateYaml);
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
      } catch (error) {
        handleSaveError(error);
      } finally {
        setIsSaving(false);
      }
    },
    [
      baselineResourceVersion,
      exitEditMode,
      handleSaveError,
      resolvedClusterId,
      scope,
      verifyAppliedYaml,
      yamlContent,
    ]
  );

  const handleSaveClick = useCallback(async () => {
    const request = prepareSaveRequest({
      isEditing,
      isSaving,
      effectiveIdentity,
      draftYaml,
      baselineResourceVersion,
      baselineMergeYaml,
      sourceYaml: manualYamlOverride?.yaml ?? yamlContent,
      prepareVisibleDraftYaml,
    });
    if (request.kind === 'ignore') {
      return;
    }
    if (request.kind === 'identity-error') {
      setActionError('Unable to resolve object identity. Reload and try again.');
      return;
    }
    if (request.kind === 'validation-error') {
      setLintError(request.message);
      return;
    }
    // Advisory ownership check: warn before taking ownership of fields that
    // controllers or operators manage. Never let a failed check block saving.
    setIsSaving(true);
    const ownershipConflicts = await checkYamlOwnershipFailOpen({
      clusterId: resolvedClusterId,
      baselineYaml: request.baselineYaml,
      validation: request.validation,
      identity: request.identity,
      resourceVersion: baselineResourceVersion ?? request.identity.resourceVersion ?? '',
    });
    if (ownershipConflicts.length > 0) {
      setIsSaving(false);
      setPendingOwnershipWarning({
        conflicts: ownershipConflicts,
        identity: request.identity,
        validation: request.validation,
        baselineYaml: request.baselineYaml,
      });
      return;
    }
    await performSave(request.identity, request.validation, request.baselineYaml);
  }, [
    baselineMergeYaml,
    baselineResourceVersion,
    draftYaml,
    effectiveIdentity,
    isEditing,
    isSaving,
    manualYamlOverride,
    performSave,
    prepareVisibleDraftYaml,
    resolvedClusterId,
    yamlContent,
  ]);

  const confirmOwnershipAndSave = useCallback(async () => {
    if (!pendingOwnershipWarning || isSaving) {
      return;
    }
    const { identity, validation, baselineYaml } = pendingOwnershipWarning;
    setPendingOwnershipWarning(null);
    await performSave(identity, validation, baselineYaml);
  }, [isSaving, pendingOwnershipWarning, performSave]);

  const cancelOwnershipWarning = useCallback(() => {
    setPendingOwnershipWarning(null);
  }, []);

  const dismissPostApplyNotice = useCallback(() => {
    setPostApplyNotice(null);
  }, []);

  return {
    isEditing,
    draftYaml,
    lintError,
    actionError,
    actionDetails,
    protectedEditMessage,
    setProtectedEditMessage,
    isSaving,
    effectiveYamlContent,
    effectiveIdentity,
    hasRemoteDrift,
    driftForced,
    backendDriftCurrentYaml,
    postApplyNotice,
    dismissPostApplyNotice,
    hasServerYamlError,
    handleEditorChange,
    handleEnterEdit,
    handleCancelClick,
    handleReloadAndMerge,
    handleSaveClick,
    pendingOwnershipConflicts: pendingOwnershipWarning?.conflicts ?? null,
    confirmOwnershipAndSave,
    cancelOwnershipWarning,
  };
};
