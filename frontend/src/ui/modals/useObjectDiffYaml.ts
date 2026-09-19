import { useEffect, useMemo, useState } from 'react';
import { useRefreshScopedDomain } from '@core/refresh';
import { buildClusterScope, buildObjectScope } from '@core/refresh/clusterScope';
import type { CatalogItem } from '@core/refresh/types';
import {
  CLUSTER_SCOPE,
  INACTIVE_SCOPE,
} from '@modules/object-panel/components/ObjectPanel/constants';
import { buildVersionedNamespacedRowKey } from '@shared/utils/resourceRowIdentity';
import {
  requestRefreshDomain,
  resetRefreshDomain,
  setRefreshDomainEnabled,
} from '@/core/data-access';
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

    // Use the cluster-scope token when the object has no namespace.
    const namespaceSegment = selection.ref.namespace?.trim() || CLUSTER_SCOPE;
    // CatalogItem already carries group/version from the backend catalog,
    // so the diff modal can always emit the GVK scope form. The backend
    // object-yaml provider will resolve the GVR strictly and avoid the
    // first-match-wins ambiguity that affects bare-kind scopes.
    const rawScope = buildObjectScope({
      namespace: namespaceSegment,
      group: selection.ref.group,
      version: selection.ref.version,
      kind: selection.ref.kind.toLowerCase(),
      name: selection.ref.name,
    });
    return buildClusterScope(selection.ref.clusterId, rawScope);
  }, [enabled, selection]);

  const effectiveScope = scope ?? INACTIVE_SCOPE;
  const state = useRefreshScopedDomain('object-yaml', effectiveScope);

  useEffect(() => {
    if (!scope || !enabled) {
      return;
    }

    setRefreshDomainEnabled({ domain: 'object-yaml', scope, enabled: true });
    void requestRefreshDomain({
      domain: 'object-yaml',
      scope,
      reason: 'user',
    });

    return () => {
      setRefreshDomainEnabled({ domain: 'object-yaml', scope, enabled: false });
      resetRefreshDomain('object-yaml', scope);
    };
  }, [enabled, scope]);

  const selectionKey = selection
    ? buildVersionedNamespacedRowKey(
        selection.ref.clusterId,
        selection.ref.namespace,
        selection.ref.group,
        selection.ref.version,
        selection.ref.kind,
        selection.ref.name
      ) + `::${selection.ref.uid ?? ''}`
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
    error: state.error ?? null,
    initialLoading: state.status === 'loading' || state.status === 'initialising',
  };
};
