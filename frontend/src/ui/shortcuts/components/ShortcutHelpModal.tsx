/**
 * frontend/src/ui/shortcuts/components/ShortcutHelpModal.tsx
 *
 * UI component for ShortcutHelpModal.
 * Handles rendering and interactions for the shared components.
 */

import React, { useState, useEffect } from 'react';
import { useKeyboardContext } from '../context';
import { CloseIcon } from '@shared/components/icons/MenuIcons';
import './ShortcutHelpModal.css';

interface ShortcutHelpModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ShortcutHelpModal({ isOpen, onClose }: ShortcutHelpModalProps) {
  const { getAvailableShortcuts, currentContext, setEnabled } = useKeyboardContext();
  const [shortcuts, setShortcuts] = useState(getAvailableShortcuts());
  const [isClosing, setIsClosing] = useState(false);
  const [shouldRender, setShouldRender] = useState(false);

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
  }, [isOpen, currentContext, getAvailableShortcuts]);

  // Disable other shortcuts while help is open
  useEffect(() => {
    if (isOpen) {
      setEnabled(false);

      // Add a direct keyboard listener for Escape and / to close the modal
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape' || e.key === '/') {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
      };

      document.addEventListener('keydown', handleKeyDown, true); // Use capture phase

      return () => {
        setEnabled(true);
        document.removeEventListener('keydown', handleKeyDown, true);
      };
    }
  }, [isOpen, setEnabled, onClose]);

  if (!shouldRender) return null;

  return (
    <div
      className={`modal-overlay shortcut-help-modal-overlay ${isClosing ? 'closing' : ''}`}
      onClick={onClose}
    >
      <div
        className={`modal-container shortcut-help-modal ${isClosing ? 'closing' : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header shortcut-help-modal-header">
          <h2>Keyboard Shortcuts</h2>
          <button
            className="modal-close shortcut-help-modal-close"
            onClick={onClose}
            aria-label="Close"
          >
            <CloseIcon />
          </button>
        </div>

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

                    // Format the key - use SVG for arrow keys
                    let keyContent: React.ReactNode;
                    if (shortcut.key === 'ArrowLeft') {
                      keyContent = (
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
                          <path
                            d="M9.5 2.5L5 7l4.5 4.5"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            fill="none"
                          />
                        </svg>
                      );
                    } else if (shortcut.key === 'ArrowRight') {
                      keyContent = (
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
                          <path
                            d="M4.5 2.5L9 7l-4.5 4.5"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            fill="none"
                          />
                        </svg>
                      );
                    } else if (shortcut.key === 'ArrowUp') {
                      keyContent = (
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
                          <path
                            d="M2.5 9.5L7 5l4.5 4.5"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            fill="none"
                          />
                        </svg>
                      );
                    } else if (shortcut.key === 'ArrowDown') {
                      keyContent = (
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
                          <path
                            d="M2.5 4.5L7 9l4.5-4.5"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            fill="none"
                          />
                        </svg>
                      );
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
      </div>
    </div>
  );
}
