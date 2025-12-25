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

export { default as DockablePanel } from './DockablePanel';
export type { DockPosition } from './DockablePanel';
export {
  useDockablePanelState,
  getAllPanelStates,
  restorePanelStates,
} from './useDockablePanelState';
export { DockablePanelProvider, useDockablePanelContext } from './DockablePanelProvider';
