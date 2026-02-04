/**
 * frontend/src/shared/components/ContextMenu.tsx
 *
 * UI component for ContextMenu.
 * Handles rendering and interactions for the shared components.
 */

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useShortcut, useKeyboardContext } from '@ui/shortcuts';
import { useZoom } from '@core/contexts/ZoomContext';
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
  const { zoomLevel } = useZoom();
  const [isPositioned, setIsPositioned] = useState(false);
  const contextPushedRef = useRef(false);
  const selectableIndexes = useMemo(
    () =>
      items
        .map((item, index) => (!item.divider && !item.disabled && !item.header ? index : null))
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

  // Adjust position for CSS zoom and prevent menu from going off-screen.
  // Uses useLayoutEffect to position before browser paint.
  // All constraint calculations happen in visual/viewport coordinates (what the user sees),
  // then convert to CSS coordinates at the end (dividing by zoom factor).
  useLayoutEffect(() => {
    if (menuRef.current) {
      const zoomFactor = zoomLevel / 100;

      // position.x/y are from clientX/clientY - already in visual coordinates
      // window.innerWidth/Height are the visual viewport size
      // For menu dimensions, use offsetWidth/Height which give CSS dimensions,
      // then multiply by zoom to get visual dimensions
      const menuVisualWidth = menuRef.current.offsetWidth * zoomFactor;
      const menuVisualHeight = menuRef.current.offsetHeight * zoomFactor;

      // Constrain in visual coordinates to keep menu fully on screen
      const padding = 10;
      const maxVisualX = window.innerWidth - menuVisualWidth - padding;
      const maxVisualY = window.innerHeight - menuVisualHeight - padding;

      const constrainedVisualX = Math.max(padding, Math.min(position.x, maxVisualX));
      const constrainedVisualY = Math.max(padding, Math.min(position.y, maxVisualY));

      // Convert to CSS coordinates (CSS values are scaled by zoom)
      const cssX = constrainedVisualX / zoomFactor;
      const cssY = constrainedVisualY / zoomFactor;

      menuRef.current.style.left = `${cssX}px`;
      menuRef.current.style.top = `${cssY}px`;

      // Show the menu now that it's positioned
      setIsPositioned(true);

      // Focus the menu to ensure keyboard events work
      menuRef.current.focus();
    }
  }, [position, zoomLevel]);

  const portalTarget = typeof document !== 'undefined' ? document.body : null;

  if (!portalTarget) {
    return null;
  }

  // Initial position is just for layout calculation; actual position is set by useEffect
  const zoomFactor = zoomLevel / 100;
  const initialX = position.x / zoomFactor;
  const initialY = position.y / zoomFactor;

  return createPortal(
    <div
      ref={menuRef}
      className="context-menu"
      style={{
        left: initialX,
        top: initialY,
        // Hide until useEffect has constrained the position
        visibility: isPositioned ? 'visible' : 'hidden',
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
          e.stopPropagation();
          moveFocus(1);
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          e.stopPropagation();
          moveFocus(-1);
          return;
        }
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
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
