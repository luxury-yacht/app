/**
 * frontend/src/core/refresh/index.ts
 *
 * Barrel exports for refresh.
 * Re-exports public APIs for the core layer.
 */

// Context exports
export { RefreshManagerProvider } from './contexts/RefreshManagerContext';
export { initializeAutoRefresh, useAutoRefresh } from './hooks/useAutoRefresh';
export { useBackgroundRefresh } from './hooks/useBackgroundRefresh';
export { refreshOrchestrator } from './orchestrator';
export type { RefreshCallback, RefreshContext, Refresher } from './RefreshManager';
// Core exports
export { refreshManager } from './RefreshManager';
export { useRefreshScopedDomain, useRefreshScopedDomainStates } from './store';
