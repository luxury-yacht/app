/**
 * frontend/src/shared/components/modals/ModalSidebarNav.tsx
 *
 * Category sidebar for two-pane modals (Settings, Keyboard Shortcuts).
 * The list is a single Tab stop. Arrow keys, Home, and End move focus between
 * categories through handleModalSidebarKeyDown, which the owning modal passes
 * to its surface; Enter and Space select through the native button.
 */

import type React from 'react';
import { useEffect, useState } from 'react';

export interface ModalSidebarNavItem<Id extends string> {
  id: Id;
  label: string;
  icon?: React.ReactNode;
  count?: number;
}

interface ModalSidebarNavProps<Id extends string> {
  label: string;
  items: ReadonlyArray<ModalSidebarNavItem<Id>>;
  activeId: Id;
  onSelect: (id: Id) => void;
  footer?: React.ReactNode;
}

export const handleModalSidebarKeyDown = (event: KeyboardEvent): boolean => {
  const target = event.target;
  if (
    !(target instanceof HTMLButtonElement) ||
    !target.matches('.modal-sidebar-item') ||
    event.ctrlKey ||
    event.altKey ||
    event.metaKey
  ) {
    return false;
  }
  const buttons = Array.from(
    target.closest('.modal-sidebar-list')?.querySelectorAll<HTMLButtonElement>('button') ?? []
  );
  const index = buttons.indexOf(target);
  const destinations: Partial<Record<string, number>> = {
    ArrowDown: (index + 1) % buttons.length,
    ArrowUp: (index - 1 + buttons.length) % buttons.length,
    Home: 0,
    End: buttons.length - 1,
  };
  const nextIndex = destinations[event.key];
  if (nextIndex === undefined) {
    return false;
  }
  buttons[nextIndex]?.focus();
  return true;
};

export function ModalSidebarNav<Id extends string>({
  label,
  items,
  activeId,
  onSelect,
  footer,
}: Readonly<ModalSidebarNavProps<Id>>) {
  const [focusedId, setFocusedId] = useState(activeId);

  // A new selection (including one restored on open) becomes the Tab stop.
  useEffect(() => {
    setFocusedId(activeId);
  }, [activeId]);

  const tabStopId = items.some((item) => item.id === focusedId) ? focusedId : activeId;

  return (
    <nav className="modal-sidebar" aria-label={label}>
      <ul className="modal-sidebar-list">
        {items.map((item) => {
          const isActive = item.id === activeId;
          return (
            <li key={item.id}>
              <button
                type="button"
                className={`modal-sidebar-item${isActive ? ' modal-sidebar-item--active' : ''}`}
                tabIndex={item.id === tabStopId ? 0 : -1}
                onFocus={() => setFocusedId(item.id)}
                onClick={() => onSelect(item.id)}
                aria-current={isActive ? 'page' : undefined}
              >
                {item.icon}
                <span>{item.label}</span>
                {item.count !== undefined && (
                  <span className="modal-sidebar-count">{item.count}</span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      {footer}
    </nav>
  );
}
