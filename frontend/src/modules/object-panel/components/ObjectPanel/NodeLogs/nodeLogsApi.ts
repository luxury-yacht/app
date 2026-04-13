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

const getRuntimeApp = (): Record<string, (...args: unknown[]) => Promise<unknown>> | null => {
  const runtimeApp = (window as any).go?.backend?.App;
  return runtimeApp && typeof runtimeApp === 'object' ? runtimeApp : null;
};

const nodeLogDiscoveryCache = new Map<string, NodeLogDiscoveryResponse>();
const nodeLogDiscoveryInflight = new Map<string, Promise<NodeLogDiscoveryResponse>>();

const getNodeLogDiscoveryKey = (clusterId: string, nodeName: string): string =>
  `${clusterId}::${nodeName}`;

const cloneNodeLogSource = (source: NodeLogSource): NodeLogSource => ({ ...source });

const cloneNodeLogDiscoveryResponse = (
  response: NodeLogDiscoveryResponse
): NodeLogDiscoveryResponse => ({
  supported: response.supported,
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

export const resetNodeLogDiscoveryCacheForTesting = (): void => {
  nodeLogDiscoveryCache.clear();
  nodeLogDiscoveryInflight.clear();
};

export const discoverNodeLogs = async (
  clusterId: string,
  nodeName: string
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

  const runtimeApp = getRuntimeApp();
  if (!runtimeApp || typeof runtimeApp.DiscoverNodeLogs !== 'function') {
    throw new Error('Node log discovery is unavailable');
  }

  const request = (
    runtimeApp.DiscoverNodeLogs(clusterId, nodeName) as Promise<NodeLogDiscoveryResponse>
  )
    .then((response) => {
      const normalized = cloneNodeLogDiscoveryResponse(response);
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
  request: NodeLogFetchRequest
): Promise<NodeLogFetchResponse> => {
  const runtimeApp = getRuntimeApp();
  if (!runtimeApp || typeof runtimeApp.FetchNodeLogs !== 'function') {
    throw new Error('Node log fetch is unavailable');
  }
  return runtimeApp.FetchNodeLogs(clusterId, nodeName, request) as Promise<NodeLogFetchResponse>;
};
