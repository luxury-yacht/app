import {
  readNodeLogDiscovery,
  readNodeLogs,
  requestData,
  type DataRequestReason,
} from '@/core/data-access';
import type { types } from '@wailsjs/go/models';

export interface NodeLogSource {
  id: string;
  label: string;
  kind: 'journal' | 'path' | 'service';
  path: string;
}

export interface NodeLogDiscoveryResponse {
  supported: boolean;
  sources: NodeLogSource[];
  reason?: string;
}

export interface NodeLogFetchRequest {
  sourcePath: string;
  sinceTime?: string;
  tailBytes?: number;
}

export interface NodeLogFetchResponse {
  content?: string;
  source: NodeLogSource;
  error?: string;
  sourcePath?: string;
  truncated?: boolean;
}

export interface NodeLogFetchResult {
  status: 'executed' | 'blocked';
  data?: NodeLogFetchResponse;
  blockedReason?: string;
}

const nodeLogDiscoveryCache = new Map<string, NodeLogDiscoveryResponse>();
const nodeLogDiscoveryInflight = new Map<string, Promise<NodeLogDiscoveryResponse>>();

const getNodeLogDiscoveryKey = (clusterId: string, nodeName: string): string =>
  `${clusterId}::${nodeName}`;

const normalizeNodeLogKind = (kind: unknown): NodeLogSource['kind'] =>
  kind === 'journal' || kind === 'path' || kind === 'service' ? kind : 'path';

const cloneNodeLogSource = (source: Partial<NodeLogSource>): NodeLogSource => ({
  id: source.id ?? source.path ?? '',
  label: source.label ?? source.path ?? '',
  kind: normalizeNodeLogKind(source.kind),
  path: source.path ?? '',
});

const cloneNodeLogDiscoveryResponse = (response: {
  supported?: boolean;
  reason?: string;
  sources?: Array<Partial<NodeLogSource>>;
}): NodeLogDiscoveryResponse => ({
  supported: Boolean(response.supported),
  reason: response.reason,
  sources: Array.isArray(response.sources) ? response.sources.map(cloneNodeLogSource) : [],
});

export const getCachedNodeLogDiscovery = (
  clusterId: string,
  nodeName: string
): NodeLogDiscoveryResponse | null => {
  const cached = nodeLogDiscoveryCache.get(getNodeLogDiscoveryKey(clusterId, nodeName));
  return cached ? cloneNodeLogDiscoveryResponse(cached) : null;
};

export const discoverNodeLogs = async (
  clusterId: string,
  nodeName: string,
  reason: DataRequestReason = 'startup'
): Promise<NodeLogDiscoveryResponse> => {
  const cacheKey = getNodeLogDiscoveryKey(clusterId, nodeName);
  const cached = nodeLogDiscoveryCache.get(cacheKey);
  if (cached) {
    return cloneNodeLogDiscoveryResponse(cached);
  }

  const inflight = nodeLogDiscoveryInflight.get(cacheKey);
  if (inflight) {
    return inflight.then(cloneNodeLogDiscoveryResponse);
  }

  const request = requestData({
    resource: 'node-log-discovery',
    reason,
    adapter: 'rpc-read',
    label: 'Node Log Discovery',
    scope: `${clusterId}:Node:${nodeName}`,
    read: () => readNodeLogDiscovery(clusterId, nodeName),
  })
    .then((result) => {
      if (result.status === 'blocked') {
        return {
          supported: false,
          sources: [],
          reason: 'Cluster data refresh is paused',
        } satisfies NodeLogDiscoveryResponse;
      }
      const normalized = cloneNodeLogDiscoveryResponse(
        (result.data as unknown as Partial<NodeLogDiscoveryResponse> | undefined) ?? {
          supported: false,
        }
      );
      nodeLogDiscoveryCache.set(cacheKey, normalized);
      return normalized;
    })
    .finally(() => {
      nodeLogDiscoveryInflight.delete(cacheKey);
    });

  nodeLogDiscoveryInflight.set(cacheKey, request);
  return request.then(cloneNodeLogDiscoveryResponse);
};

export const fetchNodeLogs = async (
  clusterId: string,
  nodeName: string,
  request: NodeLogFetchRequest,
  reason: DataRequestReason = 'user'
): Promise<NodeLogFetchResult> => {
  const result = await requestData({
    resource: 'node-logs',
    reason,
    adapter: 'rpc-read',
    label: 'Node Logs',
    scope: `${clusterId}:Node:${nodeName}:${request.sourcePath}`,
    read: () => readNodeLogs(clusterId, nodeName, request as types.NodeLogFetchRequest),
  });

  if (result.status === 'blocked') {
    return {
      status: 'blocked',
      blockedReason: result.blockedReason,
    };
  }

  return {
    status: 'executed',
    data: result.data as NodeLogFetchResponse,
  };
};
