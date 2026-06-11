/**
 * frontend/src/components/modals/ConfirmationModal.tsx
 *
 * UI component for ConfirmationModal.
 * Handles rendering and interactions for the shared components.
 */

import React, { useRef } from 'react';
import { useModalFocusTrap } from './useModalFocusTrap';
import ModalSurface from './ModalSurface';
import ModalHeader from './ModalHeader';
import { WarningTriangleIcon } from '@shared/components/icons/SharedIcons';
import './ConfirmationModal.css';

export interface ConfirmationModalTableColumn {
  header: string;
  /** Render this column's cells in fixed-width font (paths, names, code). */
  monospace?: boolean;
}

export interface ConfirmationModalDetailsTable {
  columns: ConfirmationModalTableColumn[];
  rows: string[][];
}

interface ConfirmationModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  /** Optional table rendered between the message and the warning. */
  detailsTable?: ConfirmationModalDetailsTable;
  /** Optional warning text rendered below the main message in warning style. */
  warning?: string;
  confirmText?: string;
  cancelText?: string;
  confirmButtonClass?: string;
  /** Optional third action rendered on the left side of the footer. */
  secondaryActionText?: string;
  secondaryActionButtonClass?: string;
  onSecondaryAction?: () => void;
  onConfirm: () => void;
  onCancel: () => void;
}

const ConfirmationModalContent: React.FC<Omit<ConfirmationModalProps, 'isOpen'>> = ({
  title,
  message,
  detailsTable,
  warning,
  confirmText,
  cancelText,
  confirmButtonClass,
  secondaryActionText,
  secondaryActionButtonClass,
  onSecondaryAction,
  onConfirm,
  onCancel,
}) => {
  const modalRef = useRef<HTMLDivElement>(null);

  useModalFocusTrap({
    ref: modalRef,
    onEscape: () => {
      onCancel();
      return true;
    },
  });

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
        <p>{message}</p>
        {detailsTable && detailsTable.rows.length > 0 && (
          <div className="confirmation-modal-details-scroll">
            <table className="confirmation-modal-details-table">
              <thead>
                <tr>
                  {detailsTable.columns.map((column) => (
                    <th key={column.header}>{column.header}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {detailsTable.rows.map((row, rowIndex) => (
                  <tr key={`${rowIndex}-${row.join('|')}`}>
                    {row.map((cell, columnIndex) => (
                      <td
                        key={detailsTable.columns[columnIndex]?.header ?? columnIndex}
                        className={
                          detailsTable.columns[columnIndex]?.monospace ? 'monospace' : undefined
                        }
                      >
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {warning && <p className="confirmation-modal-warning">{warning}</p>}
      </div>
      <div className="confirmation-modal-footer">
        {secondaryActionText && onSecondaryAction && (
          <button
            className={`button ${secondaryActionButtonClass} confirmation-modal-secondary-action`}
            onClick={onSecondaryAction}
          >
            {secondaryActionText}
          </button>
        )}
        <button className="button cancel" onClick={onCancel}>
          {cancelText}
        </button>
        <button className={`button ${confirmButtonClass}`} onClick={onConfirm} autoFocus>
          {confirmText}
        </button>
      </div>
    </ModalSurface>
  );
};

function ConfirmationModal({
  isOpen,
  title,
  message,
  detailsTable,
  warning,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  confirmButtonClass = 'danger',
  secondaryActionText,
  secondaryActionButtonClass = 'secondary',
  onSecondaryAction,
  onConfirm,
  onCancel,
}: ConfirmationModalProps) {
  if (!isOpen) {
    return null;
  }

  return (
    <ConfirmationModalContent
      title={title}
      message={message}
      detailsTable={detailsTable}
      warning={warning}
      secondaryActionText={secondaryActionText}
      secondaryActionButtonClass={secondaryActionButtonClass}
      onSecondaryAction={onSecondaryAction}
      confirmText={confirmText}
      cancelText={cancelText}
      confirmButtonClass={confirmButtonClass}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}

export default ConfirmationModal;
