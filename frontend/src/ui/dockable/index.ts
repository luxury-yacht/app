/**
 * frontend/src/components/dockable/index.ts
 *
 * Barrel exports for dockable.
 * Re-exports public APIs for the shared components.
 */

/*
 * index.ts
 *
 * Exports for dockable panel components and hooks.
 * Provides a centralized entry point for importing dockable panel functionality.
 */

export type { DockPosition } from './DockablePanel';
export { default as DockablePanel } from './DockablePanel';
export { DockablePanelProvider, useDockablePanelContext } from './DockablePanelProvider';
export type { TabInfo } from './DockableTabBar';
export { DockableTabBar } from './DockableTabBar';
export type { GroupKey, PanelRegistration, TabGroupState } from './tabGroupTypes';
export {
  getAllPanelStates,
  restorePanelStates,
  useDockablePanelState,
} from './useDockablePanelState';
