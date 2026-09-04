import { useMemo } from 'react';
import {
  type ApplicationMenuCommandExecutor,
  useApplicationMenuCommandExecutor,
} from '@/ui/layout/ApplicationMenuCommandContext';
import { applicationMenuAccelerators } from '@/ui/layout/applicationMenuCommands';
import { isMacPlatform, usesCustomWindowFrame } from '@/utils/platform';
import { useShortcuts } from '../hooks';

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
    category: 'Application',
    enabled: enabled && usesCustomWindowFrame(),
    discoverable: enabled && macPlatform,
    priority: 1000,
    scope: 'application-menu',
  });

  return null;
}
