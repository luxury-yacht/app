import { beforeEach, describe, expect, it, vi } from 'vitest';
import { discoverNodeLogs, fetchNodeLogs } from './nodeLogsApi';

const dataAccess = vi.hoisted(() => ({
  readNodeLogDiscovery: vi.fn(),
  readNodeLogs: vi.fn(),
  requestData: vi.fn(async ({ read }: { read: () => Promise<unknown> }) => ({
    status: 'executed',
    data: await read(),
  })),
}));

vi.mock('@/core/data-access', () => dataAccess);

describe('node log reads', () => {
  beforeEach(() => {
    dataAccess.readNodeLogDiscovery.mockReset();
    dataAccess.readNodeLogs.mockReset();
  });

  it('identifies the node completely when discovering and fetching its logs', async () => {
    dataAccess.readNodeLogDiscovery.mockResolvedValue({ supported: true, sources: [] });
    dataAccess.readNodeLogs.mockResolvedValue({ content: 'log line' });
    const node = { clusterId: 'cluster-a', group: '', version: 'v1', kind: 'Node', name: 'node-a' };
    const request = { sourcePath: 'journal/kubelet', tailBytes: 1024 };

    await discoverNodeLogs('cluster-a', 'node-a');
    await fetchNodeLogs('cluster-a', 'node-a', request);

    expect(dataAccess.readNodeLogDiscovery).toHaveBeenCalledWith(node);
    expect(dataAccess.readNodeLogs).toHaveBeenCalledWith(node, request);
  });
});
