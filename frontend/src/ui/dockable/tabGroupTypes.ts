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
  /** Optional normalized kind class used for compact tab type indicators. */
  tabKindClass?: string;
  position: DockPosition;
  defaultSize?: { width?: number; height?: number };
  allowMaximize?: boolean;
  maximizeTargetSelector?: string;
  className?: string;
  contentClassName?: string;
  onClose?: () => void;
  onMaximizeChange?: (isMaximized: boolean) => void;
  contentHostRef?: React.RefCallback<HTMLDivElement>;
  suppressSurface?: boolean;
  closeActiveTabOnEscape?: boolean;
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

/** Identifies which group a panel belongs to. */
export type GroupKey = 'right' | 'bottom' | string;
