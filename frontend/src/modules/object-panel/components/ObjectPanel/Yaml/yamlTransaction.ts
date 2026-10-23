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
import { errorStatusOf } from '@utils/errorStatus';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  readObjectYAMLForRef,
  requestData,
  requestRefreshDomain,
  useScopedRefreshDomainLifecycle,
} from '@/core/data-access';
import { compareDriftFields, copyDriftField, type DriftField } from './yamlDriftFields';
import { hasUnsavedYamlEdits } from './yamlPanelGuard';
import { LINT_DEBOUNCE_MS } from './yamlTabConfig';
import {
  applyResourceVersionToYaml,
  applyYamlOnServer,
  checkYamlOwnershipOnServer,
  mergeYamlWithLatestOnServer,
  normalizeYamlString,
  type ObjectYamlConflict,
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
};

type YamlEditBaseline = { identity: ObjectIdentity; yaml: string };

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
  hasRemoteDrift: boolean;
  driftForced: boolean;
  backendDriftCurrentYaml: string | null;
  /** The live object was deleted and recreated (new uid) since editing began. */
  objectReplaced: boolean;
  /** Fields someone else changed since editing began, with the draft's values. */
  driftFields: DriftField[];
  /** While editing, the draft holds edits Save would apply. */
  hasUnsavedEdits: boolean;
  /** The value chosen for each field both sides changed, by field key. */
  driftChoices: ReadonlyMap<string, DriftChoiceView>;
  /** Why drift keeps Save unavailable, or null. */
  saveBlockedReason: string | null;
  /** Why merging the live changes into the draft is unavailable, or null. */
  mergeBlockedReason: string | null;
  /** Copies their value of a field both sides changed into the draft. */
  chooseTheirs: (field: DriftField) => void;
  /** Keeps your value of a field both sides changed, restoring it after theirs. */
  chooseYours: (field: DriftField) => void;
  /** Discards the draft and edits the recreated object instead. */
  editNewObject: () => void;
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

// The conflict code for an object deleted and recreated since editing began
// (backend/object_yaml_mutation.go, backend/object_yaml_reload_merge.go).
const OBJECT_REPLACED_CONFLICT_CODE = 'ObjectUIDMismatch';

/**
 * The live object differs from the edit baseline in content the user edits,
 * not only in status or server-managed metadata (the field policy's semantic
 * compare), so routine controller churn is not drift.
 */
const differsFromBaseline = (baselineYaml: string, liveYaml: string): boolean =>
  sanitizeYamlForSemanticCompare(baselineYaml) !==
  sanitizeYamlForSemanticCompare(normalizeYamlString(liveYaml));

/** The live object has the edited object's name but a different uid. */
const isReplacementOf = (baseline: ObjectIdentity | null, live: ObjectIdentity | null): boolean =>
  Boolean(baseline?.uid && live?.uid && baseline.uid !== live.uid);

/** A conflict's live object, and the watched snapshot when the conflict arrived. */
type ConflictLiveObject = { yaml: string; watchedYaml: string };

// The live YAML the drift notice compares with: a conflict's live object until
// the watched snapshot changes, or the watched snapshot once it has drifted
// from the baseline or been replaced. A conflict starts a read that cancels
// any read already out, so the watched snapshot changes only with a read sent
// after the conflict. (resourceVersions are opaque, so they are not ordered.)
const driftLiveYamlOf = ({
  isEditing,
  conflictLiveObject,
  watchedYaml,
  hasRemoteDrift,
  objectReplaced,
  liveYaml,
}: {
  isEditing: boolean;
  conflictLiveObject: ConflictLiveObject | null;
  watchedYaml: string;
  hasRemoteDrift: boolean;
  objectReplaced: boolean;
  liveYaml: string;
}): string | null => {
  if (conflictLiveObject?.watchedYaml === watchedYaml) {
    return conflictLiveObject.yaml;
  }
  return isEditing && (hasRemoteDrift || objectReplaced) ? liveYaml : null;
};

export type DriftChoice = 'theirs' | 'yours';

/** A field's chosen value, and your value to show while theirs is chosen. */
export type DriftChoiceView = { choice: DriftChoice; yours: string | undefined };

/**
 * A choice on a field both sides changed, made while their value was `now`.
 * `yoursDraftYaml` is a draft holding your value, to restore it from.
 */
type ConflictChoice = DriftChoiceView & { now: string | undefined; yoursDraftYaml: string };

// A choice holds while their value is unchanged and the draft still matches
// it: theirs while the draft has their value, yours while it has another.
const choiceOf = (
  field: DriftField,
  choices: ReadonlyMap<string, ConflictChoice>
): ConflictChoice | null => {
  const recorded = choices.get(field.key);
  if (!recorded || recorded.now !== field.now) {
    return null;
  }
  return (recorded.choice === 'yours') === field.conflict ? recorded : null;
};

// Records `choice` on `field`. While the field is a conflict the draft holds
// your value; once theirs is in the draft, the earlier record still does.
const withChoice = (
  choices: ReadonlyMap<string, ConflictChoice>,
  field: DriftField,
  choice: DriftChoice,
  draftYaml: string
): ReadonlyMap<string, ConflictChoice> => {
  const recorded = choices.get(field.key);
  const held =
    field.conflict || !recorded
      ? { yours: field.draft, yoursDraftYaml: draftYaml }
      : { yours: recorded.yours, yoursDraftYaml: recorded.yoursDraftYaml };
  return new Map(choices).set(field.key, { choice, now: field.now, ...held });
};

const fieldList = (fields: DriftField[]): string => fields.map((field) => field.label).join(', ');

type DriftGates = {
  driftChoices: ReadonlyMap<string, DriftChoiceView>;
  /** Fields where your value was chosen over theirs. */
  yoursFields: DriftField[];
  saveBlockedReason: string | null;
  mergeBlockedReason: string | null;
};

// A field both sides changed blocks Save and Merge until a value is chosen.
const resolveDriftGates = (
  fields: DriftField[],
  choices: ReadonlyMap<string, ConflictChoice>,
  objectReplaced: boolean
): DriftGates => {
  const driftChoices = new Map<string, DriftChoiceView>();
  const undecided: DriftField[] = [];
  const yoursFields: DriftField[] = [];
  for (const field of fields) {
    const chosen = choiceOf(field, choices);
    if (chosen) {
      driftChoices.set(field.key, { choice: chosen.choice, yours: chosen.yours });
    } else if (field.conflict) {
      undecided.push(field);
    }
    if (chosen?.choice === 'yours') {
      yoursFields.push(field);
    }
  }
  const choiceNeeded =
    undecided.length > 0
      ? `You both changed ${fieldList(undecided)}. Choose which value to keep.`
      : null;
  return {
    driftChoices,
    yoursFields,
    saveBlockedReason: objectReplaced
      ? 'The object was recreated, so this draft cannot be saved to it.'
      : choiceNeeded,
    mergeBlockedReason: choiceNeeded,
  };
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

const resolveYamlIdentity = (
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
    latestIdentity: resolveYamlIdentity(
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
}): Promise<PreparedYamlMergeResult> => {
  const mergeBaseYaml =
    baselineMergeYaml || prepareVisibleDraftYaml(normalizeYamlString(sourceYaml));
  const mergeResult = await mergeYamlWithLatestOnServer(
    clusterId,
    mergeBaseYaml,
    draftYaml,
    effectiveIdentity
  );
  if (mergeResult.yamlConflict) {
    return { kind: 'conflict', conflict: mergeResult.yamlConflict };
  }
  return {
    kind: 'merged',
    merge: prepareYamlMerge(mergeResult, effectiveIdentity, prepareVisibleDraftYaml),
  };
};

// A YAML conflict (the object changed or was replaced) is an outcome the user
// resolves in the editor, so it arrives as data, never as an error.
type PreparedYamlMergeResult =
  | { kind: 'conflict'; conflict: ObjectYamlConflict }
  | { kind: 'merged'; merge: PreparedYamlMerge };

// The message and field causes of a failed request, read from the backend
// status when there is one.
const describeRequestFailure = (error: unknown, fallback: string) => {
  const status = errorStatusOf(error);
  return {
    message: status?.message ?? (error instanceof Error ? error.message : fallback),
    causes: status?.details?.causes ?? [],
    // The YAML itself, or the version it was edited from, must change before
    // saving again.
    rejectsYaml: status?.category === 'VALIDATION' || status?.category === 'CONFLICT',
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
  baselineMergeYaml,
  sourceYaml,
  prepareVisibleDraftYaml,
}: {
  isEditing: boolean;
  isSaving: boolean;
  effectiveIdentity: ObjectIdentity | null;
  draftYaml: string;
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
  const validation = validateYamlDraft(draftYaml, effectiveIdentity);
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
    // A yamlConflict here is left to Apply, which returns the same outcome.
    return ownership?.conflicts ?? [];
  } catch (error) {
    // Advisory and fail-open: report without a toast; Apply's outcome is the
    // one result the user sees for this save.
    errorHandler.handleOperational(error, { action: 'checkYamlOwnership' });
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

const buildYamlTransactionDiff = (before: string, after: string): YamlTransactionDiffResult => {
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
  prepareVisibleDraftYaml,
}: UseYamlTransactionArgs): UseYamlTransactionResult => {
  const [isEditing, setIsEditing] = useState(false);
  // Live snapshot adoption must not replace edits; only editor actions own the draft.
  const [draftYaml, setDraftYaml] = useState('');
  const [lintError, setLintError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionDetails, setActionDetails] = useState<string[]>([]);
  const [protectedEditMessage, setProtectedEditMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [editBaseline, setEditBaseline] = useState<YamlEditBaseline | null>(null);
  const [hasRemoteDrift, setHasRemoteDrift] = useState(false);
  const [driftForced, setDriftForced] = useState(false);
  const [conflictLiveObject, setConflictLiveObject] = useState<ConflictLiveObject | null>(null);
  const [replacedByConflict, setReplacedByConflict] = useState(false);
  // Choices on fields both sides changed, by field key.
  const [conflictChoices, setConflictChoices] = useState<ReadonlyMap<string, ConflictChoice>>(
    () => new Map()
  );
  // Set by Edit the new object: edit again once the snapshot is a new object.
  const [restartFrom, setRestartFrom] = useState<{ uid: string | null } | null>(null);
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
  const previousScopeRef = useRef(scope);

  const resolvedClusterId = clusterId?.trim() ?? '';
  const effectiveYamlContent = manualYamlOverride?.yaml ?? yamlContent;
  const objectIdentity = useMemo(
    () => parseObjectIdentity(effectiveYamlContent),
    [effectiveYamlContent]
  );
  const baselineIdentity = editBaseline?.identity ?? null;
  const baselineResourceVersion = baselineIdentity?.resourceVersion ?? null;
  const baselineMergeYaml = editBaseline?.yaml ?? '';
  const effectiveIdentity = baselineIdentity ?? latestObjectIdentity ?? objectIdentity ?? null;
  const liveIdentity = latestObjectIdentity ?? objectIdentity ?? null;
  const objectReplaced =
    isEditing && (replacedByConflict || isReplacementOf(baselineIdentity, liveIdentity));
  // Read when a conflict arrives, which can be after an await.
  const watchedYamlRef = useRef(yamlContent);
  watchedYamlRef.current = yamlContent;
  const driftLiveYaml = driftLiveYamlOf({
    isEditing,
    conflictLiveObject,
    watchedYaml: yamlContent,
    hasRemoteDrift,
    objectReplaced,
    liveYaml: effectiveYamlContent,
  });
  const driftFields = useMemo(
    () =>
      isEditing && driftLiveYaml
        ? compareDriftFields({
            baselineYaml: baselineMergeYaml,
            liveYaml: driftLiveYaml,
            draftYaml,
          })
        : [],
    [baselineMergeYaml, draftYaml, driftLiveYaml, isEditing]
  );
  const hasUnsavedEdits = useMemo(
    () => isEditing && hasUnsavedYamlEdits(draftYaml, baselineMergeYaml),
    [baselineMergeYaml, draftYaml, isEditing]
  );
  const { driftChoices, yoursFields, saveBlockedReason, mergeBlockedReason } = useMemo(
    () => resolveDriftGates(driftFields, conflictChoices, objectReplaced),
    [driftFields, conflictChoices, objectReplaced]
  );

  // The tab keeps watching the object while editing, so a remote change shows
  // as drift right away. Live snapshots never touch the draft or its baseline;
  // only editor actions set them.
  useScopedRefreshDomainLifecycle({
    domain: 'object-yaml',
    scope,
    enabled: isActive,
    preserveState: true,
    fetchOnEnable: 'startup',
  });

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
      const resolvedIdentity = resolveYamlIdentity(
        normalizedYaml,
        identity,
        identity.resourceVersion
      );

      setLatestObjectIdentity(resolvedIdentity);
      setManualYamlOverride({
        yaml: normalizedYaml,
      });
      return { latestIdentity: resolvedIdentity, normalizedYaml };
    },
    [resolvedClusterId]
  );

  useEffect(() => {
    if (!isEditing) {
      setHasRemoteDrift(false);
      setConflictLiveObject(null);
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
      setConflictLiveObject(null);
      return;
    }
    const driftDetected =
      currentVersion !== baselineResourceVersion &&
      differsFromBaseline(baselineMergeYaml, effectiveYamlContent);
    setHasRemoteDrift(driftDetected);
    if (!driftDetected) {
      setConflictLiveObject(null);
    }
  }, [
    baselineMergeYaml,
    baselineResourceVersion,
    driftForced,
    effectiveYamlContent,
    isEditing,
    latestObjectIdentity,
    objectIdentity,
  ]);

  useEffect(() => {
    if (!isEditing) {
      setLintError(null);
      return;
    }
    const timeout = window.setTimeout(() => {
      const validation = validateYamlDraft(
        draftYaml,
        baselineIdentity ?? latestObjectIdentity ?? objectIdentity ?? null
      );
      setLintError(validation.isValid ? null : validation.message);
    }, LINT_DEBOUNCE_MS);
    return () => window.clearTimeout(timeout);
  }, [baselineIdentity, draftYaml, isEditing, latestObjectIdentity, objectIdentity]);

  const exitEditMode = useCallback(() => {
    setIsEditing(false);
    setDraftYaml('');
    setEditBaseline(null);
    setLintError(null);
    setActionError(null);
    setActionDetails([]);
    setHasRemoteDrift(false);
    setDriftForced(false);
    setConflictLiveObject(null);
    setReplacedByConflict(false);
    setConflictChoices(new Map());
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
    setEditBaseline({ identity: identityForEditing, yaml: preparedDraft });
    setLintError(null);
    setActionError(null);
    setActionDetails([]);
    setProtectedEditMessage(null);
    setHasRemoteDrift(false);
    setDriftForced(false);
    setConflictLiveObject(null);
    setReplacedByConflict(false);
    setConflictChoices(new Map());
    setPostApplyNotice(null);
    setPendingSnapshotAdoptionYaml(null);
    setHasServerYamlError(false);
    setLatestObjectIdentity(identityForEditing);
    setManualYamlOverride(
      (current) =>
        current ?? {
          yaml: normalizedSeedYaml,
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

  // A conflict carries the live object: show the draft's drift from it, and
  // note a replaced object, which cannot be merged into.
  const adoptConflictLiveObject = useCallback(
    (conflict: ObjectYamlConflict) => {
      setHasRemoteDrift(true);
      setDriftForced(true);
      if (conflict.code === OBJECT_REPLACED_CONFLICT_CODE) {
        setReplacedByConflict(true);
      }
      if (conflict.currentYaml) {
        setConflictLiveObject({
          yaml: prepareVisibleDraftYaml(normalizeYamlString(conflict.currentYaml)),
          watchedYaml: watchedYamlRef.current,
        });
        // A user read cancels a read already out, so the next watched snapshot
        // is at least as new as the conflict's object.
        if (scope) {
          void requestRefreshDomain({ domain: 'object-yaml', scope, reason: 'user' });
        }
      }
    },
    [prepareVisibleDraftYaml, scope]
  );

  // A replaced object is explained by the drift notice; other conflicts keep
  // the backend's message and causes.
  const showConflictText = useCallback((conflict: ObjectYamlConflict) => {
    if (conflict.code === OBJECT_REPLACED_CONFLICT_CODE) {
      return;
    }
    setActionError(conflict.message);
    setActionDetails(conflict.causes ?? []);
  }, []);

  const handleReloadMergeConflict = useCallback(
    (conflict: ObjectYamlConflict) => {
      showConflictText(conflict);
      setHasServerYamlError(false);
      adoptConflictLiveObject(conflict);
    },
    [adoptConflictLiveObject, showConflictText]
  );

  const handleReloadMergeError = useCallback((caughtError: unknown) => {
    const failure = describeRequestFailure(caughtError, 'Failed to reload latest YAML.');
    setActionError(failure.message);
    setActionDetails(failure.causes);
    errorHandler.handleInline(caughtError, { action: 'reloadAndMerge' });
  }, []);

  const handleReloadAndMerge = useCallback(async () => {
    if (isSaving || !effectiveIdentity || mergeBlockedReason) {
      return;
    }

    try {
      const result = await requestPreparedYamlMerge({
        clusterId: resolvedClusterId,
        // A field where yours was chosen starts from their value, so the
        // merge applies yours instead of stopping on it.
        baselineMergeYaml: driftLiveYaml
          ? yoursFields.reduce(
              (yaml, field) => copyDriftField(yaml, driftLiveYaml, field.path),
              baselineMergeYaml
            )
          : baselineMergeYaml,
        sourceYaml: manualYamlOverride?.yaml ?? yamlContent,
        draftYaml,
        effectiveIdentity,
        prepareVisibleDraftYaml,
      });
      if (result.kind === 'conflict') {
        handleReloadMergeConflict(result.conflict);
        return;
      }
      const { normalizedLatestYaml, preparedLatestYaml, mergedDraftYaml, latestIdentity } =
        result.merge;

      setEditBaseline({ identity: latestIdentity, yaml: preparedLatestYaml });
      setDraftYaml(mergedDraftYaml);
      setLatestObjectIdentity(latestIdentity);
      setManualYamlOverride({
        yaml: normalizedLatestYaml,
      });
      setLintError(null);
      setActionError(null);
      setActionDetails([]);
      setProtectedEditMessage(null);
      setHasRemoteDrift(false);
      setDriftForced(false);
      setConflictLiveObject(null);
      setReplacedByConflict(false);
      setConflictChoices(new Map());
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
    driftLiveYaml,
    effectiveIdentity,
    handleReloadMergeConflict,
    handleReloadMergeError,
    isSaving,
    manualYamlOverride,
    mergeBlockedReason,
    prepareVisibleDraftYaml,
    resolvedClusterId,
    scope,
    yamlContent,
    yoursFields,
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
        errorHandler.handleInline(error, { action: 'loadLatestObjectYAML' });
      }
    },
    [hydrateLatestObject, verifiedPostApply]
  );

  // The object was replaced since editing began: keep the draft and editing
  // state, and show the draft's drift from the new object.
  const handleSaveConflict = useCallback(
    (conflict: ObjectYamlConflict) => {
      showConflictText(conflict);
      setHasServerYamlError(true);
      setPendingSnapshotAdoptionYaml(null);
      adoptConflictLiveObject(conflict);
    },
    [adoptConflictLiveObject, showConflictText]
  );

  const handleSaveError = useCallback((caughtError: unknown) => {
    const failure = describeRequestFailure(caughtError, 'Failed to save YAML changes.');
    setActionError(failure.message);
    setActionDetails(failure.causes);
    setPostApplyNotice(null);
    setVerifiedPostApply(null);
    setPendingSnapshotAdoptionYaml(null);
    setHasServerYamlError(failure.rejectsYaml);
    errorHandler.handleInline(caughtError, { action: 'saveObjectYAML' });
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
        if (applyResponse.yamlConflict) {
          handleSaveConflict(applyResponse.yamlConflict);
          return;
        }
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
      handleSaveConflict,
      handleSaveError,
      resolvedClusterId,
      scope,
      verifyAppliedYaml,
      yamlContent,
    ]
  );

  const handleSaveClick = useCallback(async () => {
    if (saveBlockedReason) {
      return;
    }
    const request = prepareSaveRequest({
      isEditing,
      isSaving,
      effectiveIdentity,
      draftYaml,
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
    saveBlockedReason,
    yamlContent,
  ]);

  const chooseTheirs = useCallback(
    (field: DriftField) => {
      if (!driftLiveYaml) {
        return;
      }
      setConflictChoices((current) => withChoice(current, field, 'theirs', draftYaml));
      setDraftYaml((current) => copyDriftField(current, driftLiveYaml, field.path));
    },
    [draftYaml, driftLiveYaml]
  );

  const chooseYours = useCallback(
    (field: DriftField) => {
      const recorded = conflictChoices.get(field.key);
      if (!field.conflict && recorded) {
        // Theirs is in the draft: put yours back.
        setDraftYaml((current) => copyDriftField(current, recorded.yoursDraftYaml, field.path));
      }
      setConflictChoices((current) => withChoice(current, field, 'yours', draftYaml));
    },
    [conflictChoices, draftYaml]
  );

  const editNewObject = useCallback(() => {
    setRestartFrom({ uid: baselineIdentity?.uid ?? null });
    exitEditMode();
    if (scope) {
      void requestRefreshDomain({ domain: 'object-yaml', scope, reason: 'user' });
    }
  }, [baselineIdentity?.uid, exitEditMode, scope]);

  // Edit the new object once the snapshot shows it (a uid other than the one
  // the discarded draft was edited from).
  useEffect(() => {
    if (!restartFrom || isEditing) {
      return;
    }
    const liveUid = (latestObjectIdentity ?? objectIdentity)?.uid ?? null;
    if (restartFrom.uid && liveUid === restartFrom.uid) {
      return;
    }
    setRestartFrom(null);
    handleEnterEdit();
  }, [handleEnterEdit, isEditing, latestObjectIdentity, objectIdentity, restartFrom]);

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
    hasRemoteDrift,
    driftForced,
    backendDriftCurrentYaml: conflictLiveObject?.yaml ?? null,
    objectReplaced,
    driftFields,
    hasUnsavedEdits,
    driftChoices,
    saveBlockedReason,
    mergeBlockedReason,
    chooseTheirs,
    chooseYours,
    editNewObject,
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
