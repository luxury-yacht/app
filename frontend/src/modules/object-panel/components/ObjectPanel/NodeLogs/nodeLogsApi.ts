export interface NodeLogSource {
  id: string;
  label: string;
  kind: 'journal' | 'path';
  path: string;
}

export interface NodeLogDiscoveryResponse {
  supported: boolean;
  sources: NodeLogSource[];
  reason?: string;
}

export interface NodeLogFetchRequest {
  sourcePath: string;
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

export const discoverNodeLogs = async (
  clusterId: string,
  nodeName: string
): Promise<NodeLogDiscoveryResponse> => {
  const runtimeApp = getRuntimeApp();
  if (!runtimeApp || typeof runtimeApp.DiscoverNodeLogs !== 'function') {
    throw new Error('Node log discovery is unavailable');
  }
  return runtimeApp.DiscoverNodeLogs(clusterId, nodeName) as Promise<NodeLogDiscoveryResponse>;
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
