import { type ReactNode, useState } from 'react';
import { createPanelLayoutStore } from '@/ui/dockable/panelLayoutStore';
import { PanelLayoutStoreContext } from '@/ui/dockable/panelLayoutStoreContext';

// Region-navigation tests need the same explicit layout owner as each renderer.
export function PanelLayoutTestProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [store] = useState(createPanelLayoutStore);
  return <PanelLayoutStoreContext value={store}>{children}</PanelLayoutStoreContext>;
}
