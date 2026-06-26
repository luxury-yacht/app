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
    const a = liveDomainVersion({ sourceVersion: 'source:1', lastUpdated: 1000 });
    const b = liveDomainVersion({ sourceVersion: 'source:1', lastUpdated: 2000 });
    expect(b).toBe(a);
  });

  it('is stable across lastAutoRefresh / lastManualRefresh churn', () => {
    const base = liveDomainVersion({ sourceVersion: 'source:1' });
    expect(liveDomainVersion({ sourceVersion: 'source:1', lastAutoRefresh: 5 })).toBe(base);
    expect(liveDomainVersion({ sourceVersion: 'source:1', lastManualRefresh: 9 })).toBe(base);
  });

  it('changes when the source version changes', () => {
    expect(liveDomainVersion({ sourceVersion: 'object:7' })).not.toBe(
      liveDomainVersion({ sourceVersion: 'object:8' })
    );
  });

  it('ignores legacy version/checksum/etag/streamRevision components', () => {
    const source = liveDomainVersion({
      sourceVersion: 'source:1',
      version: 7,
      checksum: 'abc',
      etag: 'etag-a',
      streamRevision: 1,
    });
    expect(
      liveDomainVersion({
        sourceVersion: 'source:1',
        version: 8,
        checksum: 'def',
        etag: 'etag-b',
        streamRevision: 2,
      })
    ).toBe(source);
  });

  it('falls back to etag only when sourceVersion is absent', () => {
    expect(liveDomainVersion({ etag: 'e1' })).not.toBe(liveDomainVersion({ etag: 'e2' }));
    expect(liveDomainVersion({ sourceVersion: 'source:1', etag: 'e1' })).toBe(
      liveDomainVersion({ sourceVersion: 'source:1', etag: 'e2' })
    );
  });
});
