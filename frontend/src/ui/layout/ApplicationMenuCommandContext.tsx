import { createContext, type ReactNode, useContext } from 'react';
import { ExecuteApplicationMenuCommand } from '@/core/backend-api';
import { backend } from '@/core/backend-api/models';
import { errorHandler, reportOperationalError } from '@/utils/errorHandler';

export type ApplicationMenuCommandExecutor = (command: backend.ApplicationMenuCommand) => void;

export const executeBackendApplicationMenuCommand: ApplicationMenuCommandExecutor = (command) => {
  void ExecuteApplicationMenuCommand(command).catch((error) => {
    const context = {
      source: 'ApplicationMenuCommands',
      action: `execute:${command}`,
    };
    if (command === backend.ApplicationMenuCommand.ApplicationMenuCommandNewWindow) {
      errorHandler.handle(
        error,
        context,
        `Could not open a new window. ${errorHandler.describe(error).message}`
      );
      return;
    }
    reportOperationalError(error, context);
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
