/**
 * frontend/src/core/refresh/hooks/useStreamSignalRefetch.test.ts
 *
 * Tests for the shared refetch-on-signal hook. Doorbells/change signals only
 * advance a scope's sourceVersion — every consumer of stream-domain scope DATA
 * needs this hook (or an equivalent) or its data freezes when polling skips.
 */

import React, { act } from 'react';
import ReactDOM from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const requestRefreshDomainMock = vi.hoisted(() =>
  vi.fn(() => Promise.resolve({ status: 'executed' as const }))
);

vi.mock('@/core/data-access', () => ({
  requestRefreshDomain: requestRefreshDomainMock,
}));

import { resetAllScopedDomainStates, setScopedDomainState } from '../store';
import { useStreamSignalRefetch } from './useStreamSignalRefetch';

const SCOPE = 'cluster-a|';

const Harness: React.FC<{ scopes: string[] }> = ({ scopes }) => {
  useStreamSignalRefetch('namespaces', scopes);
  return null;
};

describe('useStreamSignalRefetch', () => {
  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  let root: ReactDOM.Root;
  let container: HTMLElement;

  const render = (scopes: string[] = [SCOPE]) => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    act(() => {
      root.render(<Harness scopes={scopes} />);
    });
  };

  // Doorbells set BOTH the folded sourceVersion and their clock entry
  // (bumpSourceVersionOnly does exactly this).
  const setSourceVersion = (version: string, scope = SCOPE) => {
    act(() => {
      setScopedDomainState('namespaces', scope, (previous) => ({
        ...previous,
        status: 'ready',
        data: { clusterId: 'cluster-a', namespaces: [] } as never,
        sourceVersion: version,
        sourceVersions: { ...(previous.sourceVersions ?? {}), object: version } as never,
        scope,
      }));
    });
  };

  // A payload apply REPLACES sourceVersions with the payload's own map — for
  // namespaces that map carries no object clock.
  const applyPayload = (validator: string, scope = SCOPE) => {
    act(() => {
      setScopedDomainState('namespaces', scope, (previous) => ({
        ...previous,
        sourceVersion: validator,
        sourceVersions: { workloads: 'sig-' + validator } as never,
        scope,
      }));
    });
  };

  beforeEach(() => {
    requestRefreshDomainMock.mockClear();
    requestRefreshDomainMock.mockImplementation(() =>
      Promise.resolve({ status: 'executed' as const })
    );
    resetAllScopedDomainStates('namespaces');
  });

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    resetAllScopedDomainStates('namespaces');
  });

  it('keys on the declared doorbell clocks — payload validator churn must NOT refire', async () => {
    // The namespaces payload stamps a `workloads` clock and a fresh validator
    // on every not-yet-settled build; only the OBJECT clock is doorbell-fed.
    // Keying on sourceVersion turned every fetch response into another
    // "signal" — a fetch loop during cluster warm-up (observed live).
    act(() => {
      setScopedDomainState('namespaces', SCOPE, (previous) => ({
        ...previous,
        status: 'ready',
        data: { clusterId: 'cluster-a', namespaces: [] } as never,
        sourceVersion: 'validator-1',
        sourceVersions: { workloads: 'sig-1' } as never,
        scope: SCOPE,
      }));
    });
    render();
    await act(async () => {});

    // A fetch applies a new validator + new workloads signature (settling
    // build): NOT a doorbell — no refetch.
    act(() => {
      setScopedDomainState('namespaces', SCOPE, (previous) => ({
        ...previous,
        sourceVersion: 'validator-2',
        sourceVersions: { workloads: 'sig-2' } as never,
      }));
    });
    await act(async () => {});
    expect(requestRefreshDomainMock).not.toHaveBeenCalled();

    // The object clock (doorbell-fed) advances: refetch.
    act(() => {
      setScopedDomainState('namespaces', SCOPE, (previous) => ({
        ...previous,
        sourceVersion: 'ns-4',
        sourceVersions: { ...(previous.sourceVersions ?? {}), object: 'ns-4' } as never,
      }));
    });
    await act(async () => {});
    expect(requestRefreshDomainMock).toHaveBeenCalledTimes(1);
  });

  it('refetches with reason stream-signal when the scoped sourceVersion advances', async () => {
    // Initial state carries the initial fetch's validator (applySnapshot always
    // sets sourceVersion after a 200) — it must be consumed WITHOUT a fetch.
    setSourceVersion('validator-1');
    render();
    await act(async () => {});
    expect(requestRefreshDomainMock).not.toHaveBeenCalled();

    // A doorbell advances the version: exactly one stream-signal refetch.
    setSourceVersion('ns-7');
    await act(async () => {});
    expect(requestRefreshDomainMock).toHaveBeenCalledTimes(1);
    expect(requestRefreshDomainMock).toHaveBeenCalledWith({
      domain: 'namespaces',
      scope: SCOPE,
      reason: 'stream-signal',
    });
  });

  it('settles when its own fetch applies a payload without doorbell clocks', async () => {
    setSourceVersion('initial-1');
    render();
    await act(async () => {});

    // The doorbell's refetch applies a payload whose clock map has no object
    // entry (namespaces): our fetch landing, not a new signal — settles at ONE.
    requestRefreshDomainMock.mockImplementationOnce(async () => {
      applyPayload('validator-2');
      return { status: 'executed' as const };
    });
    setSourceVersion('ns-7');
    await act(async () => {});
    await act(async () => {});
    await act(async () => {});
    expect(requestRefreshDomainMock).toHaveBeenCalledTimes(1);

    // Stable: nothing further fires.
    await act(async () => {});
    expect(requestRefreshDomainMock).toHaveBeenCalledTimes(1);

    // The NEXT real signal still fires.
    setSourceVersion('ns-8');
    await act(async () => {});
    expect(requestRefreshDomainMock).toHaveBeenCalledTimes(2);
  });

  it('ignores scopes it was not given and unchanged versions', async () => {
    setSourceVersion('validator-1');
    render();
    await act(async () => {});

    // Unchanged version: nothing.
    setSourceVersion('validator-1');
    await act(async () => {});
    expect(requestRefreshDomainMock).not.toHaveBeenCalled();

    // A different scope's signal: nothing.
    setSourceVersion('ns-9', 'cluster-b|');
    await act(async () => {});
    expect(requestRefreshDomainMock).not.toHaveBeenCalled();
  });

  it('treats a scope appearing later as already-fresh (its first version is its initial fetch)', async () => {
    render([SCOPE, 'cluster-b|']);
    await act(async () => {});

    // cluster-b joins with its initial fetch's payload (no doorbell clocks):
    // consumed, no fetch.
    applyPayload('validator-b1', 'cluster-b|');
    await act(async () => {});
    expect(requestRefreshDomainMock).not.toHaveBeenCalled();

    // Its next signal fires.
    setSourceVersion('ns-3', 'cluster-b|');
    await act(async () => {});
    expect(requestRefreshDomainMock).toHaveBeenCalledTimes(1);
    expect(requestRefreshDomainMock).toHaveBeenCalledWith({
      domain: 'namespaces',
      scope: 'cluster-b|',
      reason: 'stream-signal',
    });
  });
});
