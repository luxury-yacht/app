/** A tab owns its content and portals it into a group-owned DOM slot. */
import type React from 'react';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { reportOperationalError } from '@/utils/errorHandler';
import { useDockablePanelContext } from './DockablePanelContext';
import type { GroupKey } from './tabGroupTypes';
import { type DockPosition, useDockablePanelState } from './useDockablePanelState';

export type { DockPosition };

interface DockablePanelProps {
  // Unique identifier for this panel instance
  panelId: string;

  // Content to render inside the panel
  children: React.ReactNode;

  // Optional title for the panel header
  title?: string;

  // Optional initial position
  defaultPosition?: DockPosition;
  // Optional initial group key target used during first tab-group sync.
  defaultGroupKey?: GroupKey | 'floating';

  // Optional initial size (defaults to Object Panel dimensions)
  defaultSize?: { width?: number; height?: number };

  // Callbacks
  onClose?: () => void;
  onPositionChange?: (position: DockPosition) => void;

  // Whether the panel is currently open
  isOpen?: boolean;
  // Keep registration and tab-group membership alive without mounting a
  // workspace surface while a native-window transfer is pending.
  suppressSurface?: boolean;

  // Class names for styling
  className?: string;
  contentClassName?: string;
  // Optional normalized kind class for rendering a compact tab indicator.
  tabKindClass?: string;
  // When enabled, Escape closes the active tab in this dockable group.
  closeActiveTabOnEscape?: boolean;

  // Maximize support
  allowMaximize?: boolean;
  onMaximizeChange?: (isMaximized: boolean) => void;
  maximizeTargetSelector?: string;
  panelRef?: React.Ref<HTMLDivElement>;
}

function assignRef<T>(ref: React.Ref<T> | undefined, value: T | null) {
  if (!ref) {
    return;
  }
  if (typeof ref === 'function') {
    ref(value);
    return;
  }
  try {
    (ref as React.RefObject<T | null>).current = value;
  } catch (error) {
    reportOperationalError(error, { source: 'DockablePanel', action: 'assignRef' });
  }
}

const DockablePanelInner: React.FC<DockablePanelProps> = ({
  panelId,
  children,
  title = 'Panel',
  defaultPosition = 'right',
  defaultGroupKey,
  defaultSize,
  onClose,
  onPositionChange,
  isOpen = true,
  suppressSurface = false,
  className = '',
  contentClassName = '',
  tabKindClass,
  closeActiveTabOnEscape = false,
  allowMaximize = false,
  onMaximizeChange,
  maximizeTargetSelector = '.content-body',
  panelRef,
}) => {
  const panel = useDockablePanelState(panelId, defaultPosition);
  const { registerPanel, unregisterPanel, syncPanelGroup, removePanelFromGroups } =
    useDockablePanelContext();
  const [contentHost, setContentHost] = useState<HTMLDivElement | null>(null);
  const previousIsOpen = useRef(isOpen);
  useEffect(() => {
    if (!panel.isInitialized) {
      panel.initialize({ isOpen });
    } else if (previousIsOpen.current !== isOpen) {
      panel.setOpen(isOpen);
    }
    previousIsOpen.current = isOpen;
  }, [panel, isOpen]);
  const callbacks = useRef({ onClose, onMaximizeChange });
  useLayoutEffect(() => {
    callbacks.current = { onClose, onMaximizeChange };
  });
  const close = useCallback(() => {
    panel.setOpen(false);
    callbacks.current.onClose?.();
  }, [panel.setOpen]);
  const maximizeChanged = useCallback(
    (maximized: boolean) => callbacks.current.onMaximizeChange?.(maximized),
    []
  );
  const defaultWidth = defaultSize?.width;
  const defaultHeight = defaultSize?.height;
  const registration = useMemo(
    () => ({
      panelId,
      title,
      position: panel.position,
      defaultSize: { width: defaultWidth, height: defaultHeight },
      allowMaximize,
      maximizeTargetSelector,
      className,
      contentClassName,
      tabKindClass,
      closeActiveTabOnEscape,
      suppressSurface,
      onClose: close,
      onMaximizeChange: maximizeChanged,
      contentHostRef: setContentHost,
    }),
    [
      panelId,
      title,
      panel.position,
      defaultWidth,
      defaultHeight,
      allowMaximize,
      maximizeTargetSelector,
      className,
      contentClassName,
      tabKindClass,
      closeActiveTabOnEscape,
      suppressSurface,
      close,
      maximizeChanged,
    ]
  );
  useLayoutEffect(() => {
    if (panel.isOpen) {
      registerPanel(registration);
    } else {
      unregisterPanel(panelId);
    }
  }, [registration, panelId, panel.isOpen, registerPanel, unregisterPanel]);
  useLayoutEffect(() => () => unregisterPanel(panelId), [panelId, unregisterPanel]);
  useEffect(() => {
    if (!panel.isInitialized) {
      return;
    }
    if (panel.isOpen) {
      syncPanelGroup(panelId, panel.position, defaultGroupKey);
    } else {
      removePanelFromGroups(panelId);
    }
  }, [
    panelId,
    panel.isInitialized,
    panel.isOpen,
    panel.position,
    defaultGroupKey,
    syncPanelGroup,
    removePanelFromGroups,
  ]);
  useEffect(() => onPositionChange?.(panel.position), [panel.position, onPositionChange]);
  useLayoutEffect(() => {
    assignRef(panelRef, contentHost);
    return () => assignRef(panelRef, null);
  }, [panelRef, contentHost]);
  return panel.isOpen && !suppressSurface && contentHost
    ? createPortal(children, contentHost)
    : null;
};
const DockablePanel = memo<DockablePanelProps>((props) => {
  if (!props.panelId) {
    console.warn('DockablePanel: panelId prop is required');
    return null;
  }
  return <DockablePanelInner {...props} />;
});
DockablePanel.displayName = 'DockablePanel';
export default DockablePanel;
