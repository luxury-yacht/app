import { backend } from '@/core/backend-api/models';
import type { ShortcutModifiers } from '@/types/shortcuts';

export interface ApplicationMenuAccelerator {
  key: string;
  modifiers: ShortcutModifiers;
  dispatchFromFrontend?: boolean;
}

export interface ApplicationMenuCommandItem {
  command: backend.ApplicationMenuCommand;
  label: string;
  accelerator?: ApplicationMenuAccelerator;
}

export interface ApplicationMenuSeparator {
  id: string;
  separator: true;
}

export type ApplicationMenuEntry = ApplicationMenuCommandItem | ApplicationMenuSeparator;

export interface ApplicationMenuSection {
  id: string;
  label: string;
  items: ApplicationMenuEntry[];
}

const command = backend.ApplicationMenuCommand;
const ctrl = (key: string, shift = false): ApplicationMenuAccelerator => ({
  key,
  modifiers: { ctrl: true, shift },
});
const nativeEdit = (key: string): ApplicationMenuAccelerator => ({
  ...ctrl(key),
  dispatchFromFrontend: false,
});
const separator = (id: string): ApplicationMenuSeparator => ({ id, separator: true });

export const isApplicationMenuCommandItem = (
  entry: ApplicationMenuEntry
): entry is ApplicationMenuCommandItem => 'command' in entry;

export const buildApplicationMenuSections = (
  windows: boolean,
  includeDebug = import.meta.env.DEV
): ApplicationMenuSection[] => {
  const sections: ApplicationMenuSection[] = [
    {
      id: 'file',
      label: 'File',
      items: [
        {
          label: 'New Window',
          accelerator: ctrl('n'),
          command: command.ApplicationMenuCommandNewWindow,
        },
        separator('new-window'),
        {
          label: 'Open Cluster',
          accelerator: ctrl('o'),
          command: command.ApplicationMenuCommandOpenCluster,
        },
        {
          label: 'Close',
          accelerator: ctrl('w'),
          command: command.ApplicationMenuCommandClose,
        },
        separator('close'),
        {
          label: 'Settings…',
          accelerator: ctrl(','),
          command: command.ApplicationMenuCommandSettings,
        },
        separator('settings'),
        {
          label: windows ? 'Exit' : 'Quit',
          accelerator: ctrl('q'),
          command: command.ApplicationMenuCommandQuit,
        },
      ],
    },
    {
      id: 'edit',
      label: 'Edit',
      items: [
        {
          label: 'Cut',
          accelerator: nativeEdit('x'),
          command: command.ApplicationMenuCommandCut,
        },
        {
          label: 'Copy',
          accelerator: nativeEdit('c'),
          command: command.ApplicationMenuCommandCopy,
        },
        {
          label: 'Paste',
          accelerator: nativeEdit('v'),
          command: command.ApplicationMenuCommandPaste,
        },
        {
          label: 'Select All',
          accelerator: nativeEdit('a'),
          command: command.ApplicationMenuCommandSelectAll,
        },
      ],
    },
    {
      id: 'view',
      label: 'View',
      items: [
        {
          label: 'Command Palette',
          accelerator: ctrl('p', true),
          command: command.ApplicationMenuCommandCommandPalette,
        },
        separator('palette'),
        {
          label: 'Zoom In',
          accelerator: ctrl('='),
          command: command.ApplicationMenuCommandZoomIn,
        },
        {
          label: 'Zoom Out',
          accelerator: ctrl('-'),
          command: command.ApplicationMenuCommandZoomOut,
        },
        {
          label: 'Reset Zoom',
          accelerator: ctrl('0'),
          command: command.ApplicationMenuCommandZoomReset,
        },
        separator('zoom'),
        {
          label: 'Toggle Sidebar',
          accelerator: ctrl('b'),
          command: command.ApplicationMenuCommandToggleSidebar,
        },
        {
          label: 'Diff Objects',
          accelerator: ctrl('d'),
          command: command.ApplicationMenuCommandToggleObjectDiff,
        },
        {
          label: 'Application Logs',
          accelerator: ctrl('l', true),
          command: command.ApplicationMenuCommandToggleAppLogs,
        },
        {
          label: 'Diagnostics Panel',
          accelerator: ctrl('d', true),
          command: command.ApplicationMenuCommandToggleDiagnostics,
        },
      ],
    },
    {
      id: 'window',
      label: 'Window',
      items: [
        {
          label: 'Minimize',
          accelerator: ctrl('m'),
          command: command.ApplicationMenuCommandMinimise,
        },
        { label: 'Maximize', command: command.ApplicationMenuCommandMaximise },
        { label: 'Restore', command: command.ApplicationMenuCommandRestore },
      ],
    },
  ];

  if (includeDebug) {
    sections.push({
      id: 'debug',
      label: 'Debug',
      items: [
        {
          label: 'Open Inspector',
          accelerator: ctrl('F12', true),
          command: command.ApplicationMenuCommandOpenInspector,
        },
        separator('inspector'),
        {
          label: 'Keyboard Focus Overlay',
          command: command.ApplicationMenuCommandToggleFocusDebug,
        },
        { label: 'Panel Debug Overlay', command: command.ApplicationMenuCommandTogglePanelDebug },
        { label: 'Map Debug Overlay', command: command.ApplicationMenuCommandToggleMapDebug },
        { label: 'Icon Debug Overlay', command: command.ApplicationMenuCommandToggleIconDebug },
        { label: 'Error Boundary Tests', command: command.ApplicationMenuCommandToggleErrorDebug },
      ],
    });
  }

  sections.push({
    id: 'help',
    label: 'Help',
    items: [
      { label: 'About Luxury Yacht', command: command.ApplicationMenuCommandAbout },
      { label: 'Check for Updates…', command: command.ApplicationMenuCommandCheckForUpdates },
    ],
  });
  return sections;
};

export const applicationMenuAccelerators = (
  includeDebug = import.meta.env.DEV
): Array<
  Required<Pick<ApplicationMenuCommandItem, 'command' | 'label'>> & ApplicationMenuAccelerator
> =>
  buildApplicationMenuSections(false, includeDebug).flatMap((section) =>
    section.items.flatMap((entry) => {
      if (
        !isApplicationMenuCommandItem(entry) ||
        !entry.accelerator ||
        entry.accelerator.dispatchFromFrontend === false
      ) {
        return [];
      }
      return [{ command: entry.command, label: entry.label, ...entry.accelerator }];
    })
  );
