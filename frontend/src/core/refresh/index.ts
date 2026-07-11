/**
 * frontend/src/core/refresh/index.ts
 *
 * Barrel exports for refresh.
 * Re-exports public APIs for the core layer.
 */

// Context exports
export { RefreshManagerProvider, useRefreshManagerContext } from './contexts/RefreshManagerContext';
export { initializeAutoRefresh, useAutoRefresh } from './hooks/useAutoRefresh';
export { useBackgroundRefresh } from './hooks/useBackgroundRefresh';
export { useRefreshContext } from './hooks/useRefreshContext';
// Hook exports
export { useRefreshManager } from './hooks/useRefreshManager';
export { useRefreshWatcher } from './hooks/useRefreshWatcher';
export { refreshOrchestrator } from './orchestrator';
export type { RefreshCallback, RefreshContext, Refresher, RefresherState } from './RefreshManager';
// Core exports
export { refreshManager } from './RefreshManager';
export { useRefreshScopedDomain, useRefreshScopedDomainStates } from './store';
