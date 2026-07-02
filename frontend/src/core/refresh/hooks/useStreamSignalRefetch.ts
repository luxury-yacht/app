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
 * (contract sourceClocks) inside sourceVersions, NEVER the folded
 * sourceVersion. Payload applies rewrite sourceVersion (and stamp their own
 * clock values) on every build, so keying on those turns each fetch response
 * into another "signal" and loops — observed live as a fetch storm during
 * cluster warm-up, when the namespaces payload changes on every settling
 * build. Doorbell clock values only move when a doorbell delivers them, so
 * the key is quiet between real signals. The first observed key per scope is
 * consumed without fetching (the scope's data came from the fetch that
 * produced it), and a payload apply that clears the doorbell clocks is our
 * own fetch landing, not a new signal.
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
      const sourceVersions = domainStates[scope]?.sourceVersions;
      const key = clocks.map((clock) => clock + ':' + (sourceVersions?.[clock] ?? '')).join(' ');
      const hasSignal = clocks.some((clock) => Boolean(sourceVersions?.[clock]));
      const consumed = consumedKeysRef.current;
      if (!consumed.has(scope)) {
        // First observation: whatever clock values exist arrived with the data
        // this scope already holds — fresh by construction.
        consumed.set(scope, key);
        return;
      }
      if (consumed.get(scope) === key) {
        return;
      }
      consumed.set(scope, key);
      if (!hasSignal) {
        // The payload apply cleared the doorbell clocks (its own map carries
        // none): that is our fetch landing, not a new signal.
        return;
      }
      void requestRefreshDomain({ domain, scope, reason: 'stream-signal' });
    });
  }, [domainStates, scopes, domain]);
};
