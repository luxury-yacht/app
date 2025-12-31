/**
 * frontend/src/core/settings/legacyMigration.test.ts
 *
 * Test suite for legacy localStorage migration to the backend.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { migrateLegacyLocalStorage } from './legacyMigration';

const LEGACY_KEYS = {
  theme: 'app-theme-preference',
  shortNames: 'useShortResourceNames',
  autoRefresh: 'autoRefreshEnabled',
  backgroundRefresh: 'refreshBackgroundClustersEnabled',
  gridTablePersistence: 'gridtable:persistenceMode',
  clusterTabsOrder: 'clusterTabs:order',
};

const GRIDTABLE_KEY = 'gridtable:v1:abc123:cluster-nodes';

describe('migrateLegacyLocalStorage', () => {
  const migrateMock = vi.fn();

  beforeEach(() => {
    localStorage.clear();
    migrateMock.mockReset();
    (window as any).go = {
      backend: {
        App: {
          MigrateLegacyLocalStorage: migrateMock,
        },
      },
    };
  });

  afterEach(() => {
    localStorage.clear();
    delete (window as any).go;
  });

  it('sends a payload and clears legacy keys after migration', async () => {
    localStorage.setItem(LEGACY_KEYS.theme, 'dark');
    localStorage.setItem(LEGACY_KEYS.shortNames, 'true');
    localStorage.setItem(LEGACY_KEYS.autoRefresh, 'false');
    localStorage.setItem(LEGACY_KEYS.backgroundRefresh, 'false');
    localStorage.setItem(LEGACY_KEYS.gridTablePersistence, 'namespaced');
    localStorage.setItem(LEGACY_KEYS.clusterTabsOrder, JSON.stringify(['config:prod']));
    localStorage.setItem(GRIDTABLE_KEY, JSON.stringify({ version: 1, columnVisibility: {} }));

    migrateMock.mockResolvedValue(undefined);

    await migrateLegacyLocalStorage();

    expect(migrateMock).toHaveBeenCalledTimes(1);
    const payload = migrateMock.mock.calls[0][0];
    expect(payload).toMatchObject({
      theme: 'dark',
      useShortResourceNames: true,
      autoRefreshEnabled: false,
      refreshBackgroundClustersEnabled: false,
      gridTablePersistenceMode: 'namespaced',
      clusterTabsOrder: ['config:prod'],
    });
    expect(payload.gridTableEntries?.[GRIDTABLE_KEY]).toMatchObject({ version: 1 });

    expect(localStorage.getItem(LEGACY_KEYS.theme)).toBeNull();
    expect(localStorage.getItem(LEGACY_KEYS.shortNames)).toBeNull();
    expect(localStorage.getItem(LEGACY_KEYS.autoRefresh)).toBeNull();
    expect(localStorage.getItem(LEGACY_KEYS.backgroundRefresh)).toBeNull();
    expect(localStorage.getItem(LEGACY_KEYS.gridTablePersistence)).toBeNull();
    expect(localStorage.getItem(LEGACY_KEYS.clusterTabsOrder)).toBeNull();
    expect(localStorage.getItem(GRIDTABLE_KEY)).toBeNull();
  });
});
