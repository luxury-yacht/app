/**
 * frontend/src/shared/components/IconBar/IconBar.tsx
 *
 * Reusable toolbar of flat icon buttons with optional group separators.
 * Supports three button types:
 * - Toggle: has an on/off state, shows active styling when on
 * - Split: a toggle or cycle button with a caret beside it that opens a menu of related choices
 * - Action: fires once on click, optionally shows brief feedback (success/error)
 */

import ContextMenu, { type ContextMenuItem } from '@shared/components/ContextMenu';
import { DropdownArrowIcon } from '@shared/components/icons/DropdownIcons';
import { IconBarSeparatorIcon } from '@shared/components/icons/SharedIcons';
import { withStableListKeys } from '@shared/utils/stableListKeys';
import type React from 'react';
import { useRef, useState } from 'react';

interface IconBarButton {
  /** Unique key for React rendering. */
  id: string;
  icon: React.ReactNode;
  onClick: () => void;
  title: string;
  /** Accessible label for screen readers; defaults to title when omitted. */
  ariaLabel?: string;
  disabled?: boolean;
}

/** A toggle button that switches between on and off states. */
export interface IconBarToggle extends IconBarButton {
  type: 'toggle';
  active: boolean;
}

/** A button with a caret beside it that opens a menu of related choices. */
export interface IconBarSplit extends IconBarButton {
  type: 'split';
  /**
   * A toggle reports `active` as its pressed state. A cycle button steps
   * through the menu's choices, so it has no pressed state.
   */
  behavior: 'toggle' | 'cycle';
  /** Highlights the button. */
  active: boolean;
  /** Accessible label and tooltip of the caret that opens the menu. */
  menuLabel: string;
  menuItems: ContextMenuItem[];
}

/** An action button that fires once and optionally shows feedback. */
export interface IconBarAction extends IconBarButton {
  type: 'action';
  /** Brief feedback state: 'success' or 'error'. Omit or null for default. */
  feedback?: 'success' | 'error' | null;
}

/** A visual separator between groups of buttons. */
export interface IconBarSeparator {
  type: 'separator';
}

export type IconBarItem = IconBarToggle | IconBarSplit | IconBarAction | IconBarSeparator;

interface IconBarProps {
  items: IconBarItem[];
  /** Additional CSS class applied to the outermost wrapper. */
  className?: string;
}

const SplitButton = ({ item }: { item: IconBarSplit }) => {
  const groupRef = useRef<HTMLDivElement>(null);
  const [menuPosition, setMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const toggleMenu = () => {
    const rect = groupRef.current?.getBoundingClientRect();
    setMenuPosition(menuPosition || !rect ? null : { x: rect.left, y: rect.bottom + 4 });
  };

  return (
    <div className="icon-bar-split" ref={groupRef}>
      <button
        type="button"
        className={`icon-bar-button${item.active ? ' active' : ''}`}
        onClick={item.onClick}
        disabled={item.disabled}
        title={item.title}
        aria-label={item.ariaLabel ?? item.title}
        aria-pressed={item.behavior === 'toggle' ? item.active : undefined}
      >
        {item.icon}
      </button>
      <button
        type="button"
        className="icon-bar-button icon-bar-split-caret"
        // The open menu closes on any mousedown outside it; keep this one from
        // reaching it so the click below closes the menu instead of reopening it.
        onMouseDown={(event) => {
          if (menuPosition) {
            event.stopPropagation();
          }
        }}
        onClick={toggleMenu}
        disabled={item.disabled}
        title={item.menuLabel}
        aria-label={item.menuLabel}
        aria-haspopup="menu"
        aria-expanded={menuPosition !== null}
      >
        <DropdownArrowIcon width={12} height={12} />
      </button>
      {menuPosition ? (
        <ContextMenu
          items={item.menuItems}
          position={menuPosition}
          onClose={() => setMenuPosition(null)}
        />
      ) : null}
    </div>
  );
};

const buttonClassName = (item: IconBarToggle | IconBarAction): string => {
  if (item.type === 'toggle') {
    return item.active ? 'icon-bar-button active' : 'icon-bar-button';
  }
  return item.feedback ? `icon-bar-button feedback-${item.feedback}` : 'icon-bar-button';
};

const IconBar: React.FC<IconBarProps> = ({ items, className }) => {
  const wrapperClass = ['icon-bar', className].filter(Boolean).join(' ');

  return (
    <div className={wrapperClass}>
      {withStableListKeys(items, (item) =>
        item.type === 'separator' ? 'separator' : `button:${item.id}`
      ).map(({ key, value: item }) => {
        if (item.type === 'separator') {
          return <IconBarSeparatorIcon key={key} />;
        }
        if (item.type === 'split') {
          return <SplitButton key={key} item={item} />;
        }

        return (
          <button
            key={key}
            type="button"
            className={buttonClassName(item)}
            onClick={item.onClick}
            disabled={item.disabled}
            title={item.title}
            aria-label={item.ariaLabel ?? item.title}
            aria-pressed={item.type === 'toggle' ? item.active : undefined}
          >
            {item.icon}
          </button>
        );
      })}
    </div>
  );
};

export default IconBar;
