import { expect, it } from 'vitest';
import {
  buildGridTableStorageKey,
  captureClusterTableState,
  computeClusterHash,
  loadPersistedState,
  registerPendingGridTableSave,
  restoreClusterTableState,
  savePersistedState,
} from './gridTablePersistence';

it('carries only one cluster table state and leaves other cluster filters alone', async () => {
  const prod = buildGridTableStorageKey({
    clusterHash: await computeClusterHash('production'),
    viewId: 'workloads',
    namespace: 'default',
  });
  const stage = buildGridTableStorageKey({
    clusterHash: await computeClusterHash('staging'),
    viewId: 'workloads',
  });
  if (!prod || !stage) {
    throw new Error('Expected cluster table keys');
  }
  savePersistedState(prod, { version: 3, pageSize: 50 });
  savePersistedState(stage, { version: 3, pageSize: 100 });
  const snapshot = await captureClusterTableState('production');
  expect(Object.keys(snapshot)).toEqual([prod]);
  savePersistedState(prod, { version: 3, pageSize: 25 });
  await restoreClusterTableState('production', snapshot);
  expect(loadPersistedState(prod)?.pageSize).toBe(50);
  expect(loadPersistedState(stage)?.pageSize).toBe(100);
  await expect(
    restoreClusterTableState('production', { [stage]: { version: 3, pageSize: 10 } })
  ).rejects.toThrow('another cluster');
  expect(loadPersistedState(prod)?.pageSize).toBe(50);
  expect(loadPersistedState(stage)?.pageSize).toBe(100);
});

it('captures a pending filter save before the debounce expires', async () => {
  const key = buildGridTableStorageKey({
    clusterHash: await computeClusterHash('production'),
    viewId: 'pending-filters',
  });
  if (!key) {
    throw new Error('Expected table key');
  }
  const unregister = registerPendingGridTableSave(key, () =>
    savePersistedState(key, { version: 3, pageSize: 75 })
  );
  const snapshot = await captureClusterTableState('production');
  expect(snapshot[key]?.pageSize).toBe(75);
  unregister();
});
