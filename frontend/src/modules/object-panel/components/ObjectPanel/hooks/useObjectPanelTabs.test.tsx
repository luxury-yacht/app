/**
 * frontend/src/modules/object-panel/components/ObjectPanel/hooks/useObjectPanelTabs.test.tsx
 *
 * The object panel's tab list and its number-key shortcuts, inside the app
 * shell with the real keyboard provider and shortcut routing. Only the backend
 * boundary is faked (test-utils/appState). The probe owns the active tab as
 * ObjectPanel's panel state does, and keys are pressed on the document.
 */

import { useObjectPanelTabs } from '@modules/object-panel/components/ObjectPanel/hooks/useObjectPanelTabs';
import type {
  ComputedCapabilities,
  PanelObjectData,
  ViewType,
} from '@modules/object-panel/components/ObjectPanel/types';
import { act, useState } from 'react';
import { describe, expect, it } from 'vitest';
import {
  installAppStateHarness,
  type MountedApp,
  type ObjectIdentity,
  type TestCluster,
} from '@/test-utils/appState/harness';

const app = installAppStateHarness();

const baseCapabilities: ComputedCapabilities = {
  hasObjPanelLogs: true,
  hasNodeLogs: false,
  hasShell: false,
  hasManifest: false,
  hasValues: false,
  canDelete: true,
  canRestart: true,
  canScale: true,
  canEditYaml: true,
  canTrigger: false,
  canSuspend: false,
};

const deployment: ObjectIdentity = {
  group: 'apps',
  version: 'v1',
  kind: 'Deployment',
  namespace: 'team-a',
  name: 'api',
};
const helmRelease: ObjectIdentity = {
  group: 'helm.sh',
  version: 'v3',
  kind: 'HelmRelease',
  namespace: 'team-a',
  name: 'shop',
};
const node: ObjectIdentity = {
  group: '',
  version: 'v1',
  kind: 'Node',
  namespace: '',
  name: 'node-1',
};
const pod: ObjectIdentity = {
  group: '',
  version: 'v1',
  kind: 'Pod',
  namespace: 'team-a',
  name: 'api-123',
};

interface TabsProbeProps {
  objectData: PanelObjectData | null;
  capabilities?: ComputedCapabilities;
  isHelmRelease?: boolean;
  isEvent?: boolean;
  isOpen?: boolean;
  initialTab?: ViewType;
}

let shownLabels: string[] = [];

function TabsProbe({
  objectData,
  capabilities = baseCapabilities,
  isHelmRelease = false,
  isEvent = false,
  isOpen = true,
  initialTab = 'details',
}: Readonly<TabsProbeProps>) {
  const [activeTab, setActiveTab] = useState<ViewType>(initialTab);
  const { availableTabs } = useObjectPanelTabs({
    capabilities,
    objectData,
    isHelmRelease,
    isEvent,
    isOpen,
    setActiveTab,
    currentTab: activeTab,
  });
  shownLabels = availableTabs.map((tab) => tab.label);
  return <output data-active-tab={activeTab} />;
}

describe('useObjectPanelTabs', () => {
  let dev: TestCluster;
  let view: MountedApp;

  const start = async () => {
    shownLabels = [];
    dev = app.cluster({ name: 'dev', context: 'alpha' });
    app.namespaces(dev, ['team-a']);
    view = await app.render(null);
  };

  /** The object in the test cluster, with complete identity. */
  const inCluster = (identity: ObjectIdentity): PanelObjectData => app.object(dev, identity).ref;

  const activeTab = () =>
    view.container.querySelector('[data-active-tab]')?.getAttribute('data-active-tab');

  const press = async (key: string) => {
    await act(async () => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    });
  };

  it('returns workload tabs excluding manifest/values for non-Helm resources', async () => {
    await start();
    await view.show(<TabsProbe objectData={inCluster(deployment)} />);

    expect(shownLabels).toEqual(['Details', 'Map', 'Pods', 'Logs', 'Metrics', 'Events', 'YAML']);
  });

  it.each([
    node,
    deployment,
    { ...deployment, kind: 'StatefulSet' },
    { ...deployment, kind: 'DaemonSet' },
  ])('offers the Metrics tab for a $kind, which has live metrics', async (identity) => {
    await start();
    await view.show(<TabsProbe objectData={inCluster(identity)} />);

    expect(shownLabels).toContain('Metrics');
  });

  it.each([
    { ...deployment, kind: 'ReplicaSet' },
    { ...deployment, group: 'batch', kind: 'Job' },
    { ...deployment, group: '', kind: 'ConfigMap' },
    // A custom resource that shares a built-in kind name has no metrics-server data.
    { ...deployment, group: 'example.com', version: 'v1alpha1' },
  ])(
    'omits the Metrics tab for a $kind in "$group", which has no live metrics',
    async (identity) => {
      await start();
      await view.show(<TabsProbe objectData={inCluster(identity)} />);

      expect(shownLabels).not.toContain('Metrics');
    }
  );

  it('omits the Shell tab when capability is disabled', async () => {
    await start();
    await view.show(<TabsProbe objectData={inCluster(pod)} />);

    expect(shownLabels).toEqual(['Details', 'Map', 'Logs', 'Metrics', 'Events', 'YAML']);
  });

  it('includes the Shell tab for pods when capability is available', async () => {
    await start();
    await view.show(
      <TabsProbe
        objectData={inCluster(pod)}
        capabilities={{ ...baseCapabilities, hasShell: true }}
      />
    );

    expect(shownLabels).toEqual(['Details', 'Map', 'Logs', 'Metrics', 'Events', 'YAML', 'Shell']);
  });

  it('includes the Shell tab for nodes when the node shell is available', async () => {
    await start();
    await view.show(
      <TabsProbe
        objectData={inCluster(node)}
        capabilities={{ ...baseCapabilities, hasObjPanelLogs: false, hasShell: true }}
      />
    );

    expect(shownLabels).toEqual(['Details', 'Map', 'Pods', 'Metrics', 'Events', 'YAML', 'Shell']);
  });

  it('uses the Logs tab for node objects rather than a separate node logs tab', async () => {
    await start();
    await view.show(
      <TabsProbe
        objectData={inCluster(node)}
        capabilities={{ ...baseCapabilities, hasObjPanelLogs: true, hasNodeLogs: false }}
      />
    );

    expect(shownLabels).toEqual(['Details', 'Map', 'Pods', 'Logs', 'Metrics', 'Events', 'YAML']);
  });

  it('includes map/manifest/values and omits events/yaml for Helm releases', async () => {
    await start();
    await view.show(
      <TabsProbe
        isHelmRelease
        objectData={inCluster(helmRelease)}
        capabilities={{ ...baseCapabilities, hasManifest: true, hasValues: true }}
      />
    );

    expect(shownLabels).toEqual(['Details', 'Map', 'Logs', 'Manifest', 'Values']);
  });

  it('hides events and YAML tabs for Event objects', async () => {
    await start();
    await view.show(
      <TabsProbe isEvent objectData={inCluster({ ...pod, kind: 'Event', name: 'warning' })} />
    );

    expect(shownLabels).toEqual(['Details', 'Logs']);
  });

  it.each(['ValidatingWebhookConfiguration', 'MutatingWebhookConfiguration'])(
    'hides the Map tab for a %s, which the object map does not support',
    async (kind) => {
      await start();
      await view.show(
        <TabsProbe
          objectData={inCluster({
            group: 'admissionregistration.k8s.io',
            version: 'v1',
            kind,
            namespace: '',
            name: 'admission-webhooks',
          })}
        />
      );

      expect(shownLabels).toEqual(['Details', 'Logs', 'Events', 'YAML']);
    }
  );

  it('hides the Map tab for custom resources', async () => {
    await start();
    await view.show(
      <TabsProbe
        objectData={inCluster({
          group: 'example.com',
          version: 'v1',
          kind: 'Widget',
          namespace: 'team-a',
          name: 'gadget',
        })}
      />
    );

    expect(shownLabels).toEqual(['Details', 'Logs', 'Events', 'YAML']);
  });

  // Representative cluster-scoped, RBAC, and core kinds; objectPanelRef.test.ts owns the table.
  it.each([
    { group: 'networking.k8s.io', version: 'v1', kind: 'IngressClass', namespace: '' },
    { group: 'rbac.authorization.k8s.io', version: 'v1', kind: 'RoleBinding', namespace: 'team-a' },
    { group: '', version: 'v1', kind: 'ConfigMap', namespace: 'team-a' },
  ])('keeps the Map tab for a $kind, which the object map supports', async (identity) => {
    await start();
    await view.show(<TabsProbe objectData={inCluster({ ...identity, name: 'public' })} />);

    expect(shownLabels).toContain('Map');
  });

  it('hides the Map tab for supported kinds when the object reference is incomplete', async () => {
    await start();
    await view.show(
      <TabsProbe objectData={{ kind: 'Deployment', name: 'api', namespace: 'team-a' }} />
    );

    expect(shownLabels).toEqual(['Details', 'Pods', 'Logs', 'Events', 'YAML']);
  });

  it('falls back to details when the active tab becomes unavailable', async () => {
    await start();
    await view.show(
      <TabsProbe
        objectData={inCluster(deployment)}
        capabilities={{ ...baseCapabilities, hasObjPanelLogs: false }}
        initialTab="logs"
      />
    );

    expect(activeTab()).toBe('details');
  });

  describe('number-key shortcuts', () => {
    it('switch to the visible tab at each position', async () => {
      await start();
      await view.show(<TabsProbe objectData={inCluster(deployment)} />);

      // Deployment tabs: Details, Map, Pods, Logs, Metrics, Events, YAML.
      await press('4');
      expect(activeTab()).toBe('logs');
      await press('5');
      expect(activeTab()).toBe('metrics');
      await press('7');
      expect(activeTab()).toBe('yaml');
      await press('1');
      expect(activeTab()).toBe('details');
    });

    it('leave no gap where a tab is hidden', async () => {
      await start();
      await view.show(
        <TabsProbe
          objectData={inCluster(deployment)}
          capabilities={{ ...baseCapabilities, hasObjPanelLogs: false }}
        />
      );

      // Without Logs: Details, Map, Pods, Metrics, Events, YAML.
      await press('4');
      expect(activeTab()).toBe('metrics');
      await press('7');
      expect(activeTab()).toBe('metrics');
    });

    it("follow a Helm release's own tabs", async () => {
      await start();
      await view.show(
        <TabsProbe
          isHelmRelease
          objectData={inCluster(helmRelease)}
          capabilities={{ ...baseCapabilities, hasManifest: true, hasValues: true }}
        />
      );

      // Details, Map, Logs, Manifest, Values.
      await press('4');
      expect(activeTab()).toBe('manifest');
      await press('5');
      expect(activeTab()).toBe('values');
    });

    it('are ignored while the panel is closed', async () => {
      await start();
      await view.show(<TabsProbe objectData={inCluster(deployment)} isOpen={false} />);

      await press('2');

      expect(activeTab()).toBe('details');
    });
  });
});
