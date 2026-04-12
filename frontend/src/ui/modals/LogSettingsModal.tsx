import React, { useEffect, useRef, useState } from 'react';
import { useModalFocusTrap } from '@shared/components/modals/useModalFocusTrap';
import ModalSurface from '@shared/components/modals/ModalSurface';
import { CloseIcon } from '@shared/components/icons/MenuIcons';
import LogSettings from '@modules/object-panel/components/ObjectPanel/Logs/LogSettings';
import './LogSettingsModal.css';

interface LogSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const LogSettingsModal: React.FC<LogSettingsModalProps> = ({ isOpen, onClose }) => {
  const [isClosing, setIsClosing] = useState(false);
  const [shouldRender, setShouldRender] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      setShouldRender(true);
      setIsClosing(false);
    } else if (shouldRender) {
      setIsClosing(true);
      const timer = setTimeout(() => {
        setShouldRender(false);
        setIsClosing(false);
      }, 200);
      return () => clearTimeout(timer);
    }
  }, [isOpen, shouldRender]);

  useEffect(() => {
    document.body.style.overflow = isOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  useModalFocusTrap({
    ref: modalRef,
    disabled: !shouldRender,
    onEscape: () => {
      if (!isOpen) return false;
      onClose();
      return true;
    },
  });

  if (!shouldRender) return null;

  return (
    <ModalSurface
      modalRef={modalRef}
      labelledBy="log-settings-modal-title"
      onClose={onClose}
      overlayClassName="log-settings-modal-overlay"
      containerClassName="log-settings-modal"
      isClosing={isClosing}
    >
      <div className="modal-header log-settings-modal-header">
        <h2 id="log-settings-modal-title">Log Settings</h2>
        <button
          className="modal-close log-settings-modal-close"
          onClick={onClose}
          aria-label="Close Log Settings"
        >
          <CloseIcon />
        </button>
      </div>
      <div className="modal-content log-settings-modal-content">
        <LogSettings />
      </div>
    </ModalSurface>
  );
};

export default LogSettingsModal;
