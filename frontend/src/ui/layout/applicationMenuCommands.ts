import { backend } from '@/core/backend-api/models';
import type { ShortcutModifiers } from '@/types/shortcuts';

export interface ApplicationMenuAccelerator {
  key: string;
  modifiers: ShortcutModifiers;
  macModifiers?: ShortcutModifiers;
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
const primary = (key: string, shift = false): ApplicationMenuAccelerator => ({
  key,
  modifiers: { ctrl: true, shift },
  macModifiers: { meta: true, shift },
});
const control = (key: string, shift = false): ApplicationMenuAccelerator => ({
  key,
  modifiers: { ctrl: true, shift },
});
const nativeEdit = (key: string): ApplicationMenuAccelerator => ({
  ...primary(key),
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
          accelerator: primary('n'),
          command: command.ApplicationMenuCommandNewWindow,
        },
        separator('new-window'),
        {
          label: 'Open Cluster',
          accelerator: primary('o'),
          command: command.ApplicationMenuCommandOpenCluster,
        },
        {
          label: 'Close',
          accelerator: primary('w'),
          command: command.ApplicationMenuCommandClose,
        },
        separator('close'),
        {
          label: 'Settings…',
          accelerator: primary(','),
          command: command.ApplicationMenuCommandSettings,
        },
        separator('settings'),
        {
          label: windows ? 'Exit' : 'Quit',
          accelerator: primary('q'),
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
          accelerator: primary('p', true),
          command: command.ApplicationMenuCommandCommandPalette,
        },
        separator('palette'),
        {
          label: 'Zoom In',
          accelerator: primary('='),
          command: command.ApplicationMenuCommandZoomIn,
        },
        {
          label: 'Zoom Out',
          accelerator: primary('-'),
          command: command.ApplicationMenuCommandZoomOut,
        },
        {
          label: 'Reset Zoom',
          accelerator: primary('0'),
          command: command.ApplicationMenuCommandZoomReset,
        },
        separator('zoom'),
        {
          label: 'Toggle Sidebar',
          accelerator: primary('b'),
          command: command.ApplicationMenuCommandToggleSidebar,
        },
        {
          label: 'Diff Objects',
          accelerator: primary('d'),
          command: command.ApplicationMenuCommandToggleObjectDiff,
        },
        {
          label: 'Application Logs',
          accelerator: control('l', true),
          command: command.ApplicationMenuCommandToggleAppLogs,
        },
        {
          label: 'Diagnostics Panel',
          accelerator: control('d', true),
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
          accelerator: primary('m'),
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
          accelerator: primary('F12', true),
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
  includeDebug = import.meta.env.DEV,
  macPlatform = false
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
      const { macModifiers, ...accelerator } = entry.accelerator;
      return [
        {
          command: entry.command,
          label: entry.label,
          ...accelerator,
          modifiers: macPlatform && macModifiers ? macModifiers : accelerator.modifiers,
        },
      ];
    })
  );
