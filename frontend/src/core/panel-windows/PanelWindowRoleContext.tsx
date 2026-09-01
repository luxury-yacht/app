import type React from 'react';
import { createContext, useContext } from 'react';
import type { PanelWindowDescriptor } from './index';

const PanelWindowRoleContext = createContext<PanelWindowDescriptor | null>(null);

export const PanelWindowRoleProvider: React.FC<{
  descriptor: PanelWindowDescriptor;
  children: React.ReactNode;
}> = ({ descriptor, children }) => (
  <PanelWindowRoleContext.Provider value={descriptor}>{children}</PanelWindowRoleContext.Provider>
);

export const usePanelWindowRole = (): PanelWindowDescriptor | null =>
  useContext(PanelWindowRoleContext);
