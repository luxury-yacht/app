import type { CatalogItem } from '@/core/refresh/types';
import type { ResourceGridTableRow } from '@modules/resource-grid/resourceGridTableTypes';
import {
  buildRequiredCanonicalObjectRowKey,
  buildRequiredObjectReference,
} from '@shared/utils/objectIdentity';

export interface CatalogBackedCustomResourceRow extends ResourceGridTableRow {
  kind: string;
  kindAlias?: string;
  name: string;
  namespace: string;
  clusterId: string;
  clusterName?: string;
  group?: string;
  version?: string;
  resource?: string;
  crdName?: string;
  status?: string;
  statusState?: string;
  statusPresentation?: string;
  ready?: boolean;
  observedGeneration?: number;
  conditions?: Array<{
    type: string;
    status: string;
    reason?: string;
    message?: string;
  }>;
  age?: string;
  ageTimestamp?: number;
  creationTimestamp?: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
}

const canonicalGroup = (row: CatalogBackedCustomResourceRow): string => row.group || '';
const canonicalVersion = (row: CatalogBackedCustomResourceRow): string => row.version || '';

export const customCatalogRowKey = (
  row: CatalogBackedCustomResourceRow,
  fallbackClusterId?: string | null
): string =>
  buildRequiredCanonicalObjectRowKey(
    {
      kind: row.kind,
      name: row.name,
      namespace: row.namespace,
      clusterId: row.clusterId,
      group: canonicalGroup(row),
      version: canonicalVersion(row),
    },
    { fallbackClusterId }
  );

export const customCatalogObjectReference = (
  row: CatalogBackedCustomResourceRow,
  fallbackClusterId?: string | null,
  options?: { requiresExplicitVersion?: boolean }
) =>
  buildRequiredObjectReference(
    {
      kind: row.kind,
      kindAlias: row.kindAlias,
      name: row.name,
      namespace: row.namespace,
      clusterId: row.clusterId,
      clusterName: row.clusterName,
      group: canonicalGroup(row),
      version: canonicalVersion(row),
      resource: row.resource,
    },
    { fallbackClusterId },
    {
      age: row.age,
      ageTimestamp: row.ageTimestamp,
      creationTimestamp: row.creationTimestamp,
      labels: row.labels,
      annotations: row.annotations,
      requiresExplicitVersion: options?.requiresExplicitVersion,
      explicitVersionProvided: Boolean(canonicalVersion(row)),
    }
  );

export const customCatalogCRDReference = (
  row: CatalogBackedCustomResourceRow,
  fallbackClusterId?: string | null,
  options?: { includeRowMetadata?: boolean }
) => {
  if (!row.crdName) {
    return null;
  }
  return buildRequiredObjectReference(
    {
      kind: 'CustomResourceDefinition',
      name: row.crdName,
      clusterId: row.clusterId,
      clusterName: row.clusterName,
    },
    { fallbackClusterId },
    options?.includeRowMetadata
      ? {
          age: row.age,
          labels: row.labels,
          annotations: row.annotations,
          requiresExplicitVersion: true,
          explicitVersionProvided: Boolean(canonicalVersion(row)),
        }
      : undefined
  );
};

export const catalogItemToFallbackCustomRow = (
  item: CatalogItem
): CatalogBackedCustomResourceRow => {
  const created = item.creationTimestamp ? new Date(item.creationTimestamp) : undefined;
  const ageTimestamp = created && !Number.isNaN(created.getTime()) ? created.getTime() : undefined;
  return {
    kind: item.kind,
    kindAlias: item.kind,
    name: item.name,
    namespace: item.namespace ?? '',
    clusterId: item.clusterId,
    clusterName: item.clusterName,
    group: item.group,
    version: item.version,
    resource: item.resource,
    crdName: item.group ? `${item.resource}.${item.group}` : item.resource,
    status: item.actionFacts?.status,
    statusPresentation: item.actionFacts?.status,
    ageTimestamp,
    creationTimestamp: item.creationTimestamp,
  };
};

export const normalizeHydratedCustomRow = (row: any): CatalogBackedCustomResourceRow => {
  const group = row.group ?? '';
  const version = row.version ?? '';
  return {
    kind: row.kind,
    kindAlias: row.kindAlias ?? row.kind,
    name: row.name,
    namespace: row.namespace ?? '',
    clusterId: row.clusterId,
    clusterName: row.clusterName,
    group,
    version,
    resource: row.resource ?? '',
    crdName: row.crdName,
    status: row.status,
    statusState: row.statusState,
    statusPresentation: row.statusPresentation,
    ready: row.ready,
    observedGeneration: row.observedGeneration,
    conditions: row.conditions,
    age: row.age,
    ageTimestamp: row.ageTimestamp,
    creationTimestamp: row.creationTimestamp,
    labels: row.labels,
    annotations: row.annotations,
  };
};
