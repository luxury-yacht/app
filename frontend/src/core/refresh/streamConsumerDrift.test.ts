/**
 * frontend/src/core/refresh/streamConsumerDrift.test.ts
 *
 * Drift guard for the frozen-data-reader bug class: streams only SIGNAL (they
 * advance the scoped sourceVersion, never fetch) and healthy streams skip the
 * poll, so any component that reads a stream-class domain's store data without
 * a signal-driven refetch freezes at its first load. This was found live three
 * times while landing the doorbell work (useResourceMetrics, NamespaceContext,
 * useBrowseCatalog) — see .agents/skills/refresh-subsystem/SKILL.md §8a.
 *
 * The guard scans every non-test source file that calls
 * useRefreshScopedDomain with a LITERAL stream-class domain and requires the
 * same file to wire one of the known refetch mechanisms:
 *   - useStreamSignalRefetch (the shared hook), or
 *   - liveDomainVersion / liveDataVersion (the query-backed tables' refetch
 *     identity).
 * Domain-variable call sites (generic helpers) can't be checked textually;
 * they are covered by the guards on their literal-domain callers.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

import { refreshDomainContract } from './domainRegistry';

// Domains whose data arrives via a stream class: polling is paused while the
// stream is healthy, so store-readers need a signal-driven refetch.
const STREAM_CLASS_ORCHESTRATORS = new Set([
  'resource-stream',
  'doorbell-snapshot',
  'event-stream',
  'catalog-stream',
]);

const streamClassDomains = refreshDomainContract.domains
  .filter((entry) => STREAM_CLASS_ORCHESTRATORS.has(entry.frontend.orchestrator))
  .map((entry) => entry.domain);

const REFETCH_MARKERS = ['useStreamSignalRefetch', 'liveDomainVersion', 'liveDataVersion'];

// The refresh infrastructure itself (store, orchestrator, streaming managers,
// diagnostics) reads domain state to IMPLEMENT the mechanisms, not to consume
// data; it is exempt by directory.
const EXEMPT_PATH_PREFIXES = ['src/core/refresh/'];

// Consciously-exempt readers. Every entry needs a reason; an empty reason is a
// bug. Prefer wiring useStreamSignalRefetch over adding entries here.
const EXEMPT_FILES = new Map<string, string>([]);

type StreamReaderViolation = {
  path: string;
  domains: string[];
};

const findUnguardedStreamReaders = (
  files: Array<{ path: string; content: string }>,
  domains: readonly string[] = streamClassDomains
): StreamReaderViolation[] => {
  const violations: StreamReaderViolation[] = [];
  for (const file of files) {
    if (EXEMPT_PATH_PREFIXES.some((prefix) => file.path.startsWith(prefix))) {
      continue;
    }
    if (EXEMPT_FILES.has(file.path)) {
      continue;
    }
    const offending = domains.filter((domain) =>
      new RegExp(`useRefreshScopedDomain(?:States)?\\(\\s*['"\`]${domain}['"\`]`).test(file.content)
    );
    if (offending.length === 0) {
      continue;
    }
    if (REFETCH_MARKERS.some((marker) => file.content.includes(marker))) {
      continue;
    }
    violations.push({ path: file.path, domains: offending });
  }
  return violations;
};

const collectSourceFiles = (root: string): Array<{ path: string; content: string }> => {
  const out: Array<{ path: string; content: string }> = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      const stats = statSync(full);
      if (stats.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(name) || /\.test\.(ts|tsx)$/.test(name)) {
        continue;
      }
      out.push({
        path: relative(process.cwd(), full).replace(/\\/g, '/'),
        content: readFileSync(full, 'utf8'),
      });
    }
  };
  walk(root);
  return out;
};

describe('stream-consumer drift guard', () => {
  it('detects a literal stream-domain reader with no refetch mechanism', () => {
    const violations = findUnguardedStreamReaders(
      [
        {
          path: 'src/modules/example/Frozen.tsx',
          content: "const state = useRefreshScopedDomain('pods', scope); return state.data;",
        },
      ],
      ['pods']
    );
    expect(violations).toEqual([{ path: 'src/modules/example/Frozen.tsx', domains: ['pods'] }]);
  });

  it('accepts a reader wired to useStreamSignalRefetch or the query refetch identity', () => {
    expect(
      findUnguardedStreamReaders(
        [
          {
            path: 'src/modules/example/Guarded.tsx',
            content:
              "useStreamSignalRefetch('pods', scopes); const state = useRefreshScopedDomain('pods', scope);",
          },
          {
            path: 'src/modules/example/QueryBacked.tsx',
            content:
              "const liveDataVersion = liveDomainVersion(useRefreshScopedDomain('pods', scope));",
          },
        ],
        ['pods']
      )
    ).toEqual([]);
  });

  it('ignores plain snapshot domains — polling still refreshes them', () => {
    expect(
      findUnguardedStreamReaders(
        [
          {
            path: 'src/modules/example/Detail.tsx',
            content: "const state = useRefreshScopedDomain('object-details', scope);",
          },
        ],
        streamClassDomains
      )
    ).toEqual([]);
  });

  it('finds no unguarded stream-domain readers in the source tree', () => {
    const files = collectSourceFiles(join(process.cwd(), 'src'));
    // Sanity: the scan actually saw the known guarded consumers, so an empty
    // violations list means "checked and clean", not "matched nothing".
    const scannedPaths = files.map((file) => file.path);
    expect(scannedPaths).toContain('src/modules/namespace/contexts/NamespaceContext.tsx');
    expect(scannedPaths).toContain(
      'src/modules/object-panel/components/ObjectPanel/Events/EventsTab.tsx'
    );

    expect(findUnguardedStreamReaders(files)).toEqual([]);
  });
});
