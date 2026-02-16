/**
 * panelLayoutStoreContext.tsx
 *
 * React context for provider-scoped panel layout store access.
 */

import { createContext, useContext } from 'react';
import type { PanelLayoutStore } from './panelLayoutStore';

export const PanelLayoutStoreContext = createContext<PanelLayoutStore | null>(null);

export function usePanelLayoutStoreContext(): PanelLayoutStore {
  const store = useContext(PanelLayoutStoreContext);
  if (!store) {
    throw new Error('Dockable panel layout store is unavailable without DockablePanelProvider');
  }
  return store;
}
