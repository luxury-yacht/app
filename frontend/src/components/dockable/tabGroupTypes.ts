/**
 * tabGroupTypes.ts
 *
 * Type definitions for the tab group system.
 * A tab group is an ordered collection of panel IDs sharing a dock position.
 */

import type React from 'react';
import type { DockPosition } from './useDockablePanelState';

/** Metadata that a panel provides when it registers with the provider. */
export interface PanelRegistration {
  panelId: string;
  title: string;
  position: DockPosition;
  defaultSize?: { width?: number; height?: number };
  allowMaximize?: boolean;
  maximizeTargetSelector?: string;
  className?: string;
  contentClassName?: string;
  onClose?: () => void;
  onPositionChange?: (position: DockPosition) => void;
  onMaximizeChange?: (isMaximized: boolean) => void;
  /** Ref forwarded from the consumer for keyboard scoping etc. */
  panelRef?: React.Ref<HTMLDivElement>;
}

/** A floating tab group with its own position/size identity. */
export interface FloatingTabGroup {
  groupId: string;
  tabs: string[];
  activeTab: string | null;
}

/** State for all tab groups managed by the provider. */
export interface TabGroupState {
  right: { tabs: string[]; activeTab: string | null };
  bottom: { tabs: string[]; activeTab: string | null };
  floating: FloatingTabGroup[];
}

/** Drag state tracked by the provider during tab drags. */
export interface TabDragState {
  panelId: string;
  sourceGroupKey: string;
  cursorPosition: { x: number; y: number };
  dropTarget: { groupKey: string; insertIndex: number } | null;
}

/** Identifies which group a panel belongs to. */
export type GroupKey = 'right' | 'bottom' | string;
