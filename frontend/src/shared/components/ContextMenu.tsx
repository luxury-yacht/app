/**
 * frontend/src/shared/components/ContextMenu.tsx
 *
 * UI component for ContextMenu.
 * Handles rendering and interactions for the shared components.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useShortcut, useKeyboardContext } from '@ui/shortcuts';
import './ContextMenu.css';

export interface ContextMenuItem {
  label?: string;
  onClick?: () => void;
  icon?: string | React.ReactNode;
  divider?: boolean;
  header?: boolean;
  disabled?: boolean;
  danger?: boolean;
  tooltip?: string;
  disabledReason?: string;
}

interface ContextMenuProps {
  items: ContextMenuItem[];
  position: { x: number; y: number };
  onClose: () => void;
}

const ContextMenu: React.FC<ContextMenuProps> = ({ items, position, onClose }) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const { pushContext, popContext } = useKeyboardContext();
  const contextPushedRef = useRef(false);
  const selectableIndexes = useMemo(
    () =>
      items
        .map((item, index) =>
          !item.divider && !item.disabled && !item.header ? index : null
        )
        .filter((idx): idx is number => idx !== null),
    [items]
  );
  const firstSelectableIndex = selectableIndexes.length > 0 ? selectableIndexes[0] : -1;
  const [focusedIndex, setFocusedIndex] = useState(firstSelectableIndex);

  useEffect(() => {
    setFocusedIndex(firstSelectableIndex);
  }, [firstSelectableIndex]);

  const moveFocus = (direction: 1 | -1) => {
    if (selectableIndexes.length === 0) {
      return;
    }
    const currentPosition = selectableIndexes.findIndex((idx) => idx === focusedIndex);
    const fallbackPosition = currentPosition === -1 ? 0 : currentPosition;
    const nextPosition =
      (fallbackPosition + direction + selectableIndexes.length) % selectableIndexes.length;
    setFocusedIndex(selectableIndexes[nextPosition]);
  };

  const activateFocusedItem = () => {
    if (focusedIndex == null || focusedIndex < 0) {
      return;
    }
    const item = items[focusedIndex];
    if (!item || item.disabled || item.divider) {
      return;
    }
    item.onClick?.();
    onClose();
  };

  useEffect(() => {
    pushContext({ priority: 925 });
    contextPushedRef.current = true;
    return () => {
      if (contextPushedRef.current) {
        popContext();
        contextPushedRef.current = false;
      }
    };
  }, [popContext, pushContext]);

  useShortcut({
    key: 'Escape',
    handler: () => {
      onClose();
      return true;
    },
    description: 'Close context menu',
    category: 'Modals',
    enabled: true,
    view: 'global',
    priority: 925,
  });

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [onClose]);

  // Adjust position to prevent menu from going off-screen and focus the menu
  useEffect(() => {
    if (menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect();
      const adjustedX = Math.min(position.x, window.innerWidth - rect.width - 10);
      const adjustedY = Math.min(position.y, window.innerHeight - rect.height - 10);

      menuRef.current.style.left = `${Math.max(10, adjustedX)}px`;
      menuRef.current.style.top = `${Math.max(10, adjustedY)}px`;

      // Focus the menu to ensure keyboard events work
      menuRef.current.focus();
    }
  }, [position]);

  const portalTarget = typeof document !== 'undefined' ? document.body : null;

  if (!portalTarget) {
    return null;
  }

  return createPortal(
    <div
      ref={menuRef}
      className="context-menu"
      style={{
        left: position.x,
        top: position.y,
      }}
      role="menu"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          onClose();
          return;
        }
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          moveFocus(1);
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          moveFocus(-1);
          return;
        }
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          activateFocusedItem();
        }
      }}
      tabIndex={-1}
    >
      {items.map((item, index) => {
        if (item.divider) {
          return <div key={index} className="context-menu-divider" />;
        }
        // Render non-interactive headers (e.g., permission pending state).
        if (item.header) {
          return (
            <div key={index} className="context-menu-header" role="presentation">
              {item.label}
            </div>
          );
        }

        const tooltip = item.tooltip ?? item.disabledReason;
        const isFocused = index === focusedIndex;

        return (
          <div
            key={index}
            className={`context-menu-item ${item.disabled ? 'disabled' : ''} ${
              item.danger ? 'danger' : ''
            } ${isFocused ? 'is-focused' : ''}`}
            role="menuitem"
            aria-disabled={item.disabled ? 'true' : 'false'}
            data-context-index={index}
            onClick={() => {
              if (!item.disabled && item.onClick) {
                item.onClick();
                onClose();
              }
            }}
            onMouseEnter={() => {
              if (!item.disabled) {
                setFocusedIndex(index);
              }
            }}
            title={tooltip}
          >
            {item.icon && <span className="context-menu-icon">{item.icon}</span>}
            <span className="context-menu-label">{item.label}</span>
            {item.disabled && item.disabledReason && (
              <span className="context-menu-reason">{item.disabledReason}</span>
            )}
          </div>
        );
      })}
    </div>,
    portalTarget
  );
};

export default ContextMenu;
