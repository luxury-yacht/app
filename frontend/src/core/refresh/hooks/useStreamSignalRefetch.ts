/**
 * frontend/src/core/refresh/hooks/useStreamSignalRefetch.ts
 *
 * Shared refetch-on-signal hook for consumers that read a stream-domain
 * scope's DATA from the store. Doorbells/change signals only advance the
 * scoped sourceVersion — they never fetch — and while a stream is healthy the
 * refresher skips its polls. Any data reader without this hook (or an
 * equivalent, like the query-backed tables' liveDataVersion identity) freezes.
 *
 * The refetch uses reason 'stream-signal', the one non-manual reason the
 * skip-while-stream-healthy gate never swallows (the signal IS the stream
 * announcing changed data). Auto-refresh pause still applies.
 *
 * Loop safety: the hook keys on the domain's DECLARED doorbell clocks
 * (contract sourceClocks) inside signalVersions — the field ONLY the stream
 * manager's doorbell path writes — NEVER the folded sourceVersion and NEVER
 * sourceVersions. Payload applies rewrite both of those on every fetch (the
 * backend back-fills an object clock into every snapshot), so keying on them
 * turned each fetch response into another "signal": a fetch storm during
 * cluster warm-up and a doubled (echo) fetch per doorbell in steady state —
 * both observed live. signalVersions moves exactly when a doorbell delivers
 * it, so the key is quiet between real signals. The first observed key per
 * scope is consumed without fetching (the scope's data was fetched at or
 * after those doorbells).
 */

import { useEffect, useRef } from 'react';

import { requestRefreshDomain } from '@/core/data-access';
import { doorbellSourceClocks } from '../streaming/resourceStreamDomains';
import { useRefreshScopedDomainStates } from '../store';
import type { RefreshDomain } from '../types';

export const useStreamSignalRefetch = (domain: RefreshDomain, scopes: readonly string[]): void => {
  const domainStates = useRefreshScopedDomainStates(domain);
  const consumedKeysRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    const clocks = doorbellSourceClocks(domain);
    if (clocks.length === 0) {
      return;
    }
    scopes.forEach((scope) => {
      if (!scope) {
        return;
      }
      // signalVersions is written ONLY by the stream manager's doorbell path;
      // payload applies never touch it. Keying on it (never sourceVersions,
      // which the backend back-fills with an object clock on EVERY snapshot)
      // is what makes a fetch response invisible here — no echo refetch.
      const signalVersions = domainStates[scope]?.signalVersions;
      const key = clocks.map((clock) => clock + ':' + (signalVersions?.[clock] ?? '')).join(' ');
      const hasSignal = clocks.some((clock) => Boolean(signalVersions?.[clock]));
      const consumed = consumedKeysRef.current;
      if (!consumed.has(scope)) {
        // First observation: whatever doorbell values exist arrived before
        // this consumer mounted — the data it reads was fetched at or after
        // them, fresh by construction.
        consumed.set(scope, key);
        return;
      }
      if (consumed.get(scope) === key || !hasSignal) {
        return;
      }
      consumed.set(scope, key);
      void requestRefreshDomain({ domain, scope, reason: 'stream-signal' });
    });
  }, [domainStates, scopes, domain]);
};
