import React, { useEffect, useRef, useState } from 'react';
import { useModalFocusTrap } from '@shared/components/modals/useModalFocusTrap';
import ModalSurface from '@shared/components/modals/ModalSurface';
import { CloseIcon } from '@shared/components/icons/MenuIcons';
import ObjPanelLogsSettings from '@modules/object-panel/components/ObjectPanel/Logs/ObjPanelLogsSettings';
import './ObjPanelLogsSettingsModal.css';

interface ObjPanelLogsSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const ObjPanelLogsSettingsModal: React.FC<ObjPanelLogsSettingsModalProps> = ({
  isOpen,
  onClose,
}) => {
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
      labelledBy="obj-panel-logs-settings-modal-title"
      onClose={onClose}
      overlayClassName="obj-panel-logs-settings-modal-overlay"
      containerClassName="obj-panel-logs-settings-modal"
      isClosing={isClosing}
    >
      <div className="modal-header obj-panel-logs-settings-modal-header">
        <h2 id="obj-panel-logs-settings-modal-title">Object Panel Logs Tab Settings</h2>
        <button
          className="modal-close obj-panel-logs-settings-modal-close"
          onClick={onClose}
          aria-label="Close Object Panel Logs Tab Settings"
        >
          <CloseIcon />
        </button>
      </div>
      <div className="modal-content obj-panel-logs-settings-modal-content">
        <ObjPanelLogsSettings />
      </div>
    </ModalSurface>
  );
};

export default ObjPanelLogsSettingsModal;
