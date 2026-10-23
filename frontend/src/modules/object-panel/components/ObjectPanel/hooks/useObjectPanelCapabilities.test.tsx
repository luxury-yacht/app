/**
 * frontend/src/modules/object-panel/components/ObjectPanel/hooks/useObjectPanelCapabilities.test.tsx
 *
 * Object panel capability gating through the real capability hook, permission
 * store, and node log discovery client, inside the app shell. Only the backend
 * boundary is faked (test-utils/appState); each test decides the cluster's
 * permission answers (`app.permissions`) and states the queries the backend
 * receives and how the panel gates on the answers.
 */

import { describe, expect, it } from 'vitest';
import {
  installAppStateHarness,
  type MountedApp,
  type ObjectIdentity,
  type TestCluster,
} from '@/test-utils/appState/harness';
import type { FeatureSupport, PanelObjectData } from '../types';
import { useObjectPanelCapabilities } from './useObjectPanelCapabilities';

type CapabilitiesResult = ReturnType<typeof useObjectPanelCapabilities>;

const app = installAppStateHarness();

/** The queries the backend received, as their identity and verb. */
const queriedChecks = () =>
  app.backend
    .calls('QueryPermissions')
    .flatMap(([queries]) => queries ?? [])
    .map(({ id: _id, ...check }) => check);

const noFeatures: FeatureSupport = { logs: 'none', shell: 'none', debug: false, edit: false };

const workloadFeatures: FeatureSupport = { ...noFeatures, logs: 'owned-pods', edit: true };
const podFeatures: FeatureSupport = { ...noFeatures, logs: 'pod', shell: 'exec', edit: true };

let result: CapabilitiesResult | null = null;

function CapabilitiesProbe({
  objectData,
  featureSupport,
  detailScope = null,
}: Readonly<{
  objectData: PanelObjectData | null;
  featureSupport: FeatureSupport;
  detailScope?: string | null;
}>) {
  result = useObjectPanelCapabilities({
    objectData,
    detailScope,
    featureSupport,
  });
  return null;
}

const capabilities = () => {
  if (!result) {
    throw new Error('expected the capabilities hook to render');
  }
  return result;
};

describe('useObjectPanelCapabilities', () => {
  let dev: TestCluster;
  let view: MountedApp;

  const start = async () => {
    result = null;
    dev = app.cluster({ name: 'dev', context: 'alpha' });
    app.namespaces(dev, ['team-a']);
    view = await app.render(null);
  };

  const showPanel = async (identity: ObjectIdentity, featureSupport: FeatureSupport) => {
    const panel = app.object(dev, identity);
    await view.show(
      <CapabilitiesProbe
        objectData={panel.ref}
        featureSupport={featureSupport}
        detailScope={panel.scopes.detailScope}
      />
    );
    return panel;
  };

  const pod = (name: string): ObjectIdentity => ({
    group: '',
    version: 'v1',
    kind: 'Pod',
    namespace: 'team-a',
    name,
  });

  // Object actions (delete, scale, restart, ...) are gated by the shared action
  // controller, which queries its own checks; the panel queries only what it gates.
  it('queries the object’s YAML and finalizer permissions and gates editing on its answer', async () => {
    app.permissions((query) => (query.verb === 'patch' ? { reason: 'locked' } : true));
    await start();

    await showPanel(
      { group: 'apps', version: 'v1', kind: 'Deployment', namespace: 'team-a', name: 'api' },
      workloadFeatures
    );

    const deployment = {
      clusterId: dev.clusterId,
      group: 'apps',
      version: 'v1',
      resourceKind: 'Deployment',
      namespace: 'team-a',
      name: 'api',
    };
    expect(queriedChecks()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ...deployment, verb: 'get' }),
        expect.objectContaining({ ...deployment, verb: 'patch' }),
      ])
    );
    const { capabilities: flags, capabilityReasons, capabilityStates } = capabilities();
    expect(flags.canEditYaml).toBe(false);
    expect(capabilityReasons.editYaml).toBe('locked');
    expect(capabilityStates.removeFinalizer.allowed).toBe(false);
  });

  it('checks Namespace finalizer removal on metadata and on the finalize subresource separately', async () => {
    app.permissions((query) => (query.subresource === 'finalize' ? { reason: 'forbidden' } : true));
    await start();

    await showPanel(
      { group: '', version: 'v1', kind: 'Namespace', namespace: '', name: 'terminating' },
      noFeatures
    );

    const namespaceObject = {
      clusterId: dev.clusterId,
      group: '',
      version: 'v1',
      resourceKind: 'Namespace',
      name: 'terminating',
    };
    expect(queriedChecks()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ...namespaceObject, verb: 'patch', subresource: '' }),
        expect.objectContaining({ ...namespaceObject, verb: 'update', subresource: 'finalize' }),
      ])
    );
    expect(capabilities().capabilityStates.removeFinalizer.allowed).toBe(true);
    expect(capabilities().capabilityStates.removeNamespaceFinalizer.allowed).toBe(false);
  });

  it.each(['clusterId', 'group', 'version', 'kind', 'name'] as const)(
    'withholds permission queries until the object carries %s',
    async (missingField) => {
      await start();
      const complete = app.object(dev, pod('api')).ref;
      const features = podFeatures;
      const queriesBefore = queriedChecks().length;

      await view.show(
        <CapabilitiesProbe
          objectData={{ ...complete, [missingField]: undefined }}
          featureSupport={features}
        />
      );

      expect(queriedChecks()).toHaveLength(queriesBefore);
      expect(capabilities().capabilities.canEditYaml).toBe(false);
      expect(capabilities().capabilities.hasShell).toBe(false);

      await view.show(<CapabilitiesProbe objectData={complete} featureSupport={features} />);

      expect(queriedChecks()).toContainEqual(
        expect.objectContaining({
          clusterId: dev.clusterId,
          group: '',
          version: 'v1',
          resourceKind: 'Pod',
          namespace: 'team-a',
          name: 'api',
          verb: 'get',
          subresource: '',
        })
      );
      expect(capabilities().capabilities.canEditYaml).toBe(true);
      expect(capabilities().capabilities.hasShell).toBe(true);
    }
  );

  it('returns default states when there is no object', async () => {
    await start();

    await view.show(<CapabilitiesProbe objectData={null} featureSupport={noFeatures} />);

    expect(capabilities().capabilities).toEqual({
      hasObjPanelLogs: false,
      hasShell: false,
      canEditYaml: false,
    });
    expect(Object.values(capabilities().capabilityReasons).every((reason) => !reason)).toBe(true);
  });

  // Websocket exec upgrades a GET and SPDY exec a POST; either verb suffices.
  it.each(['get', 'create'])(
    'offers the pod shell when only %s pods/exec is allowed',
    async (allowedVerb) => {
      app.permissions((query) =>
        query.subresource === 'exec' && query.verb !== allowedVerb
          ? { reason: `EKS Access Policy: denied ${query.verb} pods/exec` }
          : true
      );
      await start();

      await showPanel(pod('api-123'), podFeatures);

      expect(capabilities().capabilities.hasShell).toBe(true);
      expect(capabilities().capabilityStates.shell.allowed).toBe(true);
      expect(capabilities().capabilityReasons.shell).toBeUndefined();
    }
  );

  it('surfaces the shell denial only when both exec verbs are denied', async () => {
    app.permissions((query) =>
      query.subresource === 'exec' ? { reason: `Forbidden: ${query.verb} pods/exec` } : true
    );
    await start();

    await showPanel(pod('api-123'), podFeatures);

    expect(capabilities().capabilities.hasShell).toBe(false);
    expect(capabilities().capabilityReasons.shell).toBe('Forbidden: get pods/exec');
  });

  it('surfaces the debug denial when ephemeral containers may not be updated', async () => {
    app.permissions((query) =>
      query.subresource === 'ephemeralcontainers'
        ? { reason: 'Forbidden: pods/ephemeralcontainers' }
        : true
    );
    await start();

    await showPanel(pod('demo'), { ...podFeatures, debug: true });

    expect(queriedChecks()).toContainEqual(
      expect.objectContaining({
        clusterId: dev.clusterId,
        resourceKind: 'Pod',
        namespace: 'team-a',
        name: 'demo',
        verb: 'update',
        subresource: 'ephemeralcontainers',
      })
    );
    expect(capabilities().capabilityStates.debug.allowed).toBe(false);
    expect(capabilities().capabilityReasons.debug).toBe('Forbidden: pods/ephemeralcontainers');
  });

  it('allows debug without a disabled reason when the review allows it with a reason', async () => {
    app.permissions((query) =>
      query.subresource === 'ephemeralcontainers'
        ? { allowed: true, reason: 'EKS Access Policy: allowed by ClusterRoleBinding "example"' }
        : true
    );
    await start();

    await showPanel(pod('demo'), { ...podFeatures, debug: true });

    expect(capabilities().capabilityStates.debug.allowed).toBe(true);
    expect(capabilities().capabilityReasons.debug).toBeUndefined();
  });

  describe('node logs', () => {
    const nodeFeatures: FeatureSupport = { ...noFeatures, logs: 'node' };
    const journal = (unit: string) => ({
      id: `journal/${unit}`,
      label: `journal / ${unit}`,
      kind: 'journal',
      path: `journal/${unit}`,
    });
    // Node log discovery is cached per cluster and node for the session, so each
    // test names its own node.
    const node = (name: string): ObjectIdentity => ({
      group: '',
      version: 'v1',
      kind: 'Node',
      namespace: '',
      name,
    });
    const discoveryTargets = () => app.backend.calls('DiscoverNodeLogs').map(([target]) => target);

    it('enables node logs when discovery returns readable sources', async () => {
      // backend/node_logs.go DiscoverNodeLogs for a node with a kubelet journal.
      app.backend.answer('DiscoverNodeLogs', () => ({
        supported: true,
        sources: [journal('kubelet')],
      }));
      await start();

      await showPanel(node('node-sources'), nodeFeatures);

      expect(discoveryTargets()).toEqual([
        {
          clusterId: dev.clusterId,
          group: '',
          version: 'v1',
          kind: 'Node',
          namespace: '',
          name: 'node-sources',
        },
      ]);
      expect(capabilities().nodeLogsState.allowed).toBe(true);
      expect(capabilities().capabilities.hasObjPanelLogs).toBe(true);
      expect(capabilities().nodeLogSources).toEqual([journal('kubelet')]);
      expect(capabilities().capabilityReasons.nodeLogs).toBeUndefined();
    });

    it('reuses discovery for the same node instead of asking the backend again', async () => {
      app.backend.answer('DiscoverNodeLogs', () => ({
        supported: true,
        sources: [journal('kubelet')],
      }));
      await start();
      await showPanel(node('node-cached'), nodeFeatures);
      view.clear();

      await showPanel(node('node-cached'), nodeFeatures);

      expect(discoveryTargets()).toHaveLength(1);
      expect(capabilities().nodeLogsState.allowed).toBe(true);
      expect(capabilities().nodeLogSources).toHaveLength(1);
    });

    it('discovers a same-named node again in another cluster', async () => {
      result = null;
      dev = app.cluster({ name: 'dev', context: 'alpha' });
      const other = app.cluster({ name: 'dev', context: 'beta' });
      app.namespaces(dev, ['team-a']);
      app.namespaces(other, ['team-a']);
      app.backend.answer('DiscoverNodeLogs', (target) => ({
        supported: true,
        sources: [journal(target.clusterId === dev.clusterId ? 'kubelet' : 'containerd')],
      }));
      view = await app.render(null);
      await showPanel(node('node-switch'), nodeFeatures);
      expect(capabilities().nodeLogSources[0]?.path).toBe('journal/kubelet');

      await view.show(
        <CapabilitiesProbe
          objectData={app.object(other, node('node-switch')).ref}
          featureSupport={nodeFeatures}
        />
      );

      expect(discoveryTargets().map((target) => target.clusterId)).toEqual([
        dev.clusterId,
        other.clusterId,
      ]);
      expect(capabilities().nodeLogSources[0]?.path).toBe('journal/containerd');
    });

    it('surfaces a node logs reason when discovery finds no readable sources', async () => {
      app.backend.answer('DiscoverNodeLogs', () => ({
        supported: false,
        reason: 'node logs are not supported on this cluster',
      }));
      await start();

      await showPanel(node('node-unsupported'), nodeFeatures);

      expect(capabilities().nodeLogsState.allowed).toBe(false);
      expect(capabilities().capabilities.hasObjPanelLogs).toBe(true);
      expect(capabilities().nodeLogSources).toEqual([]);
      expect(capabilities().capabilityReasons.nodeLogs).toBe(
        'node logs are not supported on this cluster'
      );
    });
  });
});
