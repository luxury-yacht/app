/**
 * frontend/src/components/modals/SettingsModal.tsx
 *
 * UI component for SettingsModal.
 * Handles rendering and interactions for the shared components.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Settings from '@ui/settings/Settings';
import { useShortcut, useKeyboardContext, useKeyboardNavigationScope } from '@ui/shortcuts';
import { KeyboardContextPriority, KeyboardScopePriority } from '@ui/shortcuts/priorities';
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

  const getFocusableControls = useCallback(() => {
    if (!modalRef.current) {
      return [];
    }
    return Array.from(
      modalRef.current.querySelectorAll<HTMLElement>('[data-settings-focusable="true"]')
    );
  }, []);

  const focusAt = useCallback(
    (index: number) => {
      const items = getFocusableControls();
      if (index < 0 || index >= items.length) {
        return false;
      }
      items[index].focus();
      return true;
    },
    [getFocusableControls]
  );

  const focusFirst = useCallback(() => focusAt(0), [focusAt]);
  const focusLast = useCallback(() => {
    const items = getFocusableControls();
    return focusAt(items.length - 1);
  }, [focusAt, getFocusableControls]);

  const findFocusedIndex = useCallback(() => {
    const items = getFocusableControls();
    const active = document.activeElement as HTMLElement | null;
    return items.findIndex((item) => item === active || item.contains(active));
  }, [getFocusableControls]);

  useKeyboardNavigationScope({
    ref: modalRef,
    priority: KeyboardScopePriority.SETTINGS_MODAL,
    disabled: !isOpen,
    onNavigate: ({ direction }) => {
      const items = getFocusableControls();
      if (items.length === 0) {
        return 'bubble';
      }
      const current = findFocusedIndex();
      if (current === -1) {
        return direction === 'forward'
          ? focusFirst()
            ? 'handled'
            : 'bubble'
          : focusLast()
            ? 'handled'
            : 'bubble';
      }
      const next = direction === 'forward' ? current + 1 : current - 1;
      if (next < 0 || next >= items.length) {
        return 'bubble';
      }
      focusAt(next);
      return 'handled';
    },
    onEnter: ({ direction }) => {
      if (direction === 'forward') {
        focusFirst();
      } else {
        focusLast();
      }
    },
  });

  if (!shouldRender) return null;

  return (
    <div
      className={`modal-overlay settings-modal-overlay ${isClosing ? 'closing' : ''}`}
      onClick={onClose}
    >
      <div
        className={`modal-container settings-modal ${isClosing ? 'closing' : ''}`}
        onClick={(e) => e.stopPropagation()}
        ref={modalRef}
      >
        <div className="modal-header settings-modal-header">
          <h2>Settings</h2>
          <button
            className="modal-close settings-modal-close"
            onClick={onClose}
            aria-label="Close Settings"
            data-settings-focusable="true"
          >
            <CloseIcon />
          </button>
        </div>
        <div className="modal-content settings-modal-content">
          <Settings />
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;
