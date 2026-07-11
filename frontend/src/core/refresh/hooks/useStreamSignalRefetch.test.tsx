/**
 * frontend/src/core/refresh/hooks/useStreamSignalRefetch.test.tsx
 *
 * Tests for the shared refetch-on-signal hook. Doorbells advance a scope's
 * signalVersions (written ONLY by the stream manager) — every consumer of
 * stream-domain scope DATA needs this hook (or an equivalent) or its data
 * freezes when polling skips. Payload applies own sourceVersions/sourceVersion
 * and must never look like signals: the backend back-fills an `object` clock
 * into EVERY snapshot (service.go sourceVersion fill), so keying on
 * sourceVersions turned every fetch response into another "signal" — a
 * doubled (echo) fetch per doorbell, observed live.
 */

import type React from 'react';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

  // Doorbells bump the folded sourceVersion AND their clock entry in
  // signalVersions (bumpSourceVersionOnly does exactly this); payload
  // sourceVersions are untouched.
  const ringDoorbell = (version: string, scope = SCOPE) => {
    act(() => {
      setScopedDomainState('namespaces', scope, (previous) => ({
        ...previous,
        status: 'ready',
        data: { clusterId: 'cluster-a', namespaces: [] } as never,
        sourceVersion: version,
        signalVersions: { ...(previous.signalVersions ?? {}), object: version } as never,
        scope,
      }));
    });
  };

  // A payload apply REPLACES sourceVersions with the snapshot's map — which
  // ALWAYS carries an object clock (the backend back-fills it with the store
  // version watermark) — and never touches signalVersions.
  const applyPayload = (validator: string, scope = SCOPE) => {
    act(() => {
      setScopedDomainState('namespaces', scope, (previous) => ({
        ...previous,
        status: 'ready',
        data: { clusterId: 'cluster-a', namespaces: [] } as never,
        sourceVersion: validator,
        sourceVersions: {
          object: `watermark-${validator}`,
          workloads: `sig-${validator}`,
        } as never,
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

  it('keys on signalVersions — payload clock churn (incl. the back-filled object clock) must NOT refire', async () => {
    // Initial payload with back-filled object clock + validator.
    applyPayload('validator-1');
    render();
    await act(async () => undefined);

    // Another fetch applies: new validator, new back-filled object watermark,
    // new workloads signature. NOT a doorbell — no refetch (this was the echo:
    // every doorbell cost two fetches because the apply looked like a signal).
    applyPayload('validator-2');
    await act(async () => undefined);
    expect(requestRefreshDomainMock).not.toHaveBeenCalled();

    // The doorbell (signalVersions) advances: refetch.
    ringDoorbell('ns-4');
    await act(async () => undefined);
    expect(requestRefreshDomainMock).toHaveBeenCalledTimes(1);
  });

  it('refetches with reason stream-signal when the doorbell clock advances', async () => {
    // A pre-mount doorbell value is consumed WITHOUT a fetch: the data this
    // scope holds came from the fetch that observed it.
    ringDoorbell('ns-6');
    render();
    await act(async () => undefined);
    expect(requestRefreshDomainMock).not.toHaveBeenCalled();

    ringDoorbell('ns-7');
    await act(async () => undefined);
    expect(requestRefreshDomainMock).toHaveBeenCalledTimes(1);
    expect(requestRefreshDomainMock).toHaveBeenCalledWith({
      domain: 'namespaces',
      scope: SCOPE,
      reason: 'stream-signal',
    });
  });

  it('settles at ONE fetch per doorbell even though the apply back-fills an object clock', async () => {
    applyPayload('validator-1');
    render();
    await act(async () => undefined);

    // The doorbell's refetch applies a payload whose sourceVersions carry the
    // back-filled object watermark. signalVersions are untouched by applies,
    // so this is our fetch landing — settles at ONE, no echo.
    requestRefreshDomainMock.mockImplementationOnce(async () => {
      applyPayload('validator-2');
      return { status: 'executed' as const };
    });
    ringDoorbell('ns-7');
    await act(async () => undefined);
    await act(async () => undefined);
    await act(async () => undefined);
    expect(requestRefreshDomainMock).toHaveBeenCalledTimes(1);

    // Stable: nothing further fires.
    await act(async () => undefined);
    expect(requestRefreshDomainMock).toHaveBeenCalledTimes(1);

    // The NEXT real doorbell still fires.
    ringDoorbell('ns-8');
    await act(async () => undefined);
    expect(requestRefreshDomainMock).toHaveBeenCalledTimes(2);
  });

  it('ignores scopes it was not given and unchanged doorbell values', async () => {
    ringDoorbell('ns-1');
    render();
    await act(async () => undefined);

    // Unchanged doorbell value: nothing.
    ringDoorbell('ns-1');
    await act(async () => undefined);
    expect(requestRefreshDomainMock).not.toHaveBeenCalled();

    // A different scope's signal: nothing.
    ringDoorbell('ns-9', 'cluster-b|');
    await act(async () => undefined);
    expect(requestRefreshDomainMock).not.toHaveBeenCalled();
  });

  it('does nothing for domains without doorbell clocks', async () => {
    const Detail: React.FC = () => {
      useStreamSignalRefetch('object-details', [SCOPE]);
      return null;
    };
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    act(() => {
      root.render(<Detail />);
    });
    await act(async () => undefined);
    expect(requestRefreshDomainMock).not.toHaveBeenCalled();
  });
});
