/**
 * frontend/src/components/modals/ConfirmationModal.tsx
 *
 * UI component for ConfirmationModal.
 * Handles rendering and interactions for the shared components.
 */

import { WarningTriangleIcon } from '@shared/components/icons/SharedIcons';
import { kindDisplayName } from '@shared/kinds/kindDisplay';
import { getKindBadgeClassName } from '@shared/utils/kindBadgeColors';
import { withStableListKeys } from '@shared/utils/stableListKeys';
import type React from 'react';
import { useEffect, useRef } from 'react';
import { useClusterNameResolver } from '@/core/cluster-workspace/useClusterWorkspace';
import { usePreference } from '@/core/settings/usePreference';
import ModalHeader from './ModalHeader';
import ModalSurface from './ModalSurface';
import { useModalFocusTrap } from './useModalFocusTrap';
import './ConfirmationModal.css';

export interface ConfirmationModalTableColumn {
  header: string;
  /** Render this column's cells in fixed-width font (paths, names, code). */
  monospace?: boolean;
}

export interface ConfirmationModalDetailsTable {
  columns: ConfirmationModalTableColumn[];
  rows: string[][];
  /** The table may hold many rows: it scrolls, and fixed-width values truncate. */
  longList?: boolean;
}

/** The cluster object a confirmation acts on. */
export interface ConfirmationModalTarget {
  clusterId: string;
  group: string;
  kind: string;
  name: string;
  namespace?: string;
}

/** One more fact about what is being acted on, such as the finalizer being removed. */
export interface ConfirmationModalTargetDetail {
  label: string;
  value: string;
}

interface ConfirmationModalProps {
  isOpen: boolean;
  title: string;
  /** The object being acted on. The message then states only the consequence. */
  target?: ConfirmationModalTarget;
  targetDetail?: ConfirmationModalTargetDetail;
  message?: string;
  /** Optional table rendered between the message and the warning. */
  detailsTable?: ConfirmationModalDetailsTable;
  /** Optional notice rendered between the main content and warning. */
  notice?: string;
  /** Optional warning text rendered below the main message in warning style. */
  warning?: string;
  confirmText?: string;
  cancelText?: string;
  confirmButtonClass?: string;
  /** Optional third action rendered on the left side of the footer. */
  secondaryActionText?: string;
  secondaryActionButtonClass?: string;
  onSecondaryAction?: () => void;
  /** Leave out for a dialog that only reports: it then has just the cancel button. */
  onConfirm?: () => void;
  onCancel: () => void;
  /** Disables the footer while the confirmed work runs. */
  busy?: boolean;
  /**
   * Names what the dialog asks, for a dialog that stays open while that changes
   * (confirm, then results, then confirm again). Each new question starts with
   * focus on the non-destructive action, as opening does.
   */
  promptId?: string;
}

const ConfirmationTarget: React.FC<{
  target: ConfirmationModalTarget;
  detail?: ConfirmationModalTargetDetail;
}> = ({ target, detail }) => {
  const resolveClusterName = useClusterNameResolver();
  const shortNames = usePreference('useShortResourceNames');
  return (
    <div className="confirmation-modal-target">
      <div className="confirmation-modal-target-object">
        <span className={getKindBadgeClassName(target.kind)}>
          {kindDisplayName(target, shortNames)}
        </span>
        <span className="confirmation-modal-target-name">{target.name}</span>
      </div>
      {!!target.namespace && (
        <div className="confirmation-modal-target-line">Namespace {target.namespace}</div>
      )}
      <div className="confirmation-modal-target-line">
        Cluster {resolveClusterName(target.clusterId) ?? target.clusterId}
      </div>
      {!!detail && (
        <div className="confirmation-modal-target-line">
          {detail.label} <code>{detail.value}</code>
        </div>
      )}
    </div>
  );
};

const ConfirmationDetailsTable: React.FC<{ table: ConfirmationModalDetailsTable }> = ({
  table,
}) => (
  <div
    className={`confirmation-modal-details-scroll${table.longList ? ' confirmation-modal-details-scroll--long' : ''}`}
  >
    <table className="confirmation-modal-details-table">
      <thead>
        <tr>
          {table.columns.map((column) => (
            <th key={column.header}>{column.header}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {withStableListKeys(table.rows, (row) => row.join('|')).map(({ key, value: row }) => (
          <tr key={key}>
            {row.map((cell, columnIndex) => {
              const column = table.columns[columnIndex];
              // A long list truncates its fixed-width values; the full text stays on hover.
              const fullText = table.longList && column?.monospace ? cell : undefined;
              return (
                <td
                  key={column?.header ?? columnIndex}
                  className={column?.monospace ? 'monospace' : undefined}
                  title={fullText}
                >
                  {cell}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

const ConfirmationModalContent: React.FC<Omit<ConfirmationModalProps, 'isOpen'>> = ({
  title,
  target,
  targetDetail,
  message,
  detailsTable,
  notice,
  warning,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  confirmButtonClass = 'danger',
  secondaryActionText,
  secondaryActionButtonClass = 'generic',
  onSecondaryAction,
  onConfirm,
  onCancel,
  busy = false,
  promptId = '',
}) => {
  const modalRef = useRef<HTMLDivElement>(null);

  const { focusDefaultControl } = useModalFocusTrap({
    ref: modalRef,
    suppressShortcuts: busy,
    onEscape: () => {
      onCancel();
      return true;
    },
  });

  // What the dialog asks now; nothing while its work runs. When it settles on a new
  // question, the control that held focus may be disabled, gone, or now mean
  // something destructive, so focus starts again on the non-destructive action.
  const prompt = busy ? null : promptId;
  const lastPrompt = useRef(prompt);
  useEffect(() => {
    if (prompt !== null && prompt !== lastPrompt.current) {
      focusDefaultControl();
    }
    lastPrompt.current = prompt;
  }, [prompt, focusDefaultControl]);

  return (
    <ModalSurface
      modalRef={modalRef}
      labelledBy="confirmation-modal-title"
      onClose={onCancel}
      overlayClassName="confirmation-modal-backdrop"
      containerClassName="confirmation-modal"
    >
      <ModalHeader
        title={title}
        titleId="confirmation-modal-title"
        icon={WarningTriangleIcon}
        onClose={onCancel}
      />
      <div className="confirmation-modal-body">
        {!!target && <ConfirmationTarget target={target} detail={targetDetail} />}
        {!!message && <p>{message}</p>}
        {detailsTable && detailsTable.rows.length > 0 && (
          <ConfirmationDetailsTable table={detailsTable} />
        )}
        {!!notice && <p className="confirmation-modal-notice">{notice}</p>}
        {!!warning && <p className="confirmation-modal-warning">{warning}</p>}
      </div>
      <div className="confirmation-modal-footer">
        {!!(secondaryActionText && onSecondaryAction) && (
          <button
            type="button"
            className={`button ${secondaryActionButtonClass} confirmation-modal-secondary-action`}
            onClick={onSecondaryAction}
          >
            {secondaryActionText}
          </button>
        )}
        <button
          type="button"
          className="button cancel"
          onClick={onCancel}
          disabled={busy}
          data-modal-initial-focus
        >
          {cancelText}
        </button>
        {!!onConfirm && (
          <button
            type="button"
            className={`button ${confirmButtonClass}`}
            onClick={onConfirm}
            disabled={busy}
          >
            {confirmText}
          </button>
        )}
      </div>
    </ModalSurface>
  );
};

function ConfirmationModal({ isOpen, ...props }: Readonly<ConfirmationModalProps>) {
  return isOpen ? <ConfirmationModalContent {...props} /> : null;
}

export default ConfirmationModal;
