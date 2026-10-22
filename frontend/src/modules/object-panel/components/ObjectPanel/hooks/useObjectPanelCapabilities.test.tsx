/**
 * frontend/src/modules/object-panel/components/ObjectPanel/hooks/useObjectPanelCapabilities.test.tsx
 *
 * Object panel capability gating through the real capability hook, permission
 * store, and node log discovery client, inside the app shell. Only the backend
 * boundary is faked (test-utils/appState); each test decides the cluster's
 * permission answers (`app.permissions`) and states the queries the backend
 * receives and how the panel gates on the answers.
 */

import { act } from 'react';
import { describe, expect, it } from 'vitest';
import { queryNamespacePermissions } from '@/core/capabilities';
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

const noFeatures: FeatureSupport = {
  objPanelLogs: false,
  nodeLogs: false,
  manifest: false,
  values: false,
  delete: false,
  restart: false,
  scale: false,
  edit: false,
  shell: false,
  debug: false,
  trigger: false,
  suspend: false,
};

const workloadFeatures: FeatureSupport = {
  ...noFeatures,
  delete: true,
  restart: true,
  scale: true,
  edit: true,
};

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
    objectKind: objectData?.kind?.toLowerCase() ?? null,
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

  it("queries the object's action permissions and gates each action on its answer", async () => {
    app.permissions((query) => {
      if (query.subresource === 'scale') {
        return { reason: 'forbidden' };
      }
      // Editing YAML, restarting, and removing finalizers all patch the object.
      return query.verb === 'patch' ? { reason: 'locked' } : true;
    });
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
        expect.objectContaining({ ...deployment, verb: 'delete' }),
        expect.objectContaining({ ...deployment, verb: 'update', subresource: 'scale' }),
      ])
    );
    const { capabilities: flags, capabilityReasons, capabilityStates } = capabilities();
    expect(flags.canDelete).toBe(true);
    expect(flags.canScale).toBe(false);
    expect(capabilityReasons.scale).toBe('forbidden');
    expect(flags.canEditYaml).toBe(false);
    expect(capabilityReasons.editYaml).toBe('locked');
    expect(flags.canRestart).toBe(false);
    expect(capabilityStates.removeFinalizer.allowed).toBe(false);
  });

  // Triggering creates a Job in the namespace; suspending patches the CronJob.
  it.each([
    { denied: 'patch', expected: { canTrigger: true, canSuspend: false } },
    { denied: 'create', expected: { canTrigger: false, canSuspend: true } },
  ])(
    'checks CronJob trigger and suspend independently in the object cluster ($denied denied)',
    async ({ denied, expected }) => {
      app.permissions((query) => (query.verb === denied ? { reason: 'forbidden' } : true));
      await start();
      // The trigger check names no Job, so it resolves from the panel's namespace
      // query (ObjectPanel queries the object's namespace when it opens).
      await act(async () => {
        queryNamespacePermissions('team-a', dev.clusterId);
      });

      await showPanel(
        { group: 'batch', version: 'v1', kind: 'CronJob', namespace: 'team-a', name: 'backup' },
        { ...noFeatures, trigger: true, suspend: true }
      );

      const inNamespace = {
        clusterId: dev.clusterId,
        group: 'batch',
        version: 'v1',
        namespace: 'team-a',
      };
      expect(queriedChecks()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            ...inNamespace,
            resourceKind: 'Job',
            verb: 'create',
            name: '',
          }),
          expect.objectContaining({
            ...inNamespace,
            resourceKind: 'CronJob',
            verb: 'patch',
            name: 'backup',
          }),
        ])
      );
      expect(capabilities().capabilities).toMatchObject(expected);
    }
  );

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
      const features = { ...workloadFeatures, shell: true };
      const queriesBefore = queriedChecks().length;

      await view.show(
        <CapabilitiesProbe
          objectData={{ ...complete, [missingField]: undefined }}
          featureSupport={features}
        />
      );

      expect(queriedChecks()).toHaveLength(queriesBefore);
      expect(capabilities().capabilities.canDelete).toBe(false);
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
      expect(capabilities().capabilities.canDelete).toBe(true);
      expect(capabilities().capabilities.hasShell).toBe(true);
    }
  );

  it('returns default states when there is no object', async () => {
    await start();

    await view.show(<CapabilitiesProbe objectData={null} featureSupport={noFeatures} />);

    expect(capabilities().capabilities).toEqual({
      hasObjPanelLogs: false,
      hasNodeLogs: false,
      hasShell: false,
      hasManifest: false,
      hasValues: false,
      canDelete: false,
      canRestart: false,
      canScale: false,
      canEditYaml: false,
      canTrigger: false,
      canSuspend: false,
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

      await showPanel(pod('api-123'), { ...workloadFeatures, shell: true });

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

    await showPanel(pod('api-123'), { ...workloadFeatures, shell: true });

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

    await showPanel(pod('demo'), { ...workloadFeatures, shell: true, debug: true });

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

    await showPanel(pod('demo'), { ...workloadFeatures, shell: true, debug: true });

    expect(capabilities().capabilityStates.debug.allowed).toBe(true);
    expect(capabilities().capabilityReasons.debug).toBeUndefined();
  });

  describe('node logs', () => {
    const nodeFeatures = { ...noFeatures, nodeLogs: true };
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
      expect(capabilities().capabilities.hasNodeLogs).toBe(true);
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
      expect(capabilities().capabilities.hasNodeLogs).toBe(true);
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

      expect(capabilities().capabilities.hasNodeLogs).toBe(false);
      expect(capabilities().capabilities.hasObjPanelLogs).toBe(true);
      expect(capabilities().nodeLogSources).toEqual([]);
      expect(capabilities().capabilityReasons.nodeLogs).toBe(
        'node logs are not supported on this cluster'
      );
    });
  });
});
