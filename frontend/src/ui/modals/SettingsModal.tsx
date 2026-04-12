/**
 * frontend/src/components/modals/SettingsModal.tsx
 *
 * UI component for SettingsModal.
 * Handles rendering and interactions for the shared components.
 */

import React, { useEffect, useRef, useState } from 'react';
import Settings from '@ui/settings/Settings';
import { useShortcut, useKeyboardContext } from '@ui/shortcuts';
import { KeyboardContextPriority } from '@ui/shortcuts/priorities';
import { useModalFocusTrap } from '@shared/components/modals/useModalFocusTrap';
import ModalSurface from '@shared/components/modals/ModalSurface';
import { CloseIcon } from '@shared/components/icons/MenuIcons';
import './SettingsModal.css';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
  const [isClosing, setIsClosing] = useState(false);
  const [shouldRender, setShouldRender] = useState(false);
  const { pushContext, popContext } = useKeyboardContext();
  const contextPushedRef = useRef(false);
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
      }, 200); // Match the animation duration
      return () => clearTimeout(timer);
    }
  }, [isOpen, shouldRender]);

  useEffect(() => {
    if (!isOpen) {
      if (contextPushedRef.current) {
        popContext();
        contextPushedRef.current = false;
      }
      document.body.style.overflow = '';
      return;
    }

    pushContext({ panelOpen: 'settings', priority: KeyboardContextPriority.SETTINGS_MODAL });
    contextPushedRef.current = true;
    document.body.style.overflow = 'hidden';

    return () => {
      if (contextPushedRef.current) {
        popContext();
        contextPushedRef.current = false;
      }
      document.body.style.overflow = '';
    };
  }, [isOpen, popContext, pushContext]);

  useShortcut({
    key: 'Escape',
    handler: () => {
      if (!isOpen) return false;
      onClose();
      return true;
    },
    description: 'Close settings modal',
    category: 'Modals',
    enabled: isOpen,
    view: 'global',
    whenPanelOpen: 'settings',
    priority: KeyboardContextPriority.SETTINGS_MODAL,
  });

  useModalFocusTrap({
    ref: modalRef,
    disabled: !shouldRender,
  });

  if (!shouldRender) return null;

  return (
    <ModalSurface
      modalRef={modalRef}
      labelledBy="settings-modal-title"
      onClose={onClose}
      overlayClassName="settings-modal-overlay"
      containerClassName="settings-modal"
      isClosing={isClosing}
    >
      <div className="modal-header settings-modal-header">
        <h2 id="settings-modal-title">Settings</h2>
        <button
          className="modal-close settings-modal-close"
          onClick={onClose}
          aria-label="Close Settings"
        >
          <CloseIcon />
        </button>
      </div>
      <div className="modal-content settings-modal-content">
        <Settings />
      </div>
    </ModalSurface>
  );
};

export default SettingsModal;
