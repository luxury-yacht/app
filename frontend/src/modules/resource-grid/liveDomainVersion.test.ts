/**
 * `liveDomainVersion` is the live-data identity that the typed query watches to
 * decide when to refetch. It MUST change only when a DOORBELL delivers a new
 * clock value — not on poll ticks, not on payload applies — or the query
 * refetches continuously (the Nodes refetch storm that intermittently flashed
 * "no data available") or echoes a 304 refetch every time a sibling consumer's
 * fetch of the same base scope rewrites the folded sourceVersion (observed
 * live as 0-byte 304s trailing every metric-tick 200 pair).
 *
 * Doorbell-clock domains (e.g. nodes: object+metric) key on signalVersions —
 * written ONLY by the stream manager. Domains without doorbell clocks (plain
 * snapshot domains, e.g. object-details) keep the folded sourceVersion token.
 */
import { describe, expect, it } from 'vitest';

import { liveDomainVersion } from './useQueryBackedResourceGridTable';

describe('liveDomainVersion', () => {
  it('is stable when only the refresh timestamp changes (same data)', () => {
    const a = liveDomainVersion('nodes', {
      signalVersions: { object: 'node-1' },
      lastUpdated: 1000,
    });
    const b = liveDomainVersion('nodes', {
      signalVersions: { object: 'node-1' },
      lastUpdated: 2000,
    });
    expect(b).toBe(a);
  });

  it('is stable across lastAutoRefresh / lastManualRefresh churn', () => {
    const base = liveDomainVersion('nodes', { signalVersions: { object: 'node-1' } });
    expect(
      liveDomainVersion('nodes', { signalVersions: { object: 'node-1' }, lastAutoRefresh: 5 })
    ).toBe(base);
    expect(
      liveDomainVersion('nodes', { signalVersions: { object: 'node-1' }, lastManualRefresh: 9 })
    ).toBe(base);
  });

  it('changes when a doorbell clock changes', () => {
    expect(liveDomainVersion('nodes', { signalVersions: { object: 'node-7' } })).not.toBe(
      liveDomainVersion('nodes', { signalVersions: { object: 'node-8' } })
    );
    expect(liveDomainVersion('nodes', { signalVersions: { metric: '100' } })).not.toBe(
      liveDomainVersion('nodes', { signalVersions: { metric: '200' } })
    );
  });

  it('is stable when a payload apply rewrites the folded sourceVersion (no echo)', () => {
    // Applies rewrite sourceVersion/sourceVersions on every fetch (the backend
    // back-fills an object clock into every snapshot) but never signalVersions.
    const beforeApply = liveDomainVersion('nodes', {
      sourceVersion: 'doorbell-1',
      signalVersions: { object: 'doorbell-1' },
    });
    const afterApply = liveDomainVersion('nodes', {
      sourceVersion: 'validator-from-apply',
      signalVersions: { object: 'doorbell-1' },
    });
    expect(afterApply).toBe(beforeApply);
  });

  it('ignores legacy version/checksum/etag/streamRevision components', () => {
    const source = liveDomainVersion('nodes', {
      signalVersions: { object: 'node-1' },
      version: 7,
      checksum: 'abc',
      etag: 'etag-a',
      streamRevision: 1,
    });
    expect(
      liveDomainVersion('nodes', {
        signalVersions: { object: 'node-1' },
        version: 8,
        checksum: 'def',
        etag: 'etag-b',
        streamRevision: 2,
      })
    ).toBe(source);
  });

  it('keeps the folded token for domains without doorbell clocks', () => {
    expect(liveDomainVersion('object-details', { sourceVersion: 'v1' })).not.toBe(
      liveDomainVersion('object-details', { sourceVersion: 'v2' })
    );
    expect(liveDomainVersion('object-details', { etag: 'e1' })).not.toBe(
      liveDomainVersion('object-details', { etag: 'e2' })
    );
    expect(liveDomainVersion('object-details', { sourceVersion: 'v1', etag: 'e1' })).toBe(
      liveDomainVersion('object-details', { sourceVersion: 'v1', etag: 'e2' })
    );
  });
});
