/**
 * frontend/src/modules/object-panel/components/ObjectPanel/NodeLogs/nodeLogsApi.test.ts
 *
 * Node log discovery and reads reach the backend with the node's complete
 * identity, through the real data-access broker and readers. Only the backend
 * boundary is faked (test-utils/appState).
 */

import { describe, expect, it } from 'vitest';
import { installAppStateHarness } from '@/test-utils/appState/harness';
import { discoverNodeLogs, fetchNodeLogs } from './nodeLogsApi';

const app = installAppStateHarness();

describe('node log reads', () => {
  it('identifies the node completely when discovering and fetching its logs', async () => {
    const dev = app.cluster({ name: 'dev', context: 'alpha' });
    const source = {
      id: 'journal/kubelet',
      label: 'kubelet',
      kind: 'journal',
      path: 'journal/kubelet',
    };
    // Mirrors backend/node_logs.go: discovery reports sources; a read returns
    // the source's content.
    app.backend.answer('DiscoverNodeLogs', () => ({ supported: true, sources: [source] }));
    app.backend.answer('FetchNodeLogs', (_target, fetchRequest) => ({
      content: 'log line',
      source,
      sourcePath: fetchRequest.sourcePath,
    }));
    const request = { sourcePath: 'journal/kubelet', tailBytes: 1024 };

    await discoverNodeLogs(dev.clusterId, 'node-a');
    await fetchNodeLogs(dev.clusterId, 'node-a', request);

    // Nodes are cluster-scoped, so the reference carries an empty namespace.
    const node = {
      clusterId: dev.clusterId,
      group: '',
      version: 'v1',
      kind: 'Node',
      namespace: '',
      name: 'node-a',
    };
    expect(app.backend.calls('DiscoverNodeLogs')).toEqual([[node]]);
    expect(app.backend.calls('FetchNodeLogs')).toEqual([[node, request]]);
  });
});
