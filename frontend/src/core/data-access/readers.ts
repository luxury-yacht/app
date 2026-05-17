import {
  DiscoverNodeLogs,
  FetchContainerLogs,
  FetchNodeLogs,
  FindCatalogObjectByUID,
  FindCatalogObjectMatch,
  GetContainerLogsScopeContainers,
  GetObjectYAMLByGVK,
  GetPodContainers,
  GetRevisionHistory,
  GetTargetPorts,
  IsWorkloadHPAManaged,
} from '@wailsjs/go/backend/App';
import type { types } from '@wailsjs/go/models';

export const readTargetPorts = (
  clusterId: string,
  namespace: string,
  kind: string,
  group: string,
  version: string,
  name: string
) => GetTargetPorts(clusterId, namespace, kind, group, version, name);

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

export const readObjectYAMLByGVK = (
  clusterId: string,
  apiVersion: string,
  kind: string,
  namespace: string,
  name: string
) => GetObjectYAMLByGVK(clusterId, apiVersion, kind, namespace, name);

export const readCatalogObjectMatch = (
  clusterId: string,
  namespace: string,
  group: string,
  version: string,
  kind: string,
  name: string
) => FindCatalogObjectMatch(clusterId, namespace, group, version, kind, name);

export const readCatalogObjectByUID = (clusterId: string, uid: string) =>
  FindCatalogObjectByUID(clusterId, uid);

export const readRevisionHistory = (
  clusterId: string,
  namespace: string,
  group: string,
  version: string,
  kind: string,
  name: string
) => GetRevisionHistory(clusterId, namespace, group, version, kind, name);

export const readWorkloadHPAManaged = (
  clusterId: string,
  namespace: string,
  group: string,
  version: string,
  kind: string,
  name: string
) => IsWorkloadHPAManaged(clusterId, namespace, group, version, kind, name);

export const readQueryPermissions = async <T>(queries: unknown[]): Promise<T> => {
  const runtimeApp = (window as any)?.go?.backend?.App;
  if (typeof runtimeApp?.QueryPermissions !== 'function') {
    throw new Error('QueryPermissions unavailable');
  }
  return runtimeApp.QueryPermissions(queries) as Promise<T>;
};
