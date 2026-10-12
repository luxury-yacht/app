import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  readNodeLogDiscovery,
  readNodeLogs,
  readObjectYAMLForRef,
  readPodContainers,
  readWorkloadHPAManagedForRef,
} from './readers';

const backend = vi.hoisted(() => ({
  IsWorkloadHPAManaged: vi.fn(),
  GetObjectYAMLByGVK: vi.fn(),
  GetPodContainers: vi.fn(),
  DiscoverNodeLogs: vi.fn(),
  FetchNodeLogs: vi.fn(),
}));

vi.mock('@/core/backend-api', () => backend);

// Each object-scoped read must reach the backend with the object's complete
// identity in one reference, never as loose positional strings.
describe('object-scoped readers', () => {
  beforeEach(() => {
    for (const mock of Object.values(backend)) {
      mock.mockReset();
    }
  });

  it('asks whether a workload is HPA-managed by its complete identity', async () => {
    backend.IsWorkloadHPAManaged.mockResolvedValue(true);

    await expect(
      readWorkloadHPAManagedForRef({
        clusterId: 'cluster-a',
        namespace: 'default',
        group: 'apps',
        version: 'v1',
        kind: 'Deployment',
        name: 'web',
      })
    ).resolves.toBe(true);
    expect(backend.IsWorkloadHPAManaged).toHaveBeenCalledWith({
      clusterId: 'cluster-a',
      group: 'apps',
      version: 'v1',
      kind: 'Deployment',
      namespace: 'default',
      name: 'web',
    });
  });

  it.each([
    {
      apiVersion: 'rds.services.k8s.aws/v1alpha1',
      group: 'rds.services.k8s.aws',
      version: 'v1alpha1',
    },
    { apiVersion: 'v1', group: '', version: 'v1' },
  ])('reads YAML for apiVersion $apiVersion as group $group and version $version', async (tc) => {
    backend.GetObjectYAMLByGVK.mockResolvedValue('kind: X');

    await readObjectYAMLForRef({
      clusterId: 'cluster-a',
      apiVersion: tc.apiVersion,
      kind: 'DBInstance',
      namespace: 'default',
      name: 'db',
    });
    expect(backend.GetObjectYAMLByGVK).toHaveBeenCalledWith({
      clusterId: 'cluster-a',
      group: tc.group,
      version: tc.version,
      kind: 'DBInstance',
      namespace: 'default',
      name: 'db',
    });
  });

  it('refuses to read YAML without a version', () => {
    expect(() =>
      readObjectYAMLForRef({ clusterId: 'cluster-a', kind: 'DBInstance', name: 'db' })
    ).toThrow('Object identity for DBInstance/db is missing version');
    expect(backend.GetObjectYAMLByGVK).not.toHaveBeenCalled();
  });

  it('reads pod containers for the complete pod identity', async () => {
    backend.GetPodContainers.mockResolvedValue([]);
    const pod = {
      clusterId: 'cluster-a',
      group: '',
      version: 'v1',
      kind: 'Pod',
      namespace: 'team-a',
      name: 'pod-1',
    };

    await readPodContainers(pod);
    expect(backend.GetPodContainers).toHaveBeenCalledWith(pod);
  });

  it('discovers and fetches node logs for the complete node identity', async () => {
    backend.DiscoverNodeLogs.mockResolvedValue({ supported: true, sources: [] });
    backend.FetchNodeLogs.mockResolvedValue({ content: '' });
    const node = { clusterId: 'cluster-a', group: '', version: 'v1', kind: 'Node', name: 'node-a' };
    const request = { sourcePath: 'journal/kubelet', tailBytes: 1024 };

    await readNodeLogDiscovery(node);
    await readNodeLogs(node, request);
    // Nodes are cluster-scoped, so the reference carries an empty namespace.
    expect(backend.DiscoverNodeLogs).toHaveBeenCalledWith({ ...node, namespace: '' });
    expect(backend.FetchNodeLogs).toHaveBeenCalledWith({ ...node, namespace: '' }, request);
  });
});
