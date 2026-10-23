/**
 * frontend/src/shared/kinds/kindFacets.ts
 *
 * The one per-kind table: the backend-generated rows for every registered kind
 * plus the synthetic Helm release. Behavior (tabs, logs/shell/metrics sources,
 * object-map support, actions) is looked up by complete identity; only display
 * names and list navigation are looked up by group and kind.
 */

import { GENERATED_KIND_FACETS, type KindFacetsSchema } from './kindFacets.generated';

export type { KindMetricsDomain, KindPanelLogs, KindPanelShell } from './kindFacets.generated';

/** The Helm release identity the backend's Helm path serves (not a Kubernetes kind). */
export const HELM_RELEASE_GVK = { group: 'helm.sh', version: 'v3', kind: 'HelmRelease' } as const;

// Synthetic rows are checked against the same schema as the generated ones; the
// combined table below keeps their literal types for the facet-gated mapped types.
const SYNTHETIC_KIND_FACETS = [
  {
    group: HELM_RELEASE_GVK.group,
    versions: [HELM_RELEASE_GVK.version],
    kind: HELM_RELEASE_GVK.kind,
    resource: 'helmreleases',
    namespaced: true,
    detailType: 'helmrelease',
    detailListsPods: false,
    // Its map holds the objects in its manifest.
    objectMap: true,
    panel: {
      pods: 'none',
      jobs: false,
      logs: 'none',
      shell: 'none',
      debugContainer: false,
      eventsTab: false,
      yamlTab: false,
    },
    metricsDomain: 'none',
    listDomain: 'namespace-helm',
    display: { shortName: 'helm', label: HELM_RELEASE_GVK.kind, searchAliases: [] },
    actions: {
      restart: false,
      rollback: false,
      scale: false,
      portForward: false,
      reconnect: false,
      usesServicePortSpec: false,
      trigger: false,
      suspend: false,
      cordon: false,
      drain: false,
      removeNamespaceFinalizer: false,
    },
  },
] as const satisfies readonly KindFacetsSchema[];

export const KIND_FACETS = [...GENERATED_KIND_FACETS, ...SYNTHETIC_KIND_FACETS] as const;

export type KindFacets = (typeof KIND_FACETS)[number];
/** Detail types whose kind's facets match `P`; accessor tables map over these. */
export type DetailTypesWhere<P> = Extract<KindFacets, P>['detailType'];

export interface KindIdentity {
  group?: string | null;
  version?: string | null;
  kind?: string | null;
}

const groupKindKey = (group: string, kind: string): string =>
  `${group.trim()}/${kind.trim().toLowerCase()}`;

const facetsByGroupKind = new Map<string, KindFacets>(
  KIND_FACETS.map((row) => [groupKindKey(row.group, row.kind), row])
);

const facetsByKindName = new Map<string, KindFacets>(
  KIND_FACETS.map((row) => [row.kind.toLowerCase(), row])
);

/**
 * Facets for behavior decisions: the exact group, a served version, and the kind
 * in any case. Returns null for an incomplete identity, a custom resource that
 * shares a built-in kind name, or a version the backend does not serve for it.
 */
export const lookupKindFacets = (identity: KindIdentity | null | undefined): KindFacets | null => {
  const kind = identity?.kind?.trim();
  const version = identity?.version?.trim();
  const group = identity?.group;
  if (!kind || !version || group === null || group === undefined) {
    return null;
  }
  const row = facetsByGroupKind.get(groupKindKey(group, kind));
  return row && (row.versions as readonly string[]).includes(version) ? row : null;
};

/**
 * Facets for display names and list navigation only, which do not depend on the
 * version: the exact group and the kind in any case.
 */
export const lookupKindMetadata = (
  identity: Pick<KindIdentity, 'group' | 'kind'> | null | undefined
): KindFacets | null => {
  const kind = identity?.kind?.trim();
  const group = identity?.group;
  if (!kind || group === null || group === undefined) {
    return null;
  }
  return facetsByGroupKind.get(groupKindKey(group, kind)) ?? null;
};

/**
 * The built-in row for a bare kind name. Only for surfaces keyed by the kind name
 * itself (kind-name filters and search); built-in kind names are distinct.
 */
export const lookupKindByName = (kind: string | null | undefined): KindFacets | null => {
  const name = kind?.trim().toLowerCase();
  return name ? (facetsByKindName.get(name) ?? null) : null;
};
