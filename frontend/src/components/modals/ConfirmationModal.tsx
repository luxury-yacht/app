/**
 * frontend/src/components/modals/ConfirmationModal.tsx
 *
 * UI component for ConfirmationModal.
 * Handles rendering and interactions for the shared components.
 */

import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useShortcut, useKeyboardContext } from '@ui/shortcuts';
import { useModalFocusTrap } from './useModalFocusTrap';
import { KeyboardContextPriority, KeyboardScopePriority } from '@ui/shortcuts/priorities';
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

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onCancel();
    }
  };

  useModalFocusTrap({
    ref: modalRef,
    focusableSelector: '[data-confirmation-focusable="true"]',
    priority: KeyboardScopePriority.CONFIRMATION_MODAL,
  });

  return (
    <div className="modal-overlay confirmation-modal-backdrop" onClick={handleBackdropClick}>
      <div className="modal-container confirmation-modal">
        <div className="modal-header confirmation-modal-header">
          <h2>{title}</h2>
        </div>
        <div className="confirmation-modal-body">
          <p>{message}</p>
        </div>
        <div className="confirmation-modal-footer">
          <button
            className="button cancel"
            onClick={onCancel}
            data-confirmation-focusable="true"
            tabIndex={-1}
          >
            {cancelText}
          </button>
          <button
            className={`button ${confirmButtonClass}`}
            onClick={onConfirm}
            autoFocus
            data-confirmation-focusable="true"
            tabIndex={-1}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
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
  if (!isOpen || typeof document === 'undefined') {
    return null;
  }

  return createPortal(
    <ConfirmationModalContent
      title={title}
      message={message}
      confirmText={confirmText}
      cancelText={cancelText}
      confirmButtonClass={confirmButtonClass}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />,
    document.body
  );
}

export default ConfirmationModal;
