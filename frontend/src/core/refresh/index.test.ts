/**
 * frontend/src/core/refresh/index.test.ts
 *
 * Test suite for index.
 * Covers key behaviors and edge cases for index.
 */

import { describe, expect, it } from 'vitest';
import {
  RefreshManagerProvider as RawProvider,
  useRefreshManagerContext as rawUseManagerContext,
} from './contexts/RefreshManagerContext';
import { useRefreshContext as rawUseContext } from './hooks/useRefreshContext';
import { useRefreshManager as rawUseManager } from './hooks/useRefreshManager';
import { useRefreshWatcher as rawUseWatcher } from './hooks/useRefreshWatcher';
import {
  RefreshManagerProvider,
  refreshManager,
  refreshOrchestrator,
  useRefreshContext,
  useRefreshManager,
  useRefreshManagerContext,
  useRefreshScopedDomain,
  useRefreshScopedDomainStates,
  useRefreshWatcher,
} from './index';
import { refreshOrchestrator as rawOrchestrator } from './orchestrator';
import { refreshManager as rawRefreshManager } from './RefreshManager';
import {
  useRefreshScopedDomain as rawUseScopedDomain,
  useRefreshScopedDomainStates as rawUseScopedStates,
} from './store';

describe('core/refresh index exports', () => {
  it('re-exports manager primitives and hooks', () => {
    expect(refreshManager).toBe(rawRefreshManager);
    expect(refreshOrchestrator).toBe(rawOrchestrator);
    expect(useRefreshScopedDomain).toBe(rawUseScopedDomain);
    expect(useRefreshScopedDomainStates).toBe(rawUseScopedStates);
    expect(RefreshManagerProvider).toBe(RawProvider);
    expect(useRefreshManagerContext).toBe(rawUseManagerContext);
    expect(useRefreshManager).toBe(rawUseManager);
    expect(useRefreshWatcher).toBe(rawUseWatcher);
    expect(useRefreshContext).toBe(rawUseContext);
  });
});
