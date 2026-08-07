/**
 * frontend/src/ui/shortcuts/components/ShortcutHelpModal.tsx
 *
 * UI component for ShortcutHelpModal.
 * Handles rendering and interactions for the shared components.
 */

import { CategoryIcon, ShortcutArrowIcon } from '@shared/components/icons/SharedIcons';
import ModalHeader from '@shared/components/modals/ModalHeader';
import ModalSurface from '@shared/components/modals/ModalSurface';
import { useModalFocusTrap } from '@shared/components/modals/useModalFocusTrap';
import React, { useEffect, useRef, useState } from 'react';
import type { ShortcutGroup, ShortcutModifiers } from '@/types/shortcuts';
import { useKeyboardContext } from '../context';
import './ShortcutHelpModal.css';

interface ShortcutHelpModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type ShortcutItem = ShortcutGroup['shortcuts'][number];
type ModifierName = keyof ShortcutModifiers;

const MODIFIER_KEYCAPS: Array<{
  modifier: ModifierName;
  macLabel: string;
  defaultLabel: string;
}> = [
  { modifier: 'meta', macLabel: '⌘', defaultLabel: 'Win' },
  { modifier: 'ctrl', macLabel: '⌃', defaultLabel: 'Ctrl' },
  { modifier: 'alt', macLabel: '⌥', defaultLabel: 'Alt' },
  { modifier: 'shift', macLabel: '⇧', defaultLabel: 'Shift' },
];

const ARROW_DIRECTIONS: Partial<
  Record<string, React.ComponentProps<typeof ShortcutArrowIcon>['direction']>
> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
};

const buildModifierKeycaps = (shortcut: ShortcutItem, isMac: boolean) =>
  MODIFIER_KEYCAPS.filter(({ modifier }) => shortcut.modifiers?.[modifier]).map(
    ({ modifier, macLabel, defaultLabel }) => {
      const label = isMac ? macLabel : defaultLabel;
      return <kbd key={modifier}>{label}</kbd>;
    }
  );

const ShortcutKeyContent = ({ shortcutKey }: { shortcutKey: string }) => {
  const arrowDirection = ARROW_DIRECTIONS[shortcutKey];
  if (arrowDirection) {
    return <ShortcutArrowIcon direction={arrowDirection} />;
  }
  return shortcutKey.length === 1 ? shortcutKey.toUpperCase() : shortcutKey;
};

const ShortcutKeycap = ({ shortcut, isMac }: { shortcut: ShortcutItem; isMac: boolean }) => {
  const keyParts = [
    ...buildModifierKeycaps(shortcut, isMac),
    <kbd key="key">
      <ShortcutKeyContent shortcutKey={shortcut.key} />
    </kbd>,
  ];
  return (
    <span className="keycap">
      {keyParts.map((part, index) => (
        <React.Fragment key={String(part.key)}>
          {index > 0 && <span className="key-separator">+</span>}
          {part}
        </React.Fragment>
      ))}
    </span>
  );
};

const ShortcutRow = ({ shortcut, isMac }: { shortcut: ShortcutItem; isMac: boolean }) => (
  <div className="shortcut-item">
    <ShortcutKeycap shortcut={shortcut} isMac={isMac} />
    <span className="shortcut-description">{shortcut.description}</span>
  </div>
);

const ShortcutGroupSection = ({ group, isMac }: { group: ShortcutGroup; isMac: boolean }) => (
  <div className="shortcut-group">
    <h3>{group.category}</h3>
    <div className="shortcut-list">
      {group.shortcuts.map((shortcut) => (
        <ShortcutRow
          key={`${shortcut.key}:${shortcut.description}`}
          shortcut={shortcut}
          isMac={isMac}
        />
      ))}
    </div>
  </div>
);

export function ShortcutHelpModal({ isOpen, onClose }: ShortcutHelpModalProps) {
  const { getAvailableShortcuts } = useKeyboardContext();
  const [shortcuts, setShortcuts] = useState(getAvailableShortcuts());
  const [isClosing, setIsClosing] = useState(false);
  const [shouldRender, setShouldRender] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);
  const isMac = navigator.userAgent.includes('Mac');

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

  if (!shouldRender) {
    return null;
  }

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
            <ShortcutGroupSection key={group.category} group={group} isMac={isMac} />
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
