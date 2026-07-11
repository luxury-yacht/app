import type React from 'react';
import { useEffect } from 'react';
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

let openModalSurfaceCount = 0;

const ModalSurface: React.FC<ModalSurfaceProps> = ({
  children,
  modalRef,
  labelledBy,
  onClose,
  overlayClassName,
  containerClassName,
  isClosing = false,
  closeOnBackdrop = false,
}) => {
  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }
    openModalSurfaceCount += 1;
    document.body.classList.add('modal-surface-open');

    return () => {
      openModalSurfaceCount = Math.max(0, openModalSurfaceCount - 1);
      if (openModalSurfaceCount === 0) {
        document.body.classList.remove('modal-surface-open');
      }
    };
  }, []);

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
    <div className={overlayClasses} data-modal-surface="true">
      <div className="modal-window-drag-region" aria-hidden="true" />
      <div className="modal-backdrop">
        {!!closeOnBackdrop && (
          <button
            type="button"
            className="modal-backdrop-dismiss"
            aria-label="Close dialog"
            tabIndex={-1}
            onClick={onClose}
          />
        )}
        <div
          ref={modalRef}
          className={containerClasses}
          role="dialog"
          aria-modal="true"
          aria-labelledby={labelledBy}
          tabIndex={-1}
        >
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
};

export default ModalSurface;
