import { createContext, type ReactNode, useContext } from 'react';
import { ExecuteApplicationMenuCommand } from '@/core/backend-api';
import type { backend } from '@/core/backend-api/models';
import { reportOperationalError } from '@/utils/errorHandler';

export type ApplicationMenuCommandExecutor = (command: backend.ApplicationMenuCommand) => void;

export const executeBackendApplicationMenuCommand: ApplicationMenuCommandExecutor = (command) => {
  void ExecuteApplicationMenuCommand(command).catch((error) => {
    reportOperationalError(error, {
      source: 'ApplicationMenuCommands',
      action: `execute:${command}`,
    });
  });
};

const ApplicationMenuCommandContext = createContext<ApplicationMenuCommandExecutor>(
  executeBackendApplicationMenuCommand
);

export function ApplicationMenuCommandProvider({
  children,
  execute,
}: Readonly<{ children: ReactNode; execute: ApplicationMenuCommandExecutor }>) {
  return (
    <ApplicationMenuCommandContext.Provider value={execute}>
      {children}
    </ApplicationMenuCommandContext.Provider>
  );
}

export const useApplicationMenuCommandExecutor = () => useContext(ApplicationMenuCommandContext);
