/**
 * frontend/src/core/refresh/index.ts
 *
 * Barrel exports for refresh.
 * Re-exports public APIs for the core layer.
 */

// Core exports
export { refreshManager } from './RefreshManager';
export { refreshOrchestrator } from './orchestrator';
export { useRefreshDomain, useRefreshScopedDomainStates, useRefreshScopedDomain } from './store';
export type { Refresher, RefreshContext, RefresherState, RefreshCallback } from './RefreshManager';

// Context exports
export { RefreshManagerProvider, useRefreshManagerContext } from './contexts/RefreshManagerContext';

// Hook exports
export { useRefreshManager } from './hooks/useRefreshManager';
export { useRefreshWatcher } from './hooks/useRefreshWatcher';
export { useRefreshContext } from './hooks/useRefreshContext';
export { useAutoRefresh, initializeAutoRefresh } from './hooks/useAutoRefresh';
export { useBackgroundRefresh, getBackgroundRefreshEnabled } from './hooks/useBackgroundRefresh';
