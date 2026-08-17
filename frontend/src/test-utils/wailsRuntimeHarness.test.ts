import { describe, expect, it, vi } from 'vitest';
import { createWailsRuntimeHarness } from './wailsRuntimeHarness';

describe('createWailsRuntimeHarness', () => {
  it('returns a per-listener disposer without clearing sibling listeners', () => {
    const harness = createWailsRuntimeHarness();
    const first = vi.fn();
    const second = vi.fn();

    const disposeFirst = harness.onEvent('cluster:scope:changed', first);
    harness.onEvent('cluster:scope:changed', second);
    disposeFirst();
    harness.emit('cluster:scope:changed', { clusterId: 'cluster-a' });

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith({ clusterId: 'cluster-a' });
    expect(harness.disposerCalls).toEqual(['cluster:scope:changed']);
  });
});
