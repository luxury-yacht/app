import type { ResourceGridTableRow } from '@modules/resource-grid/resourceGridTableTypes';
import {
  buildRequiredCanonicalObjectRowKey,
  buildRequiredObjectReference,
} from '@shared/utils/objectIdentity';
import type { CatalogItem, CustomResourceSummary, ResourceRef } from '@/core/refresh/types';

export type CatalogBackedCustomResourceRow = Omit<CustomResourceSummary, 'age' | 'clusterName'> &
  ResourceGridTableRow & {
    kindAlias?: string;
    clusterName?: string;
    resource?: string;
    age?: string;
    ageTimestamp?: number;
    creationTimestamp?: string;
  };

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
type RequiredResourceRef = ResourceRef & { resource: string; namespace: string; name: string };

const requiredResourceRef = (value: unknown): RequiredResourceRef => {
  const record = asRecord(value);
  return {
    clusterId: requiredString(record, 'clusterId'),
    group: requiredString(record, 'group'),
    version: requiredString(record, 'version'),
    kind: requiredString(record, 'kind'),
    resource: requiredString(record, 'resource'),
    namespace: requiredString(record, 'namespace'),
    name: requiredString(record, 'name'),
    uid: optionalString(record.uid),
  };
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
): string => buildRequiredCanonicalObjectRowKey(row.ref, { fallbackClusterId });

export const customCatalogObjectReference = (
  row: CatalogBackedCustomResourceRow,
  fallbackClusterId?: string | null,
  options?: { requiresExplicitVersion?: boolean }
) =>
  buildRequiredObjectReference(
    {
      ...row.ref,
      kindAlias: row.kindAlias,
      clusterName: row.clusterName,
    },
    { fallbackClusterId },
    {
      age: row.age,
      ageTimestamp: row.ageTimestamp,
      creationTimestamp: row.creationTimestamp,
      labels: row.labels,
      annotations: row.annotations,
      requiresExplicitVersion: options?.requiresExplicitVersion,
      explicitVersionProvided: Boolean(row.ref.version),
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
          explicitVersionProvided: Boolean(row.ref.version),
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
    ref: {
      clusterId: item.clusterId,
      group: item.group,
      version: item.version,
      kind: item.kind,
      resource: item.resource,
      namespace: item.namespace ?? '',
      name: item.name,
      uid: item.uid,
    },
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
  const ref = requiredResourceRef(record.ref);
  return {
    ref,
    kind: ref.kind,
    kindAlias: optionalString(record.kindAlias) ?? ref.kind,
    name: ref.name,
    namespace: ref.namespace,
    clusterId: ref.clusterId,
    clusterName: optionalString(record.clusterName),
    group: ref.group,
    version: ref.version,
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
