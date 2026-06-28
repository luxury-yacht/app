/**
 * frontend/src/core/data-access/readers.ts
 *
 * Typed frontend wrappers around Wails backend read methods. Object-scoped
 * readers accept ref-shaped targets so cluster/GVK/name identity travels as a
 * single contract instead of positional string lists.
 */

import {
  DiscoverNodeLogs,
  SaveCsvFile,
  FetchContainerLogs,
  FetchNodeLogs,
  FindCatalogObjectByUID,
  FindCatalogObjectMatch,
  GetContainerLogsScopeContainers,
  GetObjectYAMLByGVK,
  GetPodContainers,
  GetRevisionHistory,
  GetTargetPorts,
  HydrateCatalogCustomRows,
  IsWorkloadHPAManaged,
} from '@wailsjs/go/backend/App';
import type { types } from '@wailsjs/go/models';

export interface ObjectReadTarget {
  clusterId: string;
  namespace?: string | null;
  group: string;
  version: string;
  kind: string;
  name: string;
}

export interface ObjectYAMLReadTarget {
  clusterId: string;
  apiVersion?: string | null;
  group?: string | null;
  version?: string | null;
  kind: string;
  namespace?: string | null;
  name: string;
}

const namespaceOrEmpty = (namespace: string | null | undefined): string => namespace ?? '';

const apiVersionForTarget = (target: ObjectYAMLReadTarget): string => {
  const apiVersion = target.apiVersion?.trim();
  if (apiVersion) {
    return apiVersion;
  }
  const version = target.version?.trim();
  if (!version) {
    throw new Error(`Object identity for ${target.kind}/${target.name} is missing version`);
  }
  const group = target.group?.trim();
  return group ? `${group}/${version}` : version;
};

export const readTargetPortsForRef = (target: ObjectReadTarget) =>
  GetTargetPorts(
    target.clusterId,
    namespaceOrEmpty(target.namespace),
    target.kind,
    target.group,
    target.version,
    target.name
  );

export const readPodContainers = (clusterId: string, namespace: string, resourceName: string) =>
  GetPodContainers(clusterId, namespace, resourceName);

export const readContainerLogsScopeContainers = (clusterId: string, scope: string) =>
  GetContainerLogsScopeContainers(clusterId, scope);

export const readContainerLogs = (clusterId: string, request: types.ContainerLogsFetchRequest) =>
  FetchContainerLogs(clusterId, request);

export const readNodeLogDiscovery = (clusterId: string, nodeName: string) =>
  DiscoverNodeLogs(clusterId, nodeName);

export const readNodeLogs = (
  clusterId: string,
  nodeName: string,
  request: types.NodeLogFetchRequest
) => FetchNodeLogs(clusterId, nodeName, request);

export const readObjectYAMLForRef = (target: ObjectYAMLReadTarget) =>
  GetObjectYAMLByGVK(
    target.clusterId,
    apiVersionForTarget(target),
    target.kind,
    namespaceOrEmpty(target.namespace),
    target.name
  );

export const readCatalogObjectMatchForRef = (
  target: ObjectReadTarget,
  options?: { clusterId?: string | null }
) =>
  FindCatalogObjectMatch(
    options?.clusterId?.trim() || target.clusterId,
    namespaceOrEmpty(target.namespace),
    target.group,
    target.version,
    target.kind,
    target.name
  );

export const readCatalogObjectByUID = (clusterId: string, uid: string) =>
  FindCatalogObjectByUID(clusterId, uid);

export interface CatalogQueryCSVExport {
  path: string;
  bytes: number;
}

/** Save a frontend-built CSV string to a user-selected file (returns the chosen path). */
export const saveCsvFile = (defaultFilename: string, content: string) =>
  SaveCsvFile(defaultFilename, content) as Promise<CatalogQueryCSVExport>;

export interface CustomCatalogHydrationRow {
  clusterId: string;
  group: string;
  version: string;
  kind: string;
  resource: string;
  namespace?: string;
  name: string;
  uid?: string;
}

export const readHydratedCustomCatalogRows = (
  clusterId: string,
  rows: CustomCatalogHydrationRow[]
) => HydrateCatalogCustomRows(clusterId, rows);

export const readRevisionHistoryForRef = (target: ObjectReadTarget) =>
  GetRevisionHistory(
    target.clusterId,
    namespaceOrEmpty(target.namespace),
    target.group,
    target.version,
    target.kind,
    target.name
  );

export const readWorkloadHPAManagedForRef = (target: ObjectReadTarget) =>
  IsWorkloadHPAManaged(
    target.clusterId,
    namespaceOrEmpty(target.namespace),
    target.group,
    target.version,
    target.kind,
    target.name
  );

export const readQueryPermissions = async <T>(queries: unknown[]): Promise<T> => {
  const runtimeApp = (window as any)?.go?.backend?.App;
  if (typeof runtimeApp?.QueryPermissions !== 'function') {
    throw new Error('QueryPermissions unavailable');
  }
  return runtimeApp.QueryPermissions(queries) as Promise<T>;
};
