import ObjPanelLogsSettings from '@modules/object-panel/components/ObjectPanel/Logs/ObjPanelLogsSettings';
import { LogsIcon } from '@shared/components/icons/SharedIcons';
import ModalHeader from '@shared/components/modals/ModalHeader';
import ModalSurface from '@shared/components/modals/ModalSurface';
import { useModalFocusTrap } from '@shared/components/modals/useModalFocusTrap';
import type React from 'react';
import { useEffect, useRef, useState } from 'react';
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
      if (!isOpen) {
        return false;
      }
      onClose();
      return true;
    },
  });

  if (!shouldRender) {
    return null;
  }

  return (
    <ModalSurface
      modalRef={modalRef}
      labelledBy="obj-panel-logs-settings-modal-title"
      onClose={onClose}
      overlayClassName="obj-panel-logs-settings-modal-overlay"
      containerClassName="obj-panel-logs-settings-modal"
      isClosing={isClosing}
    >
      <ModalHeader
        title="Object Panel Logs Tab Settings"
        titleId="obj-panel-logs-settings-modal-title"
        icon={LogsIcon}
        onClose={onClose}
        closeLabel="Close Object Panel Logs Tab Settings"
        closeClassName="obj-panel-logs-settings-modal-close"
      />
      <div className="modal-content obj-panel-logs-settings-modal-content">
        <ObjPanelLogsSettings />
      </div>
    </ModalSurface>
  );
};

export default ObjPanelLogsSettingsModal;
