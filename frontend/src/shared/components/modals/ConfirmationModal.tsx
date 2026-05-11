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

interface ConfirmationModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  /** Optional warning text rendered below the main message in warning style. */
  warning?: string;
  confirmText?: string;
  cancelText?: string;
  confirmButtonClass?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

const ConfirmationModalContent: React.FC<Omit<ConfirmationModalProps, 'isOpen'>> = ({
  title,
  message,
  warning,
  confirmText,
  cancelText,
  confirmButtonClass,
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
        {warning && <p className="confirmation-modal-warning">{warning}</p>}
      </div>
      <div className="confirmation-modal-footer">
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
  warning,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  confirmButtonClass = 'danger',
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
      warning={warning}
      confirmText={confirmText}
      cancelText={cancelText}
      confirmButtonClass={confirmButtonClass}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}

export default ConfirmationModal;
