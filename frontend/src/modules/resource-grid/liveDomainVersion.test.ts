/**
 * `liveDomainVersion` is the live-data identity that the typed query watches to
 * decide when to refetch. It MUST change only when the data actually changes —
 * not on every poll tick — or the query refetches continuously (the Nodes
 * refetch storm that intermittently flashed "no data available").
 */
import { describe, expect, it } from 'vitest';

import { liveDomainVersion } from './useQueryBackedResourceGridTable';

describe('liveDomainVersion', () => {
  it('is stable when only the refresh timestamp changes (same data)', () => {
    const a = liveDomainVersion({ version: 7, checksum: 'abc', lastUpdated: 1000 });
    const b = liveDomainVersion({ version: 7, checksum: 'abc', lastUpdated: 2000 });
    expect(b).toBe(a);
  });

  it('is stable across lastAutoRefresh / lastManualRefresh churn', () => {
    const base = liveDomainVersion({ version: 7, checksum: 'abc' });
    expect(liveDomainVersion({ version: 7, checksum: 'abc', lastAutoRefresh: 5 })).toBe(base);
    expect(liveDomainVersion({ version: 7, checksum: 'abc', lastManualRefresh: 9 })).toBe(base);
  });

  it('changes when the data version changes', () => {
    expect(liveDomainVersion({ version: 7, checksum: 'abc' })).not.toBe(
      liveDomainVersion({ version: 8, checksum: 'abc' })
    );
  });

  it('changes when the checksum changes', () => {
    expect(liveDomainVersion({ version: 7, checksum: 'abc' })).not.toBe(
      liveDomainVersion({ version: 7, checksum: 'def' })
    );
  });

  it('falls back to etag when checksum is absent', () => {
    expect(liveDomainVersion({ version: 7, etag: 'e1' })).not.toBe(
      liveDomainVersion({ version: 7, etag: 'e2' })
    );
  });

  // Streamed row updates change the data without producing a new backend
  // snapshot version/checksum; the stream manager bumps streamRevision so the
  // typed query still refetches on real streamed changes.
  it('changes when the stream revision bumps (streamed row update, same snapshot)', () => {
    expect(liveDomainVersion({ version: 7, checksum: 'abc', streamRevision: 1 })).not.toBe(
      liveDomainVersion({ version: 7, checksum: 'abc' })
    );
    expect(liveDomainVersion({ version: 7, checksum: 'abc', streamRevision: 2 })).not.toBe(
      liveDomainVersion({ version: 7, checksum: 'abc', streamRevision: 1 })
    );
  });
});
