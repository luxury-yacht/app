/**
 * frontend/src/shared/components/IconBar/IconBar.tsx
 *
 * Reusable toolbar of flat icon buttons with optional group separators.
 * Supports two button types:
 * - Toggle: has an on/off state, shows active styling when on
 * - Action: fires once on click, optionally shows brief feedback (success/error)
 */

import React from 'react';
import { IconBarSeparatorIcon } from '@shared/components/icons/SharedIcons';

/** A toggle button that switches between on and off states. */
export interface IconBarToggle {
  type: 'toggle';
  /** Unique key for React rendering. */
  id: string;
  /** The icon element to render. */
  icon: React.ReactNode;
  /** Whether the toggle is currently on. */
  active: boolean;
  /** Called when the button is clicked. */
  onClick: () => void;
  /** Tooltip text shown on hover. */
  title: string;
  /** Accessible label for screen readers; defaults to title when omitted. */
  ariaLabel?: string;
  /** When true, the button is dimmed and non-interactive. */
  disabled?: boolean;
}

/** An action button that fires once and optionally shows feedback. */
export interface IconBarAction {
  type: 'action';
  /** Unique key for React rendering. */
  id: string;
  /** The icon element to render. */
  icon: React.ReactNode;
  /** Called when the button is clicked. */
  onClick: () => void;
  /** Tooltip text shown on hover. */
  title: string;
  /** Accessible label for screen readers; defaults to title when omitted. */
  ariaLabel?: string;
  /** When true, the button is dimmed and non-interactive. */
  disabled?: boolean;
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
      {items.map((item, index) => {
        if (item.type === 'separator') {
          return <IconBarSeparatorIcon key={`sep-${index}`} />;
        }

        if (item.type === 'toggle') {
          return (
            <button
              key={item.id}
              type="button"
              className={`icon-bar-button${item.active ? ' active' : ''}`}
              onClick={item.onClick}
              disabled={item.disabled}
              title={item.title}
              aria-label={item.ariaLabel ?? item.title}
              aria-pressed={item.active}
            >
              {item.icon}
            </button>
          );
        }

        // Action button
        const feedbackClass = item.feedback ? ` feedback-${item.feedback}` : '';

        return (
          <button
            key={item.id}
            type="button"
            className={`icon-bar-button${feedbackClass}`}
            onClick={item.onClick}
            disabled={item.disabled}
            title={item.title}
            aria-label={item.ariaLabel ?? item.title}
          >
            {item.icon}
          </button>
        );
      })}
    </div>
  );
};

export default IconBar;
