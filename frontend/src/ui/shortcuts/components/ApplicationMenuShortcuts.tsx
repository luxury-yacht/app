import { useMemo } from 'react';
import { backend } from '@/core/backend-api/models';
import type { ShortcutDefinition } from '@/types/shortcuts';
import {
  type ApplicationMenuCommandExecutor,
  useApplicationMenuCommandExecutor,
} from '@/ui/layout/ApplicationMenuCommandContext';
import { applicationMenuAccelerators } from '@/ui/layout/applicationMenuCommands';
import { isMacPlatform, usesCustomWindowFrame } from '@/utils/platform';
import { useShortcuts } from '../hooks';

const command = backend.ApplicationMenuCommand;
const COMMAND_HELP: Partial<
  Record<backend.ApplicationMenuCommand, Pick<ShortcutDefinition, 'category' | 'helpOrder'>>
> = {
  [command.ApplicationMenuCommandNewWindow]: { category: 'Windows & Panels', helpOrder: 10 },
  [command.ApplicationMenuCommandOpenCluster]: { category: 'Windows & Panels', helpOrder: 20 },
  [command.ApplicationMenuCommandClose]: { category: 'Windows & Panels', helpOrder: 30 },
  [command.ApplicationMenuCommandMinimise]: { category: 'Windows & Panels', helpOrder: 50 },
  [command.ApplicationMenuCommandToggleSidebar]: { category: 'Windows & Panels', helpOrder: 60 },
  [command.ApplicationMenuCommandQuit]: { category: 'Windows & Panels', helpOrder: 70 },
  [command.ApplicationMenuCommandCommandPalette]: { category: 'Search', helpOrder: 10 },
  [command.ApplicationMenuCommandZoomIn]: { category: 'Zoom', helpOrder: 10 },
  [command.ApplicationMenuCommandZoomOut]: { category: 'Zoom', helpOrder: 20 },
  [command.ApplicationMenuCommandZoomReset]: { category: 'Zoom', helpOrder: 30 },
  [command.ApplicationMenuCommandToggleObjectDiff]: { category: 'Resource Data', helpOrder: 20 },
  [command.ApplicationMenuCommandSettings]: { category: 'Settings & Tools', helpOrder: 10 },
  [command.ApplicationMenuCommandToggleAppLogs]: { category: 'Settings & Tools', helpOrder: 30 },
  [command.ApplicationMenuCommandToggleDiagnostics]: {
    category: 'Settings & Tools',
    helpOrder: 40,
  },
  [command.ApplicationMenuCommandOpenInspector]: { category: 'Settings & Tools', helpOrder: 50 },
};

export function ApplicationMenuShortcuts({
  enabled = true,
  execute,
}: Readonly<{ enabled?: boolean; execute?: ApplicationMenuCommandExecutor }>) {
  const contextExecutor = useApplicationMenuCommandExecutor();
  const executeCommand = execute ?? contextExecutor;
  const macPlatform = isMacPlatform();

  const shortcuts = useMemo(
    () =>
      applicationMenuAccelerators(import.meta.env.DEV, macPlatform).map((accelerator) => ({
        key: accelerator.key,
        modifiers: accelerator.modifiers,
        description: accelerator.label,
        ...COMMAND_HELP[accelerator.command],
        applicationMenuCommand: accelerator.command,
        handler: (event?: KeyboardEvent) => {
          if (!event?.repeat) {
            executeCommand(accelerator.command);
          }
          return true;
        },
      })),
    [executeCommand, macPlatform]
  );

  useShortcuts(shortcuts, {
    enabled: enabled && usesCustomWindowFrame(),
    discoverable: enabled && macPlatform,
    priority: 1000,
    scope: 'application-menu',
  });

  return null;
}
