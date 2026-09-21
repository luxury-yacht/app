import { createPortal } from 'react-dom';
import { DockablePanelLayer } from '@/ui/dockable/DockablePanelProvider';
import { requireValue } from './requireValue';

// Legacy panel fixtures construct their content shell outside the React root.
export function DockablePanelTestHost() {
  return createPortal(
    <DockablePanelLayer />,
    requireValue(document.querySelector('.content'), 'the panel fixture needs a content shell')
  );
}
