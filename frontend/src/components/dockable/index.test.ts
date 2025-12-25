/**
 * frontend/src/components/dockable/index.test.ts
 *
 * Test suite for index.
 * Covers key behaviors and edge cases for index.
 */

import { describe, expect, it } from 'vitest';

import {
  DockablePanel,
  DockablePanelProvider,
  getAllPanelStates,
  restorePanelStates,
  useDockablePanelContext,
  useDockablePanelState,
} from './index';
import RawDockablePanel from './DockablePanel';
import {
  DockablePanelProvider as RawProvider,
  useDockablePanelContext as rawUseContext,
} from './DockablePanelProvider';
import {
  useDockablePanelState as rawUseState,
  getAllPanelStates as rawGetAll,
  restorePanelStates as rawRestore,
} from './useDockablePanelState';

describe('components/dockable index exports', () => {
  it('re-exports DockablePanel and provider utilities', () => {
    expect(DockablePanel).toBe(RawDockablePanel);
    expect(DockablePanelProvider).toBe(RawProvider);
    expect(useDockablePanelContext).toBe(rawUseContext);
  });

  it('re-exports state helpers', () => {
    expect(useDockablePanelState).toBe(rawUseState);
    expect(getAllPanelStates).toBe(rawGetAll);
    expect(restorePanelStates).toBe(rawRestore);
  });
});
