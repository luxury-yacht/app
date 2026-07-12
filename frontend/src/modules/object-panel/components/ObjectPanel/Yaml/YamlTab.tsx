/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Yaml/YamlTab.tsx
 *
 * Renders the object-panel YAML editor and apply workflow. Transaction ordering
 * for baseline, draft, latest live YAML, apply, verification, and refresh lives
 * in yamlTransaction.
 */

import ClusterDataPausedState from '@shared/components/ClusterDataPausedState';
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
import { INACTIVE_SCOPE, LARGE_MANIFEST_THRESHOLD, YAML_STRINGIFY_OPTIONS } from './yamlTabConfig';
import type { YamlTabProps } from './yamlTabTypes';
import { prepareDraftYaml } from './yamlTabUtils';
import {
  buildYamlTransactionDiff,
  useYamlTransaction,
  type YamlTransactionDiffResult,
} from './yamlTransaction';

export type { YamlTabProps } from './yamlTabTypes';

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
  const [showManagedFields, setShowManagedFields] = useState(false);
  const [wrapLines, setWrapLines] = useState(true);
  const [expandedDiffs, setExpandedDiffs] = useState<Record<string, boolean>>({});
  const yamlEditorRef = useRef<YamlEditorHandle>(null);

  const effectiveScope = scope ?? INACTIVE_SCOPE;
  const snapshot = useRefreshScopedDomain('object-yaml', effectiveScope);
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

  const displayYaml = useMemo(() => {
    if (!effectiveYamlContent) {
      return effectiveYamlContent;
    }

    try {
      const doc = YAML.parseDocument(effectiveYamlContent);
      const obj = doc.toJSON();

      if (!showManagedFields && obj && obj.metadata && obj.metadata.managedFields) {
        obj.metadata.managedFields = undefined;
      }

      return YAML.stringify(obj, YAML_STRINGIFY_OPTIONS);
    } catch (e) {
      errorHandler.handle(e, { action: 'processYAML' });
      return effectiveYamlContent;
    }
  }, [effectiveYamlContent, showManagedFields]);

  const activeYaml = isEditing ? draftYaml : (displayYaml ?? '');

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
      {
        type: 'toggle' as const,
        id: 'managed-fields',
        icon: <YamlManagedFieldsIcon width={16} height={16} />,
        active: showManagedFields && !isEditing,
        onClick: handleToggleManagedFields,
        title: isEditing
          ? 'managedFields unavailable while editing'
          : showManagedFields
            ? 'Hide managedFields'
            : 'Show managedFields',
        ariaLabel: isEditing
          ? 'managedFields toggle unavailable while editing'
          : showManagedFields
            ? 'Hide managedFields'
            : 'Show managedFields',
        disabled: isEditing,
      },
      {
        type: 'toggle' as const,
        id: 'wrap-lines',
        icon: <WrapTextIcon width={20} height={20} />,
        active: wrapLines,
        onClick: handleToggleLineWrapping,
        title: wrapLines ? 'Disable YAML line wrapping' : 'Enable YAML line wrapping',
        ariaLabel: 'Wrap YAML lines',
      },
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
                onClick: handleEnterEditClick,
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
        {!!(
          isEditing &&
          (lintError || actionError || protectedEditMessage || showReloadMergeConflict)
        ) && (
          <div className="yaml-validation-message">
            {!!showReloadMergeConflict && (
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
                {!!driftDiff?.tooLarge && (
                  <p className="yaml-drift-warning">
                    {driftDiff.tooLargeMessage ??
                      'This diff is too large to display in the current view.'}{' '}
                    Reload the YAML to review the latest version before retrying.
                  </p>
                )}
              </>
            )}
            {!!lintError && <p>{lintError}</p>}
            {!!protectedEditMessage && <p>{protectedEditMessage}</p>}
            {actionError && (!lintError || actionError !== lintError) && <p>{actionError}</p>}
            {actionDetails.length > 0 && (
              <ul className="yaml-error-details">
                {withStableListKeys(actionDetails, (detail) => detail).map(
                  ({ key, value: detail }) => (
                    <li key={key}>{detail}</li>
                  )
                )}
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
                {!!postApplyNotice.diff &&
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
                  onClick={dismissPostApplyNotice}
                >
                  <CloseIcon width={14} height={14} />
                </button>
              </div>
            </div>
            {!!postApplyNotice.diff &&
              renderYamlDiff(
                postApplyNotice.diff,
                postApplyDiffKey,
                Boolean(expandedDiffs[postApplyDiffKey])
              )}
            {!!postApplyNotice.diff?.tooLarge && (
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
          lineWrapping={wrapLines}
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
              {!!(isEditing && hasRemoteDrift) && (
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
          onSecondaryAction={handleCancelClick}
          onConfirm={() => {
            void confirmOwnershipAndSave();
          }}
          onCancel={cancelOwnershipWarning}
        />
      </div>
    </div>
  );
};

export default YamlTab;
