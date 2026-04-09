/**
 * DockablePanelContentArea.tsx
 *
 * Exposes a single hook, `useDockablePanelEmptySpaceDropTarget`, that
 * consumers merge onto an existing container element (e.g.
 * `AppLayout.tsx`'s `<main>`) to provide the empty-space drop target
 * that undocks a dragged tab into a new floating group.
 *
 * Why this lives in its own file: `DockablePanelProvider` does not own
 * a DOM element that naturally maps to the "content area" the user
 * sees. The `.dockable-panel-layer` it creates has `pointer-events:
 * none`, so the browser will not route drag events to it. The safe
 * pattern is to attach the drop target to an existing real element
 * outside the provider — `<main>` in `AppLayout.tsx` — via a ref merge.
 * This hook encapsulates the drop-target wiring so the consumer only
 * needs to call the hook and attach the returned ref.
 *
 * Native HTML5 drag events bubble, and `useTabDropTarget` calls
 * `stopPropagation` on drops it consumes (added in Task 1a). That
 * means a drop inside a tab bar's drop target fires the bar's `onDrop`
 * and never reaches this container target; only drops that fall
 * through to empty space get here. No further gating is required.
 */
import { useTabDropTarget } from '@shared/components/tabs/dragCoordinator';
import { useDockablePanelContext } from './DockablePanelProvider';

export function useDockablePanelEmptySpaceDropTarget() {
  const { createFloatingGroupWithPanel } = useDockablePanelContext();
  return useTabDropTarget({
    accepts: ['dockable-tab'],
    onDrop: (payload, event) => {
      createFloatingGroupWithPanel(payload.panelId, payload.sourceGroupId, {
        x: event.clientX,
        y: event.clientY,
      });
    },
  });
}
