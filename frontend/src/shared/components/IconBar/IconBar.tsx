/**
 * frontend/src/shared/components/IconBar/IconBar.tsx
 *
 * Reusable toolbar of flat icon buttons with optional group separators.
 * Supports these button types:
 * - Toggle: has an on/off state, shows active styling when on
 * - Split: a toggle or cycle button with a caret beside it that opens a menu of related choices
 * - Disclosure: shows or hides a related section, such as a row of extra controls
 * - Action: fires once on click, optionally shows brief feedback (success/error)
 * - Menu: opens a menu of actions, optionally shows brief feedback (success/error)
 */

import ContextMenu, { type ContextMenuItem } from '@shared/components/ContextMenu';
import { DropdownArrowIcon } from '@shared/components/icons/DropdownIcons';
import { IconBarSeparatorIcon } from '@shared/components/icons/SharedIcons';
import { withStableListKeys } from '@shared/utils/stableListKeys';
import type React from 'react';
import { type RefObject, useRef, useState } from 'react';

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
  /** Short text beside the icon, such as the current choice. */
  label?: string;
}

/** A button that shows or hides the section it controls. */
export interface IconBarDisclosure extends IconBarButton {
  type: 'disclosure';
  expanded: boolean;
  /** Id of the section the button shows. */
  controls: string;
  /** Highlights the button, for example while a hidden section's settings still apply. */
  active: boolean;
}

/** An action button that fires once and optionally shows feedback. */
export interface IconBarAction extends IconBarButton {
  type: 'action';
  /** Brief feedback state: 'success' or 'error'. Omit or null for default. */
  feedback?: 'success' | 'error' | null;
}

/** A button that opens a menu of actions. */
export interface IconBarMenu extends Omit<IconBarButton, 'onClick'> {
  type: 'menu';
  menuItems: ContextMenuItem[];
  /** Brief feedback after a menu action: 'success' or 'error'. Omit or null for default. */
  feedback?: 'success' | 'error' | null;
}

/** A visual separator between groups of buttons. */
export interface IconBarSeparator {
  type: 'separator';
}

export type IconBarItem =
  | IconBarToggle
  | IconBarSplit
  | IconBarDisclosure
  | IconBarAction
  | IconBarMenu
  | IconBarSeparator;

interface IconBarProps {
  items: IconBarItem[];
  /** Additional CSS class applied to the outermost wrapper. */
  className?: string;
}

/** Opens a menu below the anchor element, and closes it. */
const useAnchoredMenu = (anchorRef: RefObject<HTMLElement | null>) => {
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  return {
    position,
    toggle: () => {
      const rect = anchorRef.current?.getBoundingClientRect();
      setPosition(position || !rect ? null : { x: rect.left, y: rect.bottom + 4 });
    },
    close: () => setPosition(null),
    // The open menu closes on any mousedown outside it; keep the button's from
    // reaching it so the click that follows closes the menu instead of reopening it.
    onButtonMouseDown: (event: React.MouseEvent) => {
      if (position) {
        event.stopPropagation();
      }
    },
  };
};

const SplitButton = ({ item }: { item: IconBarSplit }) => {
  const groupRef = useRef<HTMLDivElement>(null);
  const menu = useAnchoredMenu(groupRef);

  return (
    <div className="icon-bar-split" ref={groupRef}>
      <button
        type="button"
        className={`icon-bar-button${item.label ? ' icon-bar-button--labeled' : ''}${item.active ? ' active' : ''}`}
        onClick={item.onClick}
        disabled={item.disabled}
        title={item.title}
        aria-label={item.ariaLabel ?? item.title}
        aria-pressed={item.behavior === 'toggle' ? item.active : undefined}
      >
        {item.icon}
        {item.label ? <span className="icon-bar-button-label">{item.label}</span> : null}
      </button>
      <button
        type="button"
        className="icon-bar-button icon-bar-split-caret"
        onMouseDown={menu.onButtonMouseDown}
        onClick={menu.toggle}
        disabled={item.disabled}
        title={item.menuLabel}
        aria-label={item.menuLabel}
        aria-haspopup="menu"
        aria-expanded={menu.position !== null}
      >
        <DropdownArrowIcon width={12} height={12} />
      </button>
      {menu.position ? (
        <ContextMenu
          items={item.menuItems}
          position={menu.position}
          onClose={menu.close}
          className="icon-bar-menu"
        />
      ) : null}
    </div>
  );
};

const feedbackClassName = (feedback: 'success' | 'error' | null | undefined): string =>
  feedback ? `icon-bar-button feedback-${feedback}` : 'icon-bar-button';

const MenuButton = ({ item }: { item: IconBarMenu }) => {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menu = useAnchoredMenu(buttonRef);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={feedbackClassName(item.feedback)}
        onMouseDown={menu.onButtonMouseDown}
        onClick={menu.toggle}
        disabled={item.disabled}
        title={item.title}
        aria-label={item.ariaLabel ?? item.title}
        aria-haspopup="menu"
        aria-expanded={menu.position !== null}
      >
        {item.icon}
      </button>
      {menu.position ? (
        <ContextMenu
          items={item.menuItems}
          position={menu.position}
          onClose={menu.close}
          className="icon-bar-menu"
        />
      ) : null}
    </>
  );
};

const buttonClassName = (item: IconBarToggle | IconBarDisclosure | IconBarAction): string => {
  if (item.type !== 'action') {
    return item.active ? 'icon-bar-button active' : 'icon-bar-button';
  }
  return feedbackClassName(item.feedback);
};

const PlainButton = ({ item }: { item: IconBarToggle | IconBarDisclosure | IconBarAction }) => (
  <button
    type="button"
    className={buttonClassName(item)}
    onClick={item.onClick}
    disabled={item.disabled}
    title={item.title}
    aria-label={item.ariaLabel ?? item.title}
    aria-pressed={item.type === 'toggle' ? item.active : undefined}
    aria-expanded={item.type === 'disclosure' ? item.expanded : undefined}
    aria-controls={item.type === 'disclosure' ? item.controls : undefined}
  >
    {item.icon}
  </button>
);

const IconBar: React.FC<IconBarProps> = ({ items, className }) => {
  const wrapperClass = ['icon-bar', className].filter(Boolean).join(' ');

  return (
    <div className={wrapperClass}>
      {withStableListKeys(items, (item) =>
        item.type === 'separator' ? 'separator' : `button:${item.id}`
      ).map(({ key, value: item }) => {
        switch (item.type) {
          case 'separator':
            return <IconBarSeparatorIcon key={key} />;
          case 'split':
            return <SplitButton key={key} item={item} />;
          case 'menu':
            return <MenuButton key={key} item={item} />;
          default:
            return <PlainButton key={key} item={item} />;
        }
      })}
    </div>
  );
};

export default IconBar;
