import { describe, expect, it } from 'vitest';

import {
  RefreshManagerProvider,
  refreshManager,
  refreshOrchestrator,
  useRefreshContext,
  useRefreshDomain,
  useRefreshManager,
  useRefreshManagerContext,
  useRefreshScopedDomainStates,
  useRefreshWatcher,
} from './index';
import { refreshManager as rawRefreshManager } from './RefreshManager';
import { refreshOrchestrator as rawOrchestrator } from './orchestrator';
import {
  useRefreshDomain as rawUseDomain,
  useRefreshScopedDomainStates as rawUseScopedStates,
} from './store';
import {
  RefreshManagerProvider as RawProvider,
  useRefreshManagerContext as rawUseManagerContext,
} from './contexts/RefreshManagerContext';
import { useRefreshManager as rawUseManager } from './hooks/useRefreshManager';
import { useRefreshWatcher as rawUseWatcher } from './hooks/useRefreshWatcher';
import { useRefreshContext as rawUseContext } from './hooks/useRefreshContext';

describe('core/refresh index exports', () => {
  it('re-exports manager primitives and hooks', () => {
    expect(refreshManager).toBe(rawRefreshManager);
    expect(refreshOrchestrator).toBe(rawOrchestrator);
    expect(useRefreshDomain).toBe(rawUseDomain);
    expect(useRefreshScopedDomainStates).toBe(rawUseScopedStates);
    expect(RefreshManagerProvider).toBe(RawProvider);
    expect(useRefreshManagerContext).toBe(rawUseManagerContext);
    expect(useRefreshManager).toBe(rawUseManager);
    expect(useRefreshWatcher).toBe(rawUseWatcher);
    expect(useRefreshContext).toBe(rawUseContext);
  });
});
