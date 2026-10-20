import { useRefreshScopedDomain } from '@core/refresh';
import { buildRefreshScope } from '@core/refresh/scopeSelector';
import type { CatalogItem } from '@core/refresh/types';
import { INACTIVE_SCOPE } from '@modules/object-panel/components/ObjectPanel/constants';
import { buildVersionedNamespacedRowKey } from '@shared/utils/resourceRowIdentity';
import { useEffect, useMemo, useState } from 'react';
import { useScopedRefreshDomainLifecycle } from '@/core/data-access';
import { failureMessage } from '@/core/refresh/refreshFailure';
import {
  buildIgnoredMetadataLineSet,
  maskMutedMetadataLines,
  sanitizeYamlForDiff,
} from './objectDiffUtils';

interface RetainedDiffYaml {
  key: string;
  yaml: string;
  checksum: string | null;
  changedAt: number | null;
}

const emptyDiffYaml = (key: string): RetainedDiffYaml => ({
  key,
  yaml: '',
  checksum: null,
  changedAt: null,
});

export const useObjectDiffYaml = (selection: CatalogItem | null, enabled: boolean) => {
  const scope = useMemo(() => {
    if (!enabled || !selection?.ref.clusterId || !selection.ref.kind || !selection.ref.name) {
      return null;
    }

    // CatalogItem carries the full GVK, so the backend object-yaml provider
    // resolves the GVR strictly. The scope matches the object panel's, so both
    // share one YAML cache entry.
    return buildRefreshScope('object-yaml', {
      clusterId: selection.ref.clusterId,
      selector: {
        kind: 'object',
        object: {
          namespace: selection.ref.namespace?.trim() ?? '',
          group: selection.ref.group,
          version: selection.ref.version,
          kind: selection.ref.kind,
          name: selection.ref.name,
        },
      },
    });
  }, [enabled, selection]);

  const effectiveScope = scope ?? INACTIVE_SCOPE;
  const state = useRefreshScopedDomain('object-yaml', effectiveScope);

  // The lease releases without preserving state: the YAML clears once no other
  // holder, such as an open YAML tab on the same object, still shows it.
  useScopedRefreshDomainLifecycle({
    domain: 'object-yaml',
    scope,
    enabled: Boolean(scope && enabled),
    fetchOnEnable: 'user',
  });

  const selectionKey = selection
    ? `${buildVersionedNamespacedRowKey(
        selection.ref.clusterId,
        selection.ref.namespace,
        selection.ref.group,
        selection.ref.version,
        selection.ref.kind,
        selection.ref.name
      )}::${selection.ref.uid ?? ''}`
    : '';
  const [retained, setRetained] = useState(() => emptyDiffYaml(''));
  const rawYaml = state.data?.yaml ?? '';
  const ready = state.status === 'ready';
  const checksum = state.checksum ?? null;

  // Retained content and change notifications belong to one complete object identity.
  useEffect(() => {
    setRetained((previous) => {
      const current = previous.key === selectionKey ? previous : emptyDiffYaml(selectionKey);
      const yaml = rawYaml.trim() || ready ? rawYaml : current.yaml;
      const previousChecksum = current.checksum;
      const changed = previousChecksum && checksum && previousChecksum !== checksum;
      return {
        key: selectionKey,
        yaml,
        checksum: checksum ?? previousChecksum,
        changedAt: changed ? Date.now() : current.changedAt,
      };
    });
  }, [rawYaml, ready, checksum, selectionKey]);

  const owned = retained?.key === selectionKey ? retained : null;
  const source = owned?.yaml || rawYaml;
  const normalized = useMemo(() => (source ? sanitizeYamlForDiff(source) : ''), [source]);
  const mutedLines = useMemo(() => buildIgnoredMetadataLineSet(normalized), [normalized]);
  const masked = useMemo(
    () => maskMutedMetadataLines(normalized, mutedLines),
    [normalized, mutedLines]
  );
  return {
    normalized,
    mutedLines,
    masked,
    changedAt: owned?.changedAt ?? null,
    error: failureMessage(state.error),
    initialLoading: state.status === 'loading' || state.status === 'initialising',
  };
};
