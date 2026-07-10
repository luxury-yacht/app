import type { ResourceGridTableRow } from '@modules/resource-grid/resourceGridTableTypes';
import {
  buildRequiredCanonicalObjectRowKey,
  buildRequiredObjectReference,
} from '@shared/utils/objectIdentity';
import type { CatalogItem } from '@/core/refresh/types';

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

const asRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
const optionalString = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;
const requiredString = (record: Record<string, unknown>, field: string): string => {
  const value = optionalString(record[field]);
  if (value === undefined) {
    throw new Error(`Hydrated catalog row is missing string field "${field}".`);
  }
  return value;
};
const optionalNumber = (value: unknown): number | undefined =>
  typeof value === 'number' ? value : undefined;
const optionalBoolean = (value: unknown): boolean | undefined =>
  typeof value === 'boolean' ? value : undefined;
const optionalStringRecord = (value: unknown): Record<string, string> | undefined => {
  const record = asRecord(value);
  return Object.values(record).every((entry) => typeof entry === 'string')
    ? (record as Record<string, string>)
    : undefined;
};

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

export const normalizeHydratedCustomRow = (row: unknown): CatalogBackedCustomResourceRow => {
  const record = asRecord(row);
  const kind = requiredString(record, 'kind');
  const group = requiredString(record, 'group');
  const version = requiredString(record, 'version');
  return {
    kind,
    kindAlias: optionalString(record.kindAlias) ?? kind,
    name: requiredString(record, 'name'),
    namespace: optionalString(record.namespace) ?? '',
    clusterId: requiredString(record, 'clusterId'),
    clusterName: optionalString(record.clusterName),
    group,
    version,
    resource: optionalString(record.resource) ?? '',
    crdName: optionalString(record.crdName),
    status: optionalString(record.status),
    statusState: optionalString(record.statusState),
    statusPresentation: optionalString(record.statusPresentation),
    ready: optionalBoolean(record.ready),
    observedGeneration: optionalNumber(record.observedGeneration),
    conditions: Array.isArray(record.conditions)
      ? (record.conditions as CatalogBackedCustomResourceRow['conditions'])
      : undefined,
    age: optionalString(record.age),
    ageTimestamp: optionalNumber(record.ageTimestamp),
    creationTimestamp: optionalString(record.creationTimestamp),
    labels: optionalStringRecord(record.labels),
    annotations: optionalStringRecord(record.annotations),
  };
};
