/**
 * frontend/src/components/modals/ConfirmationModal.tsx
 *
 * UI component for ConfirmationModal.
 * Handles rendering and interactions for the shared components.
 */

import React, { useEffect, useRef } from 'react';
import { useShortcut, useKeyboardContext } from '@ui/shortcuts';
import { useModalFocusTrap } from './useModalFocusTrap';
import { KeyboardContextPriority } from '@ui/shortcuts/priorities';
import ModalSurface from './ModalSurface';
import './ConfirmationModal.css';

interface ConfirmationModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  confirmButtonClass?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

const ConfirmationModalContent: React.FC<Omit<ConfirmationModalProps, 'isOpen'>> = ({
  title,
  message,
  confirmText,
  cancelText,
  confirmButtonClass,
  onConfirm,
  onCancel,
}) => {
  const { pushContext, popContext } = useKeyboardContext();
  const contextPushedRef = useRef(false);
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    pushContext({ priority: KeyboardContextPriority.CONFIRMATION_MODAL });
    contextPushedRef.current = true;
    return () => {
      if (contextPushedRef.current) {
        popContext();
        contextPushedRef.current = false;
      }
    };
  }, [popContext, pushContext]);

  useShortcut({
    key: 'Escape',
    handler: () => {
      onCancel();
      return true;
    },
    description: 'Cancel dialog',
    category: 'Modals',
    enabled: true,
    view: 'global',
    priority: KeyboardContextPriority.CONFIRMATION_MODAL,
  });

  useModalFocusTrap({
    ref: modalRef,
  });

  return (
    <ModalSurface
      modalRef={modalRef}
      labelledBy="confirmation-modal-title"
      onClose={onCancel}
      overlayClassName="confirmation-modal-backdrop"
      containerClassName="confirmation-modal"
      closeOnBackdrop={true}
    >
      <div className="modal-header confirmation-modal-header">
        <h2 id="confirmation-modal-title">{title}</h2>
      </div>
      <div className="confirmation-modal-body">
        <p>{message}</p>
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
      confirmText={confirmText}
      cancelText={cancelText}
      confirmButtonClass={confirmButtonClass}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}

export default ConfirmationModal;
