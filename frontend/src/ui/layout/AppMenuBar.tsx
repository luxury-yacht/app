import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ExecuteWorkspaceMenuCommand } from '@/core/backend-api';
import { backend } from '@/core/backend-api/models';
import { useKeyboardSurface, useShortcut } from '@/ui/shortcuts';
import { reportOperationalError } from '@/utils/errorHandler';
import { isWindowsPlatform } from '@/utils/platform';
import './AppMenuBar.css';

interface AppMenuCommandItem {
  command: backend.WorkspaceMenuCommand;
  label: string;
  shortcut?: string;
}

interface AppMenuSeparator {
  id: string;
  separator: true;
}

type AppMenuEntry = AppMenuCommandItem | AppMenuSeparator;

interface AppMenuSection {
  id: string;
  label: string;
  items: AppMenuEntry[];
}

const command = backend.WorkspaceMenuCommand;
const separator = (id: string): AppMenuSeparator => ({ id, separator: true });
const isCommandItem = (entry: AppMenuEntry): entry is AppMenuCommandItem => 'command' in entry;

const buildMenuSections = (windows: boolean): AppMenuSection[] => {
  const sections: AppMenuSection[] = [
    {
      id: 'file',
      label: 'File',
      items: [
        { label: 'New Window', shortcut: 'Ctrl+N', command: command.WorkspaceMenuCommandNewWindow },
        separator('new-window'),
        {
          label: 'Open Cluster',
          shortcut: 'Ctrl+O',
          command: command.WorkspaceMenuCommandOpenCluster,
        },
        { label: 'Close', shortcut: 'Ctrl+W', command: command.WorkspaceMenuCommandClose },
        separator('close'),
        { label: 'Settings…', shortcut: 'Ctrl+,', command: command.WorkspaceMenuCommandSettings },
        separator('settings'),
        {
          label: windows ? 'Exit' : 'Quit',
          shortcut: 'Ctrl+Q',
          command: command.WorkspaceMenuCommandQuit,
        },
      ],
    },
    {
      id: 'edit',
      label: 'Edit',
      items: [
        { label: 'Cut', shortcut: 'Ctrl+X', command: command.WorkspaceMenuCommandCut },
        { label: 'Copy', shortcut: 'Ctrl+C', command: command.WorkspaceMenuCommandCopy },
        { label: 'Paste', shortcut: 'Ctrl+V', command: command.WorkspaceMenuCommandPaste },
        { label: 'Select All', shortcut: 'Ctrl+A', command: command.WorkspaceMenuCommandSelectAll },
      ],
    },
    {
      id: 'view',
      label: 'View',
      items: [
        {
          label: 'Command Palette',
          shortcut: 'Ctrl+Shift+P',
          command: command.WorkspaceMenuCommandCommandPalette,
        },
        separator('palette'),
        { label: 'Zoom In', shortcut: 'Ctrl+=', command: command.WorkspaceMenuCommandZoomIn },
        { label: 'Zoom Out', shortcut: 'Ctrl+-', command: command.WorkspaceMenuCommandZoomOut },
        { label: 'Reset Zoom', shortcut: 'Ctrl+0', command: command.WorkspaceMenuCommandZoomReset },
        separator('zoom'),
        {
          label: 'Toggle Sidebar',
          shortcut: 'Ctrl+B',
          command: command.WorkspaceMenuCommandToggleSidebar,
        },
        {
          label: 'Diff Objects',
          shortcut: 'Ctrl+D',
          command: command.WorkspaceMenuCommandToggleObjectDiff,
        },
        {
          label: 'Application Logs',
          shortcut: 'Ctrl+Shift+L',
          command: command.WorkspaceMenuCommandToggleAppLogs,
        },
        {
          label: 'Diagnostics Panel',
          shortcut: 'Ctrl+Shift+D',
          command: command.WorkspaceMenuCommandToggleDiagnostics,
        },
      ],
    },
    {
      id: 'window',
      label: 'Window',
      items: [
        { label: 'Minimize', shortcut: 'Ctrl+M', command: command.WorkspaceMenuCommandMinimise },
        { label: 'Maximize', command: command.WorkspaceMenuCommandMaximise },
        { label: 'Restore', command: command.WorkspaceMenuCommandRestore },
      ],
    },
  ];

  if (import.meta.env.DEV) {
    sections.push({
      id: 'debug',
      label: 'Debug',
      items: [
        {
          label: 'Open Inspector',
          shortcut: 'Ctrl+Shift+F12',
          command: command.WorkspaceMenuCommandOpenInspector,
        },
        separator('inspector'),
        { label: 'Keyboard Focus Overlay', command: command.WorkspaceMenuCommandToggleFocusDebug },
        { label: 'Panel Debug Overlay', command: command.WorkspaceMenuCommandTogglePanelDebug },
        { label: 'Map Debug Overlay', command: command.WorkspaceMenuCommandToggleMapDebug },
        { label: 'Icon Debug Overlay', command: command.WorkspaceMenuCommandToggleIconDebug },
        { label: 'Error Boundary Tests', command: command.WorkspaceMenuCommandToggleErrorDebug },
      ],
    });
  }

  sections.push({
    id: 'help',
    label: 'Help',
    items: [
      { label: 'About Luxury Yacht', command: command.WorkspaceMenuCommandAbout },
      { label: 'Check for Updates…', command: command.WorkspaceMenuCommandCheckForUpdates },
    ],
  });
  return sections;
};

const firstCommandIndex = (section: AppMenuSection) =>
  section.items.findIndex((entry) => isCommandItem(entry));

const nextCommandIndex = (section: AppMenuSection, current: number, direction: 1 | -1) => {
  const commandIndexes = section.items
    .map((entry, index) => (isCommandItem(entry) ? index : -1))
    .filter((index) => index >= 0);
  const currentPosition = commandIndexes.indexOf(current);
  const start = currentPosition >= 0 ? currentPosition : 0;
  return commandIndexes[(start + direction + commandIndexes.length) % commandIndexes.length] ?? -1;
};

const useWorkspaceMenuAccelerator = (
  key: string,
  menuCommand: backend.WorkspaceMenuCommand,
  description: string,
  dispatchCommand: (command: backend.WorkspaceMenuCommand) => void
) => {
  useShortcut({
    key,
    modifiers: { ctrl: true },
    handler: () => {
      dispatchCommand(menuCommand);
      return undefined;
    },
    description,
    category: 'Application',
  });
};

const AppMenuBar = () => {
  const sections = useMemo(() => buildMenuSections(isWindowsPlatform()), []);
  const [openSectionIndex, setOpenSectionIndex] = useState<number | null>(null);
  const [focusedItemIndex, setFocusedItemIndex] = useState(-1);
  const barRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const priorFocusRef = useRef<HTMLElement | null>(null);
  const activeSection = openSectionIndex === null ? null : sections[openSectionIndex];

  const rememberPriorFocus = useCallback(() => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && !barRef.current?.contains(active)) {
      priorFocusRef.current = active;
    }
  }, []);

  const openSection = useCallback(
    (index: number) => {
      const section = sections[index];
      if (!section) {
        return;
      }
      setOpenSectionIndex(index);
      setFocusedItemIndex(firstCommandIndex(section));
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

  const dispatchCommand = useCallback((menuCommand: backend.WorkspaceMenuCommand) => {
    void ExecuteWorkspaceMenuCommand(menuCommand).catch((error) => {
      reportOperationalError(error, {
        source: 'AppMenuBar',
        action: `execute:${menuCommand}`,
      });
    });
  }, []);

  const executeCommand = useCallback(
    (menuCommand: backend.WorkspaceMenuCommand) => {
      setOpenSectionIndex(null);
      priorFocusRef.current?.focus();
      dispatchCommand(menuCommand);
    },
    [dispatchCommand]
  );

  useWorkspaceMenuAccelerator(
    'n',
    command.WorkspaceMenuCommandNewWindow,
    'Create a workspace window',
    dispatchCommand
  );
  useWorkspaceMenuAccelerator(
    'o',
    command.WorkspaceMenuCommandOpenCluster,
    'Open a cluster',
    dispatchCommand
  );
  useWorkspaceMenuAccelerator(
    'w',
    command.WorkspaceMenuCommandClose,
    'Close the active cluster tab or workspace',
    dispatchCommand
  );
  useWorkspaceMenuAccelerator(
    'q',
    command.WorkspaceMenuCommandQuit,
    'Quit the application',
    dispatchCommand
  );
  useWorkspaceMenuAccelerator(
    'm',
    command.WorkspaceMenuCommandMinimise,
    'Minimise the workspace window',
    dispatchCommand
  );

  const activateFocusedItem = useCallback(() => {
    const entry = activeSection?.items[focusedItemIndex];
    if (entry && isCommandItem(entry)) {
      executeCommand(entry.command);
    }
  }, [activeSection, executeCommand, focusedItemIndex]);

  const switchSection = useCallback(
    (direction: 1 | -1) => {
      if (openSectionIndex === null) {
        return;
      }
      openSection((openSectionIndex + direction + sections.length) % sections.length);
    },
    [openSection, openSectionIndex, sections.length]
  );

  useKeyboardSurface({
    kind: 'menu',
    rootRef: barRef,
    active: openSectionIndex !== null,
    priority: 950,
    suppressShortcuts: true,
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
                openSection(sectionIndex);
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
                  if (!isCommandItem(entry)) {
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
                      onMouseEnter={() => setFocusedItemIndex(itemIndex)}
                      onClick={() => executeCommand(entry.command)}
                    >
                      <span className="app-menu-item-label">{entry.label}</span>
                      {entry.shortcut ? (
                        <span className="app-menu-item-shortcut" aria-hidden="true">
                          {entry.shortcut}
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
