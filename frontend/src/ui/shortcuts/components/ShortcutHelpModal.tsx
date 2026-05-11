/**
 * frontend/src/ui/shortcuts/components/ShortcutHelpModal.tsx
 *
 * UI component for ShortcutHelpModal.
 * Handles rendering and interactions for the shared components.
 */

import React, { useRef, useState, useEffect } from 'react';
import { useKeyboardContext } from '../context';
import { CategoryIcon, ShortcutArrowIcon } from '@shared/components/icons/SharedIcons';
import ModalSurface from '@shared/components/modals/ModalSurface';
import ModalHeader from '@shared/components/modals/ModalHeader';
import { useModalFocusTrap } from '@shared/components/modals/useModalFocusTrap';
import './ShortcutHelpModal.css';

interface ShortcutHelpModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ShortcutHelpModal({ isOpen, onClose }: ShortcutHelpModalProps) {
  const { getAvailableShortcuts } = useKeyboardContext();
  const [shortcuts, setShortcuts] = useState(getAvailableShortcuts());
  const [isClosing, setIsClosing] = useState(false);
  const [shouldRender, setShouldRender] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);

  // Handle open/close animation states
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

  // Update shortcuts when context changes
  useEffect(() => {
    if (isOpen) {
      setShortcuts(getAvailableShortcuts());
    }
  }, [isOpen, getAvailableShortcuts]);

  useModalFocusTrap({
    ref: modalRef,
    disabled: !shouldRender,
    suppressShortcuts: true,
    onEscape: () => {
      onClose();
      return true;
    },
    onKeyDown: (event) => {
      if (event.key === '/' || event.key === '?') {
        onClose();
        return true;
      }
      return false;
    },
  });

  if (!shouldRender) return null;

  return (
    <ModalSurface
      modalRef={modalRef}
      labelledBy="shortcut-help-modal-title"
      onClose={onClose}
      overlayClassName="shortcut-help-modal-overlay"
      containerClassName="shortcut-help-modal"
      isClosing={isClosing}
      closeOnBackdrop={true}
    >
      <ModalHeader
        title="Keyboard Shortcuts"
        titleId="shortcut-help-modal-title"
        icon={CategoryIcon}
        onClose={onClose}
        closeClassName="shortcut-help-modal-close"
      />

      <div className="modal-content shortcut-help-modal-content">
        {shortcuts.length === 0 ? (
          <p className="no-shortcuts">No shortcuts available in this context</p>
        ) : (
          shortcuts.map((group) => (
            <div key={group.category} className="shortcut-group">
              <h3>{group.category}</h3>
              <div className="shortcut-list">
                {group.shortcuts.map((shortcut, index) => {
                  // Build key combination display
                  const keyParts = [];
                  const isMac = navigator.userAgent.includes('Mac');

                  if (shortcut.modifiers?.meta) {
                    keyParts.push(<kbd key="meta">{isMac ? '⌘' : 'Win'}</kbd>);
                  }
                  if (shortcut.modifiers?.ctrl) {
                    keyParts.push(<kbd key="ctrl">{isMac ? '⌃' : 'Ctrl'}</kbd>);
                  }
                  if (shortcut.modifiers?.alt) {
                    keyParts.push(<kbd key="alt">{isMac ? '⌥' : 'Alt'}</kbd>);
                  }
                  if (shortcut.modifiers?.shift) {
                    keyParts.push(<kbd key="shift">{isMac ? '⇧' : 'Shift'}</kbd>);
                  }

                  let keyContent: React.ReactNode;
                  if (shortcut.key === 'ArrowLeft') {
                    keyContent = <ShortcutArrowIcon direction="left" />;
                  } else if (shortcut.key === 'ArrowRight') {
                    keyContent = <ShortcutArrowIcon direction="right" />;
                  } else if (shortcut.key === 'ArrowUp') {
                    keyContent = <ShortcutArrowIcon direction="up" />;
                  } else if (shortcut.key === 'ArrowDown') {
                    keyContent = <ShortcutArrowIcon direction="down" />;
                  } else {
                    const formattedKey =
                      shortcut.key.length === 1 ? shortcut.key.toUpperCase() : shortcut.key;
                    keyContent = formattedKey;
                  }

                  keyParts.push(<kbd key="key">{keyContent}</kbd>);

                  return (
                    <div key={`${shortcut.key}-${index}`} className="shortcut-item">
                      <span className="keycap">
                        {keyParts.map((part, i) => (
                          <React.Fragment key={i}>
                            {i > 0 && <span className="key-separator">+</span>}
                            {part}
                          </React.Fragment>
                        ))}
                      </span>
                      <span className="shortcut-description">{shortcut.description}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>

      <div className="shortcut-help-modal-footer">
        <p>
          Press <kbd>?</kbd> to toggle this help
        </p>
      </div>
    </ModalSurface>
  );
}
