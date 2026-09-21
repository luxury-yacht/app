import { DockBottomIcon, DockRightIcon } from '@shared/components/icons/DockableIcons';
import { useTabDragPresence, useTabDropTarget } from '@shared/components/tabs/dragCoordinator';
import { useLayoutEffect, useRef, useState } from 'react';
import { useDockablePanelContext } from './DockablePanelContext';
import {
  getContentBounds,
  getDockedPanelExtent,
  getPanelGroupInitialSize,
  getPanelSizeConstraints,
} from './dockablePanelLayout';
import { useDockableGroupState } from './useDockableGroupState';

type DockEdge = 'right' | 'bottom';

function DockPlacementPreview({
  edge,
  sourcePanelId,
}: Readonly<{ edge: DockEdge; sourcePanelId: string | null }>) {
  const { panelRegistrations, tabGroups } = useDockablePanelContext();
  const layout = useDockableGroupState(edge, false);
  const bottomLayout = useDockableGroupState('bottom', false);
  const source = sourcePanelId ? panelRegistrations.get(sourcePanelId) : undefined;
  const initialSize =
    layout.isInitialized || !source ? undefined : getPanelGroupInitialSize(source);
  const width = initialSize?.width ?? layout.size.width;
  const height = initialSize?.height ?? layout.size.height;
  const bottomRemains = tabGroups.bottom.tabs.some((id) => {
    const registration = panelRegistrations.get(id);
    return id !== sourcePanelId && registration && !registration.suppressSurface;
  });
  const bottomOffset =
    edge === 'right' && bottomRemains && !bottomLayout.isMaximized ? bottomLayout.size.height : 0;
  const previewRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const preview = previewRef.current;
    if (!preview) {
      return;
    }
    const updateGeometry = () => {
      const extent = getDockedPanelExtent(
        edge,
        { width, height },
        getPanelSizeConstraints(preview),
        getContentBounds()
      );
      preview.style.setProperty('--dock-preview-size', `${extent}px`);
      preview.style.setProperty('--dock-preview-bottom-offset', `${bottomOffset}px`);
    };
    updateGeometry();
    window.addEventListener('resize', updateGeometry);
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateGeometry);
    const content = preview.closest('.content');
    if (content) {
      observer?.observe(content);
    }
    return () => {
      window.removeEventListener('resize', updateGeometry);
      observer?.disconnect();
    };
  }, [edge, width, height, bottomOffset]);

  const Icon = edge === 'right' ? DockRightIcon : DockBottomIcon;
  return (
    <div
      ref={previewRef}
      data-dock-preview={edge}
      className={`dockable-panel-drop-preview dockable-panel-drop-preview--${edge}`}
      aria-hidden="true"
    >
      <div className="dockable-panel-drop-preview__header">
        <Icon width={16} height={16} />
        <span>{source?.title ?? `Dock ${edge}`}</span>
      </div>
      <span className="dockable-panel-drop-preview__label">Dock {edge}</span>
    </div>
  );
}

function EmptyDockTarget({ edge }: Readonly<{ edge: DockEdge }>) {
  const { tabDropScope, dropDockableTab } = useDockablePanelContext();
  const [sourcePanelId, setSourcePanelId] = useState<string | null>(null);
  const { ref, isDragOver, dropInsertIndex } = useTabDropTarget({
    accepts: ['dockable-tab'],
    scope: tabDropScope,
    onDragEnter: (payload) => setSourcePanelId(payload.panelId),
    onDrop: (payload, _event, insertIndex) => dropDockableTab(payload, edge, insertIndex),
  });
  const hovered = isDragOver || dropInsertIndex !== null;
  return (
    <>
      <div
        ref={ref}
        data-dock-drop-target={edge}
        className={`dockable-panel-drop-target dockable-panel-drop-target--${edge}${hovered ? ' dockable-panel-drop-target--over' : ''}`}
      >
        <div className="dockable-panel-drop-target__rail" />
      </div>
      {hovered ? <DockPlacementPreview edge={edge} sourcePanelId={sourcePanelId} /> : null}
    </>
  );
}

export function DockablePanelDropTargets({ emptyEdges }: Readonly<{ emptyEdges: DockEdge[] }>) {
  const { tabDropScope } = useDockablePanelContext();
  const present = useTabDragPresence({ accepts: ['dockable-tab'], scope: tabDropScope });
  return present && emptyEdges.length > 0 ? (
    <div className="dockable-panel-drop-targets">
      {emptyEdges.map((edge) => (
        <EmptyDockTarget key={edge} edge={edge} />
      ))}
    </div>
  ) : null;
}
