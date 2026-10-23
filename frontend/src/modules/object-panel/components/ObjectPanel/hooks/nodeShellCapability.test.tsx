/**
 * frontend/src/modules/object-panel/components/ObjectPanel/hooks/nodeShellCapability.test.tsx
 *
 * Node shell gating through the real capability hook, permission store, and the
 * node panel's debug-pod namespace query, inside the app shell. Only the
 * backend boundary is faked (test-utils/appState).
 */

import { describe, expect, it } from 'vitest';
import {
  installAppStateHarness,
  type PermissionQuery,
  type TestCluster,
  type TestObject,
} from '@/test-utils/appState/harness';
import { useObjectPanelCapabilities } from './useObjectPanelCapabilities';
import { useObjectPanelFeatureSupport } from './useObjectPanelFeatureSupport';

const app = installAppStateHarness();

const checkName = (query: PermissionQuery) =>
  query.subresource ? `${query.resourceKind}/${query.subresource}` : query.resourceKind;

/**
 * Decides the cluster's permission answers. A denial comes from an access
 * review naming the check, as when the namespace's rules are incomplete (EKS
 * access policies).
 */
const answerPermissions = (isAllowed: (query: PermissionQuery) => boolean) => {
  app.permissions(
    (query) => isAllowed(query) || { reason: `cannot ${query.verb} ${checkName(query)}` }
  );
};

let shell: ReturnType<typeof useObjectPanelCapabilities> | null = null;

// The node panel's capability wiring, as ObjectPanel composes it.
function NodePanelProbe({ panel }: Readonly<{ panel: TestObject }>) {
  const featureSupport = useObjectPanelFeatureSupport(panel.ref);
  shell = useObjectPanelCapabilities({
    objectData: panel.ref,
    detailScope: panel.scopes.detailScope,
    featureSupport,
  });
  return null;
}

// A user whose pod rights are limited to the debug pod namespace.
const podsInDefault = (query: PermissionQuery) =>
  query.resourceKind !== 'Pod' || query.namespace === 'default';

describe('node shell capability', () => {
  const showNodePanel = async () => {
    shell = null;
    const dev: TestCluster = app.cluster({ name: 'dev', context: 'alpha' });
    app.namespaces(dev, ['default']);
    // backend/node_logs.go DiscoverNodeLogs for a node without readable logs.
    app.backend.answer('DiscoverNodeLogs', () => ({
      supported: false,
      reason: 'node logs are not supported on this cluster',
    }));
    const view = await app.render(null);
    const node = app.object(dev, {
      group: '',
      version: 'v1',
      kind: 'Node',
      namespace: '',
      name: 'worker-1',
    });
    await view.show(<NodePanelProbe panel={node} />);
  };

  it('offers the shell on a node to a user who may manage pods in default', async () => {
    answerPermissions(podsInDefault);

    await showNodePanel();

    expect(shell?.capabilities.hasShell).toBe(true);
  });

  it.each(['create', 'get', 'delete'])(
    'withholds the shell when the user may not %s the debug pod',
    async (verb) => {
      answerPermissions(
        (query) => podsInDefault(query) && !(query.verb === verb && !query.subresource)
      );

      await showNodePanel();

      expect(shell?.capabilities.hasShell).toBe(false);
      expect(shell?.capabilityReasons.shell).toBe(`cannot ${verb} Pod`);
    }
  );

  // Attach over a websocket upgrades a GET and over SPDY a POST; either suffices.
  it('offers the shell when only one attach verb is allowed', async () => {
    answerPermissions(
      (query) =>
        podsInDefault(query) && !(query.subresource === 'attach' && query.verb === 'create')
    );

    await showNodePanel();

    expect(shell?.capabilities.hasShell).toBe(true);
  });

  it('withholds the shell when the debug pod cannot be attached to', async () => {
    answerPermissions((query) => podsInDefault(query) && query.subresource !== 'attach');

    await showNodePanel();

    expect(shell?.capabilities.hasShell).toBe(false);
    expect(shell?.capabilityReasons.shell).toBe('cannot get Pod/attach');
  });
});
