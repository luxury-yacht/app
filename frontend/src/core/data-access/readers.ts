/**
 * frontend/src/core/data-access/readers.ts
 *
 * Typed frontend wrappers around Wails backend read methods. Object-scoped
 * readers accept ref-shaped targets so cluster/GVK/name identity travels as a
 * single contract instead of positional string lists.
 */

import type { capabilities, types } from '@core/backend-api/models';
import { parseApiVersion } from '@shared/constants/builtinGroupVersions';
import {
  DiscoverNodeLogs,
  FetchContainerLogs,
  FetchNodeLogs,
  FindCatalogObjectByUID,
  FindCatalogObjectMatch,
  GetContainerLogsScopeContainers,
  GetObjectYAMLByGVK,
  GetPanelMetricSeries,
  GetPodContainers,
  GetRevisionHistory,
  GetTargetPorts,
  HydrateCatalogCustomRows,
  IsWorkloadHPAManaged,
  QueryPermissions,
  SaveCsvFile,
  SaveLogFile,
} from '@/core/backend-api';
import { desktopRuntimeAvailable } from '@/core/desktop-runtime';

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

// The backend reference for an object read target: one complete identity.
const resourceRefForTarget = (target: ObjectReadTarget) => ({
  clusterId: target.clusterId,
  group: target.group,
  version: target.version,
  kind: target.kind,
  namespace: namespaceOrEmpty(target.namespace),
  name: target.name,
});

// YAML targets may carry a wire apiVersion instead of group and version.
const groupVersionForTarget = (
  target: ObjectYAMLReadTarget
): { group: string; version: string } => {
  const parsed = parseApiVersion(target.apiVersion);
  const version = (parsed.version ?? target.version)?.trim();
  if (!version) {
    throw new Error(`Object identity for ${target.kind}/${target.name} is missing version`);
  }
  const group = (parsed.version ? parsed.group : target.group)?.trim() ?? '';
  return { group, version };
};

export const readTargetPortsForRef = (target: ObjectReadTarget) =>
  GetTargetPorts(resourceRefForTarget(target));

/** An object panel's metric samples newer than afterT (unix ms), from the backend panel buffer. */
export const readPanelMetricSeries = (clusterId: string, panelId: string, afterT: number) =>
  GetPanelMetricSeries(clusterId, panelId, afterT);

export const readPodContainers = (target: ObjectReadTarget) =>
  GetPodContainers(resourceRefForTarget(target));

export const readContainerLogsScopeContainers = (clusterId: string, scope: string) =>
  GetContainerLogsScopeContainers(clusterId, scope);

export const readContainerLogs = (clusterId: string, request: types.ContainerLogsFetchRequest) =>
  FetchContainerLogs(clusterId, request);

export const readNodeLogDiscovery = (target: ObjectReadTarget) =>
  DiscoverNodeLogs(resourceRefForTarget(target));

export const readNodeLogs = (target: ObjectReadTarget, request: types.NodeLogFetchRequest) =>
  FetchNodeLogs(resourceRefForTarget(target), request);

export const readObjectYAMLForRef = (target: ObjectYAMLReadTarget) =>
  GetObjectYAMLByGVK(resourceRefForTarget({ ...target, ...groupVersionForTarget(target) }));

export const readCatalogObjectMatchForRef = (target: ObjectReadTarget) =>
  FindCatalogObjectMatch(resourceRefForTarget(target));

export const readCatalogObjectByUID = (clusterId: string, uid: string) =>
  FindCatalogObjectByUID(clusterId, uid);

export interface CatalogQueryCSVExport {
  path: string;
  bytes: number;
  /** The user dismissed the save dialog; nothing was written. */
  canceled?: boolean;
}

/** Save a frontend-built CSV string to a user-selected file (returns the chosen path). */
export const saveCsvFile = (defaultFilename: string, content: string) =>
  SaveCsvFile(defaultFilename, content) as Promise<CatalogQueryCSVExport>;

/** Save log text to a user-selected .log file (returns the chosen path). */
export const saveLogFile = (defaultFilename: string, content: string) =>
  SaveLogFile(defaultFilename, content) as Promise<CatalogQueryCSVExport>;

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
  GetRevisionHistory(resourceRefForTarget(target));

export const readWorkloadHPAManagedForRef = (target: ObjectReadTarget) =>
  IsWorkloadHPAManaged(resourceRefForTarget(target));

export const readQueryPermissions = async <T>(
  queries: capabilities.PermissionQuery[]
): Promise<T> => {
  if (!desktopRuntimeAvailable()) {
    throw new Error('QueryPermissions unavailable');
  }
  return QueryPermissions(queries) as unknown as Promise<T>;
};
