import { useCallback, useMemo } from 'react';
import { ExecuteApplicationMenuCommand } from '@/core/backend-api';
import type { backend } from '@/core/backend-api/models';
import { applicationMenuAccelerators } from '@/ui/layout/applicationMenuCommands';
import { reportOperationalError } from '@/utils/errorHandler';
import { isMacPlatform } from '@/utils/platform';
import { useShortcuts } from '../hooks';

export function ApplicationMenuShortcuts({ enabled = true }: Readonly<{ enabled?: boolean }>) {
  const dispatchCommand = useCallback((menuCommand: backend.ApplicationMenuCommand) => {
    void ExecuteApplicationMenuCommand(menuCommand).catch((error) => {
      reportOperationalError(error, {
        source: 'ApplicationMenuShortcuts',
        action: `execute:${menuCommand}`,
      });
    });
  }, []);

  const shortcuts = useMemo(
    () =>
      applicationMenuAccelerators().map((accelerator) => ({
        key: accelerator.key,
        modifiers: accelerator.modifiers,
        description: accelerator.label,
        handler: (event?: KeyboardEvent) => {
          if (!event?.repeat) {
            dispatchCommand(accelerator.command);
          }
          return true;
        },
      })),
    [dispatchCommand]
  );

  useShortcuts(shortcuts, {
    category: 'Application',
    enabled: enabled && !isMacPlatform(),
    priority: 1000,
    scope: 'application-menu',
  });

  return null;
}
