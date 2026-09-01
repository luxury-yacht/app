/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Yaml/YamlTab.tsx
 *
 * Renders the object-panel YAML editor and apply workflow. Transaction ordering
 * for baseline, draft, latest live YAML, apply, verification, and refresh lives
 * in yamlTransaction.
 */

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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { resolveProtectedYamlRanges } from './yamlFieldPolicy';
import { getYamlPanelBlockReason } from './yamlPanelGuard';
import { INACTIVE_SCOPE, LARGE_MANIFEST_THRESHOLD, YAML_STRINGIFY_OPTIONS } from './yamlTabConfig';
import type { YamlTabProps } from './yamlTabTypes';
import { prepareDraftYaml } from './yamlTabUtils';
import {
  buildYamlTransactionDiff,
  useYamlTransaction,
  type YamlTransactionDiffResult,
} from './yamlTransaction';

const renderYamlDiffToggle = (
  diff: YamlTransactionDiffResult,
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

const renderYamlDiff = (
  diff: YamlTransactionDiffResult,
  keyPrefix: string,
  showFullDiff: boolean
) => {
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
  );
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
  disableSave,
  canEdit,
  editDisabledReason,
  cancelEdit,
  saveYaml,
  enterEdit,
}: {
  isEditing: boolean;
  isSaving: boolean;
  disableSave: boolean;
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
      },
      {
        type: 'action',
        id: 'save-yaml',
        icon: <YamlSaveIcon width={16} height={16} />,
        onClick: saveYaml,
        title: isSaving ? 'Saving YAML' : 'Save YAML',
        ariaLabel: 'Save YAML',
        disabled: disableSave,
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
    ...buildYamlEditItems({ ...editOptions, isEditing }),
  ];
};

const isYamlSnapshotLoading = (status: string, yamlContent: string): boolean =>
  status === 'loading' || status === 'initialising' || (status === 'updating' && !yamlContent);

const YamlBlockingState = ({
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

const shouldShowYamlBlockingState = (
  loading: boolean,
  paused: boolean,
  error: string | null,
  hasContent: boolean
): boolean => loading || paused || Boolean(error) || !hasContent;

type YamlNoticeDiffProps = {
  diff: YamlTransactionDiffResult | null;
  diffKey: string;
  expandedDiffs: Record<string, boolean>;
  toggleDiffExpansion: (key: string) => void;
};

const YamlDriftConflictNotice = ({
  show,
  diff,
  diffKey,
  expandedDiffs,
  toggleDiffExpansion,
}: YamlNoticeDiffProps & { show: boolean }) => {
  if (!show) {
    return null;
  }
  const showFullDiff = Boolean(expandedDiffs[diffKey]);
  return (
    <>
      <div className="yaml-notice-header">
        <p>
          Reload &amp; merge could not reconcile your draft with the latest YAML. Your draft is
          unchanged. Save will still patch your edited fields onto the live object, like kubectl
          edit.
        </p>
        {!!diff && renderYamlDiffToggle(diff, diffKey, showFullDiff, toggleDiffExpansion)}
      </div>
      {!!diff && renderYamlDiff(diff, diffKey, showFullDiff)}
      {!!diff?.tooLarge && (
        <p className="yaml-drift-warning">
          {diff.tooLargeMessage ?? 'This diff is too large to display in the current view.'} Reload
          the YAML to review the latest version before retrying.
        </p>
      )}
    </>
  );
};

const YamlValidationNotice = ({
  isEditing,
  lintError,
  actionError,
  actionDetails,
  protectedEditMessage,
  showReloadMergeConflict,
  ...diffProps
}: YamlNoticeDiffProps & {
  isEditing: boolean;
  lintError: string | null;
  actionError: string | null;
  actionDetails: string[];
  protectedEditMessage: string | null;
  showReloadMergeConflict: boolean;
}) => {
  const hasMessage = Boolean(
    lintError || actionError || protectedEditMessage || showReloadMergeConflict
  );
  if (!isEditing || !hasMessage) {
    return null;
  }
  return (
    <div className="yaml-validation-message">
      <YamlDriftConflictNotice show={showReloadMergeConflict} {...diffProps} />
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
  const showFullDiff = Boolean(diffProps.expandedDiffs[diffProps.diffKey]);
  return (
    <div
      className={`yaml-post-apply-notice yaml-post-apply-notice-${notice.kind}`}
      role="status"
      aria-live="polite"
    >
      <div className="yaml-notice-header">
        <p>{notice.message}</p>
        <div className="yaml-notice-actions">
          {!!notice.diff &&
            renderYamlDiffToggle(
              notice.diff,
              diffProps.diffKey,
              showFullDiff,
              diffProps.toggleDiffExpansion
            )}
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
      {!!notice.diff && renderYamlDiff(notice.diff, diffProps.diffKey, showFullDiff)}
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

const getYamlViewModel = ({
  isEditing,
  draftYaml,
  displayYaml,
  lintError,
  hasServerYamlError,
  isSaving,
  backendDriftCurrentYaml,
  driftForced,
  postApplyNotice,
}: {
  isEditing: boolean;
  draftYaml: string;
  displayYaml: string | null | undefined;
  lintError: string | null;
  hasServerYamlError: boolean;
  isSaving: boolean;
  backendDriftCurrentYaml: string | null;
  driftForced: boolean;
  postApplyNotice: ReturnType<typeof useYamlTransaction>['postApplyNotice'];
}) => {
  const activeYaml = isEditing ? draftYaml : (displayYaml ?? '');
  const hasYamlError = Boolean(lintError) || hasServerYamlError;
  return {
    activeYaml,
    editorValue: activeYaml,
    disableSave: isSaving || hasYamlError,
    showReloadMergeConflict: Boolean(backendDriftCurrentYaml) || driftForced,
    driftDiffKey: backendDriftCurrentYaml ? 'drift-backend' : 'drift-live',
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
  hasRemoteDrift: boolean;
  reloadAndMerge: () => void;
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
  hasRemoteDrift,
  reloadAndMerge,
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
      toolbarActions={
        <>
          <IconBar items={yamlToolbarItems} />
          {!!(isEditing && hasRemoteDrift) && (
            <button
              className="button secondary"
              type="button"
              onClick={reloadAndMerge}
              disabled={isSaving}
            >
              Reload &amp; merge
            </button>
          )}
        </>
      }
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
  const yamlError = snapshot.error ?? null;

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
    showManagedFields,
    prepareVisibleDraftYaml,
  });

  usePanelLifecycleGuard(panelId, () => {
    const reason = getYamlPanelBlockReason({
      isEditing,
      isSaving,
      draftYaml,
      baselineYaml: effectiveYamlContent ?? '',
    });
    if (!reason) {
      return null;
    }
    return {
      reason,
      focus: () => {
        if (panelId) {
          objectPanelState?.setObjectPanelActiveTab(panelId, 'yaml');
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

  const driftDiff = useMemo(() => {
    if (backendDriftCurrentYaml) {
      return buildYamlTransactionDiff(backendDriftCurrentYaml, draftYaml);
    }
    if (!isEditing || (!hasRemoteDrift && !driftForced)) {
      return null;
    }
    const latestYaml = displayYaml ?? '';
    if (!latestYaml) {
      return null;
    }
    return buildYamlTransactionDiff(latestYaml, draftYaml);
  }, [backendDriftCurrentYaml, displayYaml, draftYaml, driftForced, hasRemoteDrift, isEditing]);

  const yamlView = getYamlViewModel({
    isEditing,
    draftYaml,
    displayYaml,
    lintError,
    hasServerYamlError,
    isSaving,
    backendDriftCurrentYaml,
    driftForced,
    postApplyNotice,
  });

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
    // route to the surface that contains the focused element.
    window.requestAnimationFrame(() => yamlEditorRef.current?.focus());
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
    category: 'YAML Tab',
    enabled: true,
    priority: 20,
  });

  useShortcut({
    key: 's',
    modifiers: { meta: true },
    handler: () => runYamlEditShortcut(isEditing, isSaving, handleSaveClick),
    description: 'Save YAML changes',
    category: 'YAML Tab',
    enabled: canUseYamlEditShortcut(isEditing, isSaving),
    priority: 30,
  });

  useShortcut({
    key: 's',
    modifiers: { ctrl: true },
    handler: () => runYamlEditShortcut(isEditing, isSaving, handleSaveClick),
    description: 'Save YAML changes',
    category: 'YAML Tab',
    enabled: canUseYamlEditShortcut(isEditing, isSaving),
    priority: 30,
  });

  useShortcut({
    key: 'Escape',
    handler: () => runYamlEditShortcut(isEditing, isSaving, handleCancelClick),
    description: 'Cancel YAML edit',
    category: 'YAML Tab',
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
        disableSave: yamlView.disableSave,
        canEdit,
        editDisabledReason,
        cancelEdit: handleCancelClick,
        saveYaml: handleSaveClick,
        enterEdit: handleEnterEditClick,
      }),
    [
      canEdit,
      yamlView.disableSave,
      editDisabledReason,
      handleCancelClick,
      handleEnterEditClick,
      handleSaveClick,
      handleToggleLineWrapping,
      handleToggleManagedFields,
      isEditing,
      isSaving,
      showManagedFields,
      wrapLines,
    ]
  );

  if (
    shouldShowYamlBlockingState(yamlLoading, showPausedYamlState, yamlError, Boolean(yamlContent))
  ) {
    return (
      <YamlBlockingState
        loading={yamlLoading}
        paused={showPausedYamlState}
        error={yamlError}
        hasContent={Boolean(yamlContent)}
      />
    );
  }

  return (
    <div className="object-panel-tab-content">
      <div className="yaml-display">
        <YamlValidationNotice
          isEditing={isEditing}
          lintError={lintError}
          actionError={actionError}
          actionDetails={actionDetails}
          protectedEditMessage={protectedEditMessage}
          showReloadMergeConflict={yamlView.showReloadMergeConflict}
          diff={driftDiff}
          diffKey={yamlView.driftDiffKey}
          expandedDiffs={expandedDiffs}
          toggleDiffExpansion={toggleDiffExpansion}
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
          value={yamlView.editorValue}
          onChange={handleEditorChange}
          isEditing={isEditing}
          isSaving={isSaving}
          isActive={isActive}
          wrapLines={wrapLines}
          setProtectedEditMessage={setProtectedEditMessage}
          isLargeManifest={yamlView.isLargeManifest}
          yamlToolbarItems={yamlToolbarItems}
          hasRemoteDrift={hasRemoteDrift}
          reloadAndMerge={handleReloadAndMerge}
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
