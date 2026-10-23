/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Yaml/YamlTab.tsx
 *
 * Renders the object-panel YAML editor and apply workflow. Transaction ordering
 * for baseline, draft, latest live YAML, apply, verification, and refresh lives
 * in yamlTransaction.
 */

import { writeClipboardText } from '@core/desktop-runtime';
import { useOptionalObjectPanelState } from '@modules/object-panel/contexts/ObjectPanelStateContext';
import { useCurrentObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';
import ClusterDataPausedState from '@shared/components/ClusterDataPausedState';
import { ErrorSurface } from '@shared/components/errors/ErrorSurface';
import IconBar, { type IconBarItem } from '@shared/components/IconBar/IconBar';
import { WrapTextIcon } from '@shared/components/icons/LogIcons';
import { CloseIcon } from '@shared/components/icons/SharedIcons';
import LoadingSpinner from '@shared/components/LoadingSpinner';
import ConfirmationModal from '@shared/components/modals/ConfirmationModal';
import { YamlEditor, type YamlEditorHandle } from '@shared/components/yaml';
import { withStableListKeys } from '@shared/utils/stableListKeys';
import { useShortcut } from '@ui/shortcuts';
import { errorHandler } from '@utils/errorHandler';
import type React from 'react';
import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import * as YAML from 'yaml';
import { usePanelLifecycleGuard } from '@/core/panel-windows/panelLifecycleGuards';
import { useAutoRefreshLoadingState } from '@/core/refresh/hooks/useAutoRefreshLoadingState';
import { applyPassiveLoadingPolicy } from '@/core/refresh/loadingPolicy';
import { useRefreshScopedDomain } from '@/core/refresh/store';
import './YamlTab.css';
import {
  YamlCancelIcon,
  YamlEditIcon,
  YamlManagedFieldsIcon,
  YamlSaveIcon,
} from '@shared/components/icons/YamlIcons';
import { failureMessage } from '@/core/refresh/refreshFailure';
import type { DriftField } from './yamlDriftFields';
import { resolveProtectedYamlRanges } from './yamlFieldPolicy';
import { getYamlPanelBlockReason } from './yamlPanelGuard';
import { INACTIVE_SCOPE, LARGE_MANIFEST_THRESHOLD, YAML_STRINGIFY_OPTIONS } from './yamlTabConfig';
import type { YamlTabProps } from './yamlTabTypes';
import { prepareDraftYaml } from './yamlTabUtils';
import {
  type DriftChoice,
  type DriftChoiceView,
  useYamlTransaction,
  type YamlTransactionDiffResult,
} from './yamlTransaction';

const buildYamlDiffView = (
  diff: YamlTransactionDiffResult | null,
  keyPrefix: string,
  showFullDiff: boolean,
  onToggleFullDiff: (key: string) => void
) => {
  if (!diff || diff.tooLarge) {
    return { toggle: null, content: null };
  }
  const visibleLines = showFullDiff
    ? diff.lines
    : diff.lines.filter((line) => line.type !== 'context');
  if (visibleLines.length === 0) {
    return { toggle: null, content: null };
  }
  const hasContextLines = diff.lines.some((line) => line.type === 'context');
  return {
    toggle: hasContextLines ? (
      <button
        className="button generic"
        type="button"
        aria-expanded={showFullDiff}
        onClick={() => onToggleFullDiff(keyPrefix)}
      >
        {showFullDiff ? 'Show only changes' : 'Show full diff'}
      </button>
    ) : null,
    content: (
      <div className="yaml-drift-diff" role="status" aria-live="polite">
        <pre>
          {visibleLines.map((line, index) => {
            const lineKeyIndex = showFullDiff ? index : diff.lines.indexOf(line);
            let prefix: string;

            if (line.type === 'added') {
              prefix = '+';
            } else if (line.type === 'removed') {
              prefix = '-';
            } else {
              prefix = ' ';
            }

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
    ),
  };
};

const getManagedFieldsLabels = (
  isEditing: boolean,
  showManagedFields: boolean
): { title: string; ariaLabel: string } => {
  if (isEditing) {
    return {
      title: 'managedFields unavailable while editing',
      ariaLabel: 'managedFields toggle unavailable while editing',
    };
  }
  const title = showManagedFields ? 'Hide managedFields' : 'Show managedFields';
  return { title, ariaLabel: title };
};

const buildYamlEditItems = ({
  isEditing,
  isSaving,
  hasUnsavedEdits,
  disableSave,
  saveBlockedReason,
  canEdit,
  editDisabledReason,
  cancelEdit,
  saveYaml,
  enterEdit,
}: {
  isEditing: boolean;
  isSaving: boolean;
  /** Lights Save green and Cancel red: there is something to save or lose. */
  hasUnsavedEdits: boolean;
  disableSave: boolean;
  /** Shown as Save's title while drift keeps it unavailable. */
  saveBlockedReason: string | null;
  canEdit: boolean;
  editDisabledReason: string | null;
  cancelEdit: () => void;
  saveYaml: () => void;
  enterEdit: () => void;
}): IconBarItem[] => {
  if (isEditing) {
    return [
      {
        type: 'action',
        id: 'cancel-edit',
        icon: <YamlCancelIcon width={16} height={16} />,
        onClick: cancelEdit,
        title: 'Cancel edit',
        ariaLabel: 'Cancel edit',
        disabled: isSaving,
        tone: hasUnsavedEdits ? 'error' : null,
      },
      {
        type: 'action',
        id: 'save-yaml',
        icon: <YamlSaveIcon width={16} height={16} />,
        onClick: saveYaml,
        title: isSaving ? 'Saving YAML' : (saveBlockedReason ?? 'Save YAML'),
        ariaLabel: 'Save YAML',
        disabled: disableSave,
        tone: hasUnsavedEdits ? 'success' : null,
      },
    ];
  }
  if (canEdit) {
    return [
      {
        type: 'action',
        id: 'edit-yaml',
        icon: <YamlEditIcon width={16} height={16} />,
        onClick: enterEdit,
        title: 'Edit YAML',
        ariaLabel: 'Edit YAML',
      },
    ];
  }
  if (!editDisabledReason) {
    return [];
  }
  return [
    {
      type: 'action',
      id: 'edit-yaml-disabled',
      icon: <YamlEditIcon width={16} height={16} />,
      onClick: () => undefined,
      title: editDisabledReason,
      ariaLabel: `Edit YAML unavailable: ${editDisabledReason}`,
      disabled: true,
    },
  ];
};

const buildYamlToolbarItems = ({
  isEditing,
  showManagedFields,
  wrapLines,
  toggleManagedFields,
  toggleLineWrapping,
  ...editOptions
}: {
  isEditing: boolean;
  showManagedFields: boolean;
  wrapLines: boolean;
  toggleManagedFields: () => void;
  toggleLineWrapping: () => void;
} & Parameters<typeof buildYamlEditItems>[0]): IconBarItem[] => {
  const managedFieldsLabels = getManagedFieldsLabels(isEditing, showManagedFields);
  const editItems = buildYamlEditItems({ ...editOptions, isEditing });
  return [
    {
      type: 'toggle',
      id: 'managed-fields',
      icon: <YamlManagedFieldsIcon width={16} height={16} />,
      active: showManagedFields && !isEditing,
      onClick: toggleManagedFields,
      title: managedFieldsLabels.title,
      ariaLabel: managedFieldsLabels.ariaLabel,
      disabled: isEditing,
    },
    {
      type: 'toggle',
      id: 'wrap-lines',
      icon: <WrapTextIcon width={20} height={20} />,
      active: wrapLines,
      onClick: toggleLineWrapping,
      title: wrapLines ? 'Disable YAML line wrapping' : 'Enable YAML line wrapping',
      ariaLabel: 'Wrap YAML lines',
    },
    // The view toggles and the edit actions are separate groups.
    ...(editItems.length > 0 ? [{ type: 'separator' } as const, ...editItems] : []),
  ];
};

const isYamlSnapshotLoading = (status: string, yamlContent: string): boolean =>
  status === 'loading' || status === 'initialising' || (status === 'updating' && !yamlContent);

const renderYamlBlockingState = ({
  loading,
  paused,
  error,
  hasContent,
}: {
  loading: boolean;
  paused: boolean;
  error: string | null;
  hasContent: boolean;
}) => {
  if (loading) {
    return (
      <div className="object-panel-tab-content">
        <LoadingSpinner message="Loading YAML..." />
      </div>
    );
  }
  if (paused) {
    return (
      <div className="object-panel-tab-content">
        <div className="yaml-display-empty">
          <ClusterDataPausedState />
        </div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="object-panel-tab-content">
        <div className="yaml-display-error">
          <div className="error-message">
            Error loading YAML: <ErrorSurface kind="reported" message={error} />
          </div>
        </div>
      </div>
    );
  }
  if (!hasContent) {
    return (
      <div className="object-panel-tab-content">
        <div className="yaml-display-empty">
          <p>No YAML content available</p>
        </div>
      </div>
    );
  }
  return null;
};

type YamlNoticeDiffProps = {
  diff: YamlTransactionDiffResult | null;
  diffKey: string;
  expandedDiffs: Record<string, boolean>;
  toggleDiffExpansion: (key: string) => void;
};

/**
 * Why the draft is shown against a newer live object: someone else changed it,
 * it was deleted and recreated, or the merge stopped on a field.
 */
type YamlDriftNoticeKind = 'changed' | 'replaced' | 'unmerged';

const DRIFT_ROW_LIMIT = 8;
const ABSENT_VALUE = '—';

const driftHeadline = (kind: YamlDriftNoticeKind, saveFailed: boolean): string => {
  if (kind === 'replaced') {
    return saveFailed
      ? 'Save failed: this object was deleted and recreated.'
      : 'This object was deleted and recreated.';
  }
  return kind === 'unmerged'
    ? 'The merge stopped on a field both versions changed.'
    : 'This object was modified while you were editing.';
};

type YamlDriftChoiceProps = {
  isSaving: boolean;
  choices: ReadonlyMap<string, DriftChoiceView>;
  onChooseTheirs: (field: DriftField) => void;
  onChooseYours: (field: DriftField) => void;
};

type DriftOption = {
  /** This value is the one kept, the other one is, or neither is yet. */
  state: 'undecided' | 'chosen' | 'other';
  disabled: boolean;
  label: string;
  /** Absent on the kept value: choosing it again changes nothing. */
  onChoose?: () => void;
};

// Separator-ended parts of a value: "registry.", "example.", "com/", ... A dot
// before a digit is not a separator, so "1.4.3" stays whole.
const VALUE_PARTS = /(?:[^/:.,=-]|\.(?=\d))*(?:[/:,=-]|\.(?!\d))?/g;

// A long value breaks after its separators first, so a wrapped value stays
// readable; a part longer than the cell still breaks anywhere.
const BreakableValue = ({ value }: { value: string }) => {
  let offset = 0;
  return (
    <>
      {(value.match(VALUE_PARTS) ?? [])
        .filter((part) => part !== '')
        .map((part) => {
          const start = offset;
          offset += part.length;
          return (
            <Fragment key={start}>
              {start > 0 && <wbr />}
              {part}
            </Fragment>
          );
        })}
    </>
  );
};

// A value cell; on a field both sides changed, the value is a chip that keeps
// it. Values are shown in full: the choice needs them in view.
const DriftValueCell = ({
  value,
  option,
  className = 'monospace yaml-drift-notice-value',
}: {
  value: string | undefined;
  option: DriftOption | null;
  className?: string;
}) => {
  const text = value === undefined ? ABSENT_VALUE : <BreakableValue value={value} />;
  return (
    <td className={className}>
      {option ? (
        <button
          type="button"
          className={`yaml-drift-notice-chip yaml-drift-notice-chip-${option.state}`}
          aria-pressed={option.state === 'chosen'}
          aria-label={option.label}
          disabled={option.disabled}
          onClick={option.onChoose}
        >
          {text}
        </button>
      ) : (
        text
      )}
    </td>
  );
};

type DriftTableProps = YamlDriftChoiceProps & {
  /** False for a replaced object, whose draft cannot be saved to it. */
  choosable: boolean;
};

const DriftFieldRow = ({
  field,
  choosable,
  isSaving,
  choices,
  onChooseTheirs,
  onChooseYours,
}: DriftTableProps & { field: DriftField }) => {
  const chosen = choices.get(field.key);
  // With the external edit in the draft, yours is the value it replaced. A
  // field you did not edit shows no value of yours.
  let yours = field.edited ? field.draft : undefined;
  if (chosen?.choice === 'theirs') {
    yours = chosen.yours;
  }
  const offersChoice = choosable && (field.conflict || !!chosen);
  const stateOf = (choice: DriftChoice): DriftOption['state'] => {
    if (!chosen) {
      return 'undecided';
    }
    return chosen.choice === choice ? 'chosen' : 'other';
  };
  const option = (choice: DriftChoice, value: string | undefined, onChoose: () => void) =>
    offersChoice
      ? {
          state: stateOf(choice),
          disabled: isSaving,
          label: `${choice === 'theirs' ? 'Use the external edit' : 'Keep your edit'} for ${field.key}: ${value ?? 'absent'}`,
          onChoose: stateOf(choice) === 'chosen' ? undefined : onChoose,
        }
      : null;
  return (
    <tr className={offersChoice ? 'yaml-drift-notice-choice-row' : undefined}>
      <td className="monospace yaml-drift-notice-field" title={field.key}>
        {field.label}
      </td>
      <DriftValueCell value={field.started} option={null} />
      <DriftValueCell
        value={field.now}
        option={option('theirs', field.now, () => onChooseTheirs(field))}
      />
      <DriftValueCell
        value={yours}
        className="monospace yaml-drift-notice-value yaml-drift-notice-mine"
        option={option('yours', yours, () => onChooseYours(field))}
      />
    </tr>
  );
};

// Choices sit in their field's row: pick the external edit or your edit.
const DriftFieldTable = ({ fields, ...rowProps }: DriftTableProps & { fields: DriftField[] }) => {
  return (
    <div className="yaml-drift-notice-table">
      <table className="confirmation-modal-details-table">
        <thead>
          <tr>
            <th>Field</th>
            <th>Original Value</th>
            <th>External Edit</th>
            <th>Your Edit</th>
          </tr>
        </thead>
        <tbody>
          {fields.map((field) => (
            <DriftFieldRow key={field.key} field={field} {...rowProps} />
          ))}
        </tbody>
      </table>
    </div>
  );
};

type YamlDriftNoticeProps = YamlDriftChoiceProps & {
  kind: YamlDriftNoticeKind | null;
  saveFailed: boolean;
  fields: DriftField[];
  mergeBlockedReason: string | null;
  onMerge: () => void;
  onDiscard: () => void;
  onCopyDraft: () => void;
  onEditNewObject: () => void;
};

const DriftNoticeActions = ({
  replaced,
  isSaving,
  mergeBlockedReason,
  reasonId,
  onMerge,
  onDiscard,
  onCopyDraft,
  onEditNewObject,
}: Pick<
  YamlDriftNoticeProps,
  'isSaving' | 'mergeBlockedReason' | 'onMerge' | 'onDiscard' | 'onCopyDraft' | 'onEditNewObject'
> & { replaced: boolean; reasonId: string }) => (
  <div className="yaml-drift-notice-actions">
    {replaced ? (
      <>
        <button type="button" className="button generic" onClick={onCopyDraft}>
          Copy draft
        </button>
        <button type="button" className="button action" onClick={onEditNewObject}>
          Edit the new object
        </button>
      </>
    ) : (
      <>
        <button type="button" className="button generic" disabled={isSaving} onClick={onDiscard}>
          Cancel edit
        </button>
        <button
          type="button"
          className="button action"
          disabled={isSaving || Boolean(mergeBlockedReason)}
          aria-describedby={mergeBlockedReason ? reasonId : undefined}
          onClick={onMerge}
        >
          {mergeBlockedReason ? 'Select values to keep' : 'Merge changes and continue editing'}
        </button>
      </>
    )}
  </div>
);

/** The drift notice: what changed, field by field, and what the user can do. */
const YamlDriftNotice = ({
  kind,
  saveFailed,
  fields,
  choices,
  isSaving,
  onChooseTheirs,
  onChooseYours,
  mergeBlockedReason,
  ...actions
}: YamlDriftNoticeProps) => {
  const [showAll, setShowAll] = useState(false);
  const reasonId = useId();
  if (!kind) {
    return null;
  }
  const replaced = kind === 'replaced';
  const visibleFields = showAll ? fields : fields.slice(0, DRIFT_ROW_LIMIT);
  return (
    <div className="yaml-post-apply-notice yaml-drift-notice" role="status" aria-live="polite">
      <p className="yaml-drift-notice-headline">{driftHeadline(kind, saveFailed)}</p>
      {!!replaced && (
        <p className="yaml-drift-notice-sub">
          Your draft belongs to the old object, so it can’t be saved. Copy it if you need it, then
          edit the new object.
        </p>
      )}
      {!replaced && !!mergeBlockedReason && (
        <p className="yaml-drift-notice-sub" id={reasonId}>
          {mergeBlockedReason}
        </p>
      )}
      {visibleFields.length > 0 && (
        <DriftFieldTable
          fields={visibleFields}
          choosable={!replaced}
          choices={choices}
          isSaving={isSaving}
          onChooseTheirs={onChooseTheirs}
          onChooseYours={onChooseYours}
        />
      )}
      {fields.length > DRIFT_ROW_LIMIT && (
        <button
          type="button"
          className="button generic yaml-drift-notice-more"
          onClick={() => setShowAll((current) => !current)}
        >
          {showAll ? 'Show fewer' : `Show all ${fields.length}`}
        </button>
      )}
      <DriftNoticeActions
        replaced={replaced}
        isSaving={isSaving}
        mergeBlockedReason={mergeBlockedReason}
        reasonId={reasonId}
        {...actions}
      />
    </div>
  );
};

const YamlValidationNotice = ({
  isEditing,
  lintError,
  actionError,
  actionDetails,
  protectedEditMessage,
}: {
  isEditing: boolean;
  lintError: string | null;
  actionError: string | null;
  actionDetails: string[];
  protectedEditMessage: string | null;
}) => {
  const hasMessage = Boolean(lintError || actionError || protectedEditMessage);
  if (!isEditing || !hasMessage) {
    return null;
  }
  return (
    <div className="yaml-validation-message">
      {!!lintError && (
        <p>
          <ErrorSurface kind="validation" message={lintError} />
        </p>
      )}
      {!!protectedEditMessage && <p>{protectedEditMessage}</p>}
      {!!actionError && actionError !== lintError && (
        <p>
          <ErrorSurface kind="reported" message={actionError} />
        </p>
      )}
      {actionDetails.length > 0 && (
        <ul className="yaml-error-details">
          {withStableListKeys(actionDetails, (detail) => detail).map(({ key, value: detail }) => (
            <li key={key}>
              <ErrorSurface kind="reported" message={detail} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

const YamlPostApplyNoticeView = ({
  isEditing,
  notice,
  dismiss,
  ...diffProps
}: Omit<YamlNoticeDiffProps, 'diff'> & {
  isEditing: boolean;
  notice: ReturnType<typeof useYamlTransaction>['postApplyNotice'];
  dismiss: () => void;
}) => {
  if (isEditing || !notice) {
    return null;
  }
  const diffView = buildYamlDiffView(
    notice.diff,
    diffProps.diffKey,
    Boolean(diffProps.expandedDiffs[diffProps.diffKey]),
    diffProps.toggleDiffExpansion
  );
  return (
    <div
      className={`yaml-post-apply-notice yaml-post-apply-notice-${notice.kind}`}
      role="status"
      aria-live="polite"
    >
      <div className="yaml-notice-header">
        <p>{notice.message}</p>
        <div className="yaml-notice-actions">
          {diffView.toggle}
          <button
            className="yaml-notice-close"
            type="button"
            aria-label="Close diff notice"
            onClick={dismiss}
          >
            <CloseIcon width={14} height={14} />
          </button>
        </div>
      </div>
      {diffView.content}
      {!!notice.diff?.tooLarge && (
        <p className="yaml-drift-warning">
          {notice.diff.tooLargeMessage ??
            'The post-apply diff is too large to display in the current view.'}
        </p>
      )}
    </div>
  );
};

const canUseYamlEditShortcut = (isEditing: boolean, isSaving: boolean): boolean =>
  isEditing && !isSaving;

const runYamlEditShortcut = (
  isEditing: boolean,
  isSaving: boolean,
  action: () => void
): boolean => {
  if (!canUseYamlEditShortcut(isEditing, isSaving)) {
    return false;
  }
  action();
  return true;
};

type YamlDriftState = Pick<
  ReturnType<typeof useYamlTransaction>,
  'isEditing' | 'hasRemoteDrift' | 'driftForced' | 'backendDriftCurrentYaml' | 'objectReplaced'
>;

const resolveDriftNotice = ({
  isEditing,
  hasRemoteDrift,
  driftForced,
  backendDriftCurrentYaml,
  objectReplaced,
}: YamlDriftState): YamlDriftNoticeKind | null => {
  if (!isEditing) {
    return null;
  }
  if (objectReplaced) {
    return 'replaced';
  }
  if (driftForced || backendDriftCurrentYaml) {
    return 'unmerged';
  }
  return hasRemoteDrift ? 'changed' : null;
};

const getYamlViewModel = ({
  draftYaml,
  displayYaml,
  lintError,
  hasServerYamlError,
  isSaving,
  saveBlockedReason,
  postApplyNotice,
  ...drift
}: YamlDriftState & {
  draftYaml: string;
  displayYaml: string | null | undefined;
  lintError: string | null;
  hasServerYamlError: boolean;
  isSaving: boolean;
  saveBlockedReason: string | null;
  postApplyNotice: ReturnType<typeof useYamlTransaction>['postApplyNotice'];
}) => {
  const { isEditing } = drift;
  const activeYaml = isEditing ? draftYaml : (displayYaml ?? '');
  const hasYamlError = Boolean(lintError) || hasServerYamlError;
  return {
    activeYaml,
    disableSave: isSaving || hasYamlError || Boolean(saveBlockedReason),
    driftNotice: resolveDriftNotice(drift),
    postApplyDiffKey: postApplyNotice ? `post-apply-${postApplyNotice.kind}` : 'post-apply',
    isLargeManifest: activeYaml.length > LARGE_MANIFEST_THRESHOLD,
  };
};

const resolveEditableYamlProtectedRanges = (value: string) =>
  resolveProtectedYamlRanges(value, 'edit');

type YamlEditorSurfaceProps = {
  yamlEditorRef: React.RefObject<YamlEditorHandle | null>;
  value: string;
  onChange: (value: string) => void;
  isEditing: boolean;
  isSaving: boolean;
  isActive: boolean;
  wrapLines: boolean;
  setProtectedEditMessage: (message: string | null) => void;
  isLargeManifest: boolean;
  yamlToolbarItems: IconBarItem[];
  cancelEdit: () => void;
  pendingOwnershipConflicts: ReturnType<typeof useYamlTransaction>['pendingOwnershipConflicts'];
  confirmOwnershipAndSave: () => Promise<void>;
  cancelOwnershipWarning: () => void;
};

const YamlEditorSurface = ({
  yamlEditorRef,
  value,
  onChange,
  isEditing,
  isSaving,
  isActive,
  wrapLines,
  setProtectedEditMessage,
  isLargeManifest,
  yamlToolbarItems,
  cancelEdit,
  pendingOwnershipConflicts,
  confirmOwnershipAndSave,
  cancelOwnershipWarning,
}: YamlEditorSurfaceProps) => (
  <>
    <YamlEditor
      ref={yamlEditorRef}
      value={value}
      onChange={onChange}
      editable={isEditing}
      disabled={isSaving}
      active={isActive}
      shortcutLabel="YAML tab search"
      shortcutPriority={30}
      ariaLabel="Object YAML editor"
      showSearchOptions
      lineWrapping={wrapLines}
      protectedRangeResolver={isEditing ? resolveEditableYamlProtectedRanges : undefined}
      onProtectedEditBlocked={setProtectedEditMessage}
      largeDocumentNotice={
        isLargeManifest
          ? 'Large manifest detected. Editor performance may be reduced while editing.'
          : null
      }
      toolbarActions={<IconBar items={yamlToolbarItems} />}
      onEscape={() => runYamlEditShortcut(isEditing, isSaving, cancelEdit)}
    />
    <ConfirmationModal
      isOpen={Boolean(pendingOwnershipConflicts?.length)}
      title="Take ownership of managed fields?"
      message="Your changes modify fields that are currently managed by other controllers. Saving will take ownership of these fields, which could cause ownership conflicts that will have to be resolved."
      detailsTable={{
        columns: [{ header: 'Owner' }, { header: 'Path', monospace: true }],
        rows: (pendingOwnershipConflicts ?? []).map((conflict) => [
          conflict.manager || 'unknown manager',
          conflict.field.replace(/^\./, '') || 'unknown field',
        ]),
      }}
      confirmText="Save anyway"
      cancelText="Keep editing"
      confirmButtonClass="danger"
      secondaryActionText="Cancel"
      onSecondaryAction={cancelEdit}
      onConfirm={() => {
        void confirmOwnershipAndSave();
      }}
      onCancel={cancelOwnershipWarning}
    />
  </>
);

const YamlTab: React.FC<YamlTabProps> = ({
  scope,
  isActive = false,
  canEdit = false,
  editDisabledReason = null,
  clusterId,
}) => {
  const { isPaused, isManualRefreshActive } = useAutoRefreshLoadingState();
  const [showManagedFields, setShowManagedFields] = useState(false);
  const [wrapLines, setWrapLines] = useState(true);
  const [expandedDiffs, setExpandedDiffs] = useState<Record<string, boolean>>({});
  const yamlEditorRef = useRef<YamlEditorHandle>(null);
  const { panelId } = useCurrentObjectPanel();
  const objectPanelState = useOptionalObjectPanelState();

  const effectiveScope = scope ?? INACTIVE_SCOPE;
  const snapshot = useRefreshScopedDomain('object-yaml', effectiveScope);
  const yamlContent = snapshot.data?.yaml ?? '';
  const yamlLoadingState = applyPassiveLoadingPolicy({
    loading: isYamlSnapshotLoading(snapshot.status, yamlContent),
    hasLoaded: Boolean(snapshot.data),
    hasData: Boolean(yamlContent),
    isPaused,
    isManualRefreshActive,
  });
  const yamlLoading = yamlLoadingState.loading;
  const showPausedYamlState = yamlLoadingState.showPausedEmptyState;
  const yamlError = failureMessage(snapshot.error);

  const prepareVisibleDraftYaml = useCallback(
    (rawYaml: string) => prepareDraftYaml(rawYaml, showManagedFields),
    [showManagedFields]
  );

  const {
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
    backendDriftCurrentYaml,
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
    pendingOwnershipConflicts,
    confirmOwnershipAndSave,
    cancelOwnershipWarning,
  } = useYamlTransaction({
    scope,
    isActive,
    canEdit,
    clusterId,
    yamlContent,
    prepareVisibleDraftYaml,
  });

  usePanelLifecycleGuard(panelId, () => {
    const reason = getYamlPanelBlockReason({ isEditing, isSaving, hasUnsavedEdits });
    if (!reason) {
      return null;
    }
    return {
      reason,
      focus: () => {
        if (panelId && clusterId) {
          objectPanelState?.setObjectPanelActiveTab(clusterId, panelId, 'yaml');
        }
        window.requestAnimationFrame(() => yamlEditorRef.current?.focus());
      },
    };
  });

  const displayYaml = useMemo(() => {
    if (!effectiveYamlContent) {
      return effectiveYamlContent;
    }

    try {
      const doc = YAML.parseDocument(effectiveYamlContent);
      const obj = doc.toJSON();

      if (!showManagedFields && obj?.metadata?.managedFields) {
        obj.metadata.managedFields = undefined;
      }

      return YAML.stringify(obj, YAML_STRINGIFY_OPTIONS);
    } catch (e) {
      errorHandler.handle(e, { action: 'processYAML' });
      return effectiveYamlContent;
    }
  }, [effectiveYamlContent, showManagedFields]);

  const yamlView = getYamlViewModel({
    isEditing,
    draftYaml,
    displayYaml,
    lintError,
    hasServerYamlError,
    isSaving,
    saveBlockedReason,
    hasRemoteDrift,
    backendDriftCurrentYaml,
    driftForced,
    objectReplaced,
    postApplyNotice,
  });

  const handleCopyDraft = useCallback(() => {
    void writeClipboardText(draftYaml).catch((error: unknown) =>
      errorHandler.handle(error, { action: 'copyYamlDraft' })
    );
  }, [draftYaml]);

  const toggleDiffExpansion = useCallback((diffKey: string) => {
    setExpandedDiffs((current) => ({
      ...current,
      [diffKey]: !current[diffKey],
    }));
  }, []);

  const handleToggleManagedFields = useCallback(() => {
    setShowManagedFields((prev) => !prev);
  }, []);

  const handleToggleLineWrapping = useCallback(() => {
    setWrapLines((current) => !current);
  }, []);

  const handleEnterEditClick = useCallback(() => {
    setExpandedDiffs({});
    handleEnterEdit();
  }, [handleEnterEdit]);

  useEffect(() => {
    if (!isEditing) {
      setExpandedDiffs({});
    }
    if (!isActive) {
      return;
    }
    // Focus the editor in read mode too: clipboard and select-all shortcuts
    // route to the surface that contains the focused element. The focus waits
    // a frame, which a busy render can delay past the user's next input; a
    // focus the user moved meanwhile (the search shortcut) wins. Focus that
    // fell back to the body, because its element was removed, does not count.
    const focusedBefore = document.activeElement;
    const frame = window.requestAnimationFrame(() => {
      const focused = document.activeElement;
      if (focused === focusedBefore || focused === document.body) {
        yamlEditorRef.current?.focus();
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [isActive, isEditing]);

  useShortcut({
    key: 'm',
    handler: useCallback(() => {
      if (!isActive || isEditing) {
        return false;
      }
      setShowManagedFields((prev) => !prev);
      return true;
    }, [isActive, isEditing]),
    description: 'Toggle managedFields',
    category: 'YAML',
    helpOrder: 30,
    enabled: true,
    priority: 20,
  });

  useShortcut({
    key: 's',
    modifiers: { meta: true },
    handler: () => runYamlEditShortcut(isEditing, isSaving, handleSaveClick),
    description: 'Save YAML changes',
    category: 'YAML',
    helpOrder: 10,
    enabled: canUseYamlEditShortcut(isEditing, isSaving),
    priority: 30,
  });

  useShortcut({
    key: 's',
    modifiers: { ctrl: true },
    handler: () => runYamlEditShortcut(isEditing, isSaving, handleSaveClick),
    description: 'Save YAML changes',
    category: 'YAML',
    helpOrder: 11,
    enabled: canUseYamlEditShortcut(isEditing, isSaving),
    priority: 30,
  });

  useShortcut({
    key: 'Escape',
    handler: () => runYamlEditShortcut(isEditing, isSaving, handleCancelClick),
    description: 'Cancel YAML edit',
    category: 'YAML',
    helpOrder: 20,
    enabled: canUseYamlEditShortcut(isEditing, isSaving),
    priority: 30,
  });

  const yamlToolbarItems = useMemo<IconBarItem[]>(
    () =>
      buildYamlToolbarItems({
        isEditing,
        showManagedFields,
        wrapLines,
        toggleManagedFields: handleToggleManagedFields,
        toggleLineWrapping: handleToggleLineWrapping,
        isSaving,
        hasUnsavedEdits,
        disableSave: yamlView.disableSave,
        saveBlockedReason,
        canEdit,
        editDisabledReason,
        cancelEdit: handleCancelClick,
        saveYaml: handleSaveClick,
        enterEdit: handleEnterEditClick,
      }),
    [
      canEdit,
      hasUnsavedEdits,
      yamlView.disableSave,
      editDisabledReason,
      handleCancelClick,
      handleEnterEditClick,
      handleSaveClick,
      handleToggleLineWrapping,
      handleToggleManagedFields,
      isEditing,
      isSaving,
      saveBlockedReason,
      showManagedFields,
      wrapLines,
    ]
  );

  const blockingState = renderYamlBlockingState({
    loading: yamlLoading,
    paused: showPausedYamlState,
    error: yamlError,
    hasContent: Boolean(yamlContent),
  });
  if (blockingState) {
    return blockingState;
  }

  return (
    <div className="object-panel-tab-content">
      <div className="yaml-display">
        <YamlDriftNotice
          kind={yamlView.driftNotice}
          saveFailed={hasServerYamlError}
          fields={driftFields}
          choices={driftChoices}
          isSaving={isSaving}
          mergeBlockedReason={mergeBlockedReason}
          onChooseTheirs={chooseTheirs}
          onChooseYours={chooseYours}
          onMerge={handleReloadAndMerge}
          onDiscard={handleCancelClick}
          onCopyDraft={handleCopyDraft}
          onEditNewObject={editNewObject}
        />
        <YamlValidationNotice
          isEditing={isEditing}
          lintError={lintError}
          actionError={actionError}
          actionDetails={actionDetails}
          protectedEditMessage={protectedEditMessage}
        />
        <YamlPostApplyNoticeView
          isEditing={isEditing}
          notice={postApplyNotice}
          dismiss={dismissPostApplyNotice}
          diffKey={yamlView.postApplyDiffKey}
          expandedDiffs={expandedDiffs}
          toggleDiffExpansion={toggleDiffExpansion}
        />
        <YamlEditorSurface
          yamlEditorRef={yamlEditorRef}
          value={yamlView.activeYaml}
          onChange={handleEditorChange}
          isEditing={isEditing}
          isSaving={isSaving}
          isActive={isActive}
          wrapLines={wrapLines}
          setProtectedEditMessage={setProtectedEditMessage}
          isLargeManifest={yamlView.isLargeManifest}
          yamlToolbarItems={yamlToolbarItems}
          cancelEdit={handleCancelClick}
          pendingOwnershipConflicts={pendingOwnershipConflicts}
          confirmOwnershipAndSave={confirmOwnershipAndSave}
          cancelOwnershipWarning={cancelOwnershipWarning}
        />
      </div>
    </div>
  );
};

export default YamlTab;
