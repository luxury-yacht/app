import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useKeyboardContext, useShortcut } from '@ui/shortcuts';
import { KeyboardContextPriority, KeyboardScopePriority } from '@ui/shortcuts/priorities';
import { useModalFocusTrap } from '@shared/components/modals/useModalFocusTrap';
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
      }, 200);
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

    pushContext({ priority: KeyboardContextPriority.SETTINGS_MODAL });
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
    description: 'Close log settings modal',
    category: 'Modals',
    enabled: isOpen,
    view: 'global',
    priority: KeyboardContextPriority.SETTINGS_MODAL,
  });

  useModalFocusTrap({
    ref: modalRef,
    focusableSelector: '[data-log-settings-focusable="true"]',
    priority: KeyboardScopePriority.SETTINGS_MODAL,
    disabled: !isOpen,
  });

  if (!shouldRender) return null;

  return createPortal(
    <div
      className={`modal-overlay log-settings-modal-overlay ${isClosing ? 'closing' : ''}`}
      onClick={onClose}
    >
      <div
        className={`modal-container log-settings-modal ${isClosing ? 'closing' : ''}`}
        onClick={(e) => e.stopPropagation()}
        ref={modalRef}
      >
        <div className="modal-header log-settings-modal-header">
          <h2>Log Settings</h2>
          <button
            className="modal-close log-settings-modal-close"
            onClick={onClose}
            aria-label="Close Log Settings"
            data-log-settings-focusable="true"
          >
            <CloseIcon />
          </button>
        </div>
        <div className="modal-content log-settings-modal-content">
          <LogSettings />
        </div>
      </div>
    </div>,
    document.body
  );
};

export default LogSettingsModal;
