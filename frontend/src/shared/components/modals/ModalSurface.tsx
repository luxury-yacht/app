import React from 'react';
import { createPortal } from 'react-dom';

interface ModalSurfaceProps {
  children: React.ReactNode;
  modalRef: React.RefObject<HTMLDivElement | null>;
  labelledBy: string;
  onClose: () => void;
  overlayClassName?: string;
  containerClassName?: string;
  isClosing?: boolean;
  closeOnBackdrop?: boolean;
}

const ModalSurface: React.FC<ModalSurfaceProps> = ({
  children,
  modalRef,
  labelledBy,
  onClose,
  overlayClassName,
  containerClassName,
  isClosing = false,
  closeOnBackdrop = true,
}) => {
  if (typeof document === 'undefined') {
    return null;
  }

  const overlayClasses = ['modal-overlay', overlayClassName, isClosing ? 'closing' : '']
    .filter(Boolean)
    .join(' ');
  const containerClasses = ['modal-container', containerClassName, isClosing ? 'closing' : '']
    .filter(Boolean)
    .join(' ');

  return createPortal(
    <div
      className={overlayClasses}
      onClick={closeOnBackdrop ? onClose : undefined}
      data-modal-surface="true"
    >
      <div
        ref={modalRef}
        className={containerClasses}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body
  );
};

export default ModalSurface;
