/**
 * frontend/src/shared/components/IconBar/IconBar.tsx
 *
 * Reusable toolbar of flat icon buttons with optional group separators.
 * Supports two button types:
 * - Toggle: has an on/off state, shows active styling when on
 * - Action: fires once on click, optionally shows brief feedback (success/error)
 */

import { IconBarSeparatorIcon } from '@shared/components/icons/SharedIcons';
import { withStableListKeys } from '@shared/utils/stableListKeys';
import type React from 'react';

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

export type IconBarItem = IconBarToggle | IconBarAction | IconBarSeparator;

interface IconBarProps {
  items: IconBarItem[];
  /** Additional CSS class applied to the outermost wrapper. */
  className?: string;
}

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

        let buttonClass = 'icon-bar-button';
        if (item.type === 'toggle' && item.active) {
          buttonClass += ' active';
        }
        if (item.type === 'action' && item.feedback) {
          buttonClass += ` feedback-${item.feedback}`;
        }

        return (
          <button
            key={key}
            type="button"
            className={buttonClass}
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
