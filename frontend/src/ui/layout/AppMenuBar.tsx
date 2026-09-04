import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { backend } from '@/core/backend-api/models';
import { useKeyboardSurface } from '@/ui/shortcuts';
import { formatShortcut } from '@/ui/shortcuts/utils';
import { isWindowsPlatform } from '@/utils/platform';
import { useApplicationMenuCommandExecutor } from './ApplicationMenuCommandContext';
import {
  type ApplicationMenuSection,
  buildApplicationMenuSections,
  isApplicationMenuCommandItem,
} from './applicationMenuCommands';
import './AppMenuBar.css';

const firstCommandIndex = (section: ApplicationMenuSection) =>
  section.items.findIndex((entry) => isApplicationMenuCommandItem(entry));

const nextCommandIndex = (section: ApplicationMenuSection, current: number, direction: 1 | -1) => {
  const commandIndexes = section.items
    .map((entry, index) => (isApplicationMenuCommandItem(entry) ? index : -1))
    .filter((index) => index >= 0);
  const currentPosition = commandIndexes.indexOf(current);
  const initialPosition = direction === 1 ? -1 : 0;
  const start = currentPosition >= 0 ? currentPosition : initialPosition;
  return commandIndexes[(start + direction + commandIndexes.length) % commandIndexes.length] ?? -1;
};

const AppMenuBar = () => {
  const sections = useMemo(() => buildApplicationMenuSections(isWindowsPlatform()), []);
  const [openSectionIndex, setOpenSectionIndex] = useState<number | null>(null);
  const [focusedItemIndex, setFocusedItemIndex] = useState(-1);
  const barRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const priorFocusRef = useRef<HTMLElement | null>(null);
  const activeSection = openSectionIndex === null ? null : sections[openSectionIndex];
  const dispatchCommand = useApplicationMenuCommandExecutor();

  const rememberPriorFocus = useCallback(() => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && !barRef.current?.contains(active)) {
      priorFocusRef.current = active;
    }
  }, []);

  const openSection = useCallback(
    (index: number, focusFirstCommand = false) => {
      const section = sections[index];
      if (!section) {
        return;
      }
      setOpenSectionIndex(index);
      setFocusedItemIndex(focusFirstCommand ? firstCommandIndex(section) : -1);
    },
    [sections]
  );

  const closeSection = useCallback((restoreTrigger = false) => {
    setOpenSectionIndex((current) => {
      if (restoreTrigger && current !== null) {
        triggerRefs.current[current]?.focus();
      }
      return null;
    });
  }, []);

  const executeCommand = useCallback(
    (menuCommand: backend.ApplicationMenuCommand) => {
      setOpenSectionIndex(null);
      priorFocusRef.current?.focus();
      dispatchCommand(menuCommand);
    },
    [dispatchCommand]
  );

  const activateFocusedItem = useCallback(() => {
    const entry = activeSection?.items[focusedItemIndex];
    if (entry && isApplicationMenuCommandItem(entry)) {
      executeCommand(entry.command);
    }
  }, [activeSection, executeCommand, focusedItemIndex]);

  const switchSection = useCallback(
    (direction: 1 | -1) => {
      if (openSectionIndex === null) {
        return;
      }
      openSection((openSectionIndex + direction + sections.length) % sections.length, true);
    },
    [openSection, openSectionIndex, sections.length]
  );

  useKeyboardSurface({
    kind: 'menu',
    rootRef: barRef,
    active: openSectionIndex !== null,
    priority: 950,
    suppressShortcuts: true,
    onApplicationMenuShortcut: () => {
      setOpenSectionIndex(null);
      priorFocusRef.current?.focus();
    },
    onEscape: () => {
      closeSection(true);
      return true;
    },
    onKeyDown: (event) => {
      if (!activeSection) {
        return false;
      }
      if (event.key === 'ArrowDown') {
        setFocusedItemIndex((current) => nextCommandIndex(activeSection, current, 1));
        return true;
      }
      if (event.key === 'ArrowUp') {
        setFocusedItemIndex((current) => nextCommandIndex(activeSection, current, -1));
        return true;
      }
      if (event.key === 'ArrowRight') {
        switchSection(1);
        return true;
      }
      if (event.key === 'ArrowLeft') {
        switchSection(-1);
        return true;
      }
      if (event.key === 'Enter' || event.key === ' ') {
        activateFocusedItem();
        return true;
      }
      return false;
    },
  });

  useEffect(() => {
    if (openSectionIndex !== null) {
      menuRef.current?.focus();
    }
  }, [openSectionIndex]);

  useEffect(() => {
    if (openSectionIndex === null) {
      return;
    }
    const handlePointerDown = (event: MouseEvent) => {
      if (!barRef.current?.contains(event.target as Node)) {
        closeSection();
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [closeSection, openSectionIndex]);

  return (
    <div className="app-menu-bar" role="menubar" aria-label="Application menu" ref={barRef}>
      {sections.map((section, sectionIndex) => {
        const isOpen = sectionIndex === openSectionIndex;
        const menuID = `app-menu-${section.id}`;
        return (
          <div className="app-menu-section" role="none" key={section.id}>
            <button
              type="button"
              className={`app-menu-trigger${isOpen ? ' app-menu-trigger--open' : ''}`}
              role="menuitem"
              aria-label={`${section.label} menu`}
              aria-haspopup="menu"
              aria-expanded={isOpen}
              aria-controls={isOpen ? menuID : undefined}
              ref={(element) => {
                triggerRefs.current[sectionIndex] = element;
              }}
              onMouseDown={rememberPriorFocus}
              onFocus={(event) => {
                const previous = event.relatedTarget;
                if (previous instanceof HTMLElement && !barRef.current?.contains(previous)) {
                  priorFocusRef.current = previous;
                }
              }}
              onClick={() => {
                if (isOpen) {
                  closeSection();
                } else {
                  openSection(sectionIndex);
                }
              }}
              onMouseEnter={() => {
                if (openSectionIndex !== null && !isOpen) {
                  openSection(sectionIndex);
                }
              }}
              onKeyDown={(event) => {
                if (!['ArrowDown', 'Enter', ' '].includes(event.key)) {
                  return;
                }
                event.preventDefault();
                event.stopPropagation();
                rememberPriorFocus();
                openSection(sectionIndex, true);
              }}
            >
              {section.label}
            </button>
            {isOpen ? (
              <div
                className="app-menu-dropdown"
                id={menuID}
                role="menu"
                tabIndex={-1}
                ref={menuRef}
                aria-activedescendant={
                  focusedItemIndex >= 0 ? `${menuID}-item-${focusedItemIndex}` : undefined
                }
              >
                {section.items.map((entry, itemIndex) => {
                  if (!isApplicationMenuCommandItem(entry)) {
                    return <hr className="app-menu-separator" key={`separator-${entry.id}`} />;
                  }
                  return (
                    <button
                      type="button"
                      className={`app-menu-item${focusedItemIndex === itemIndex ? ' app-menu-item--focused' : ''}`}
                      id={`${menuID}-item-${itemIndex}`}
                      role="menuitem"
                      tabIndex={-1}
                      data-menu-command={entry.command}
                      key={entry.command}
                      onMouseEnter={() => setFocusedItemIndex(-1)}
                      onClick={() => executeCommand(entry.command)}
                    >
                      <span className="app-menu-item-label">{entry.label}</span>
                      {entry.accelerator ? (
                        <span className="app-menu-item-shortcut" aria-hidden="true">
                          {formatShortcut(entry.accelerator.key, entry.accelerator.modifiers)}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
};

export default AppMenuBar;
