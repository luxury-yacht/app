/**
 * frontend/src/modules/object-panel/components/ObjectPanel/ObjectPanel.groupContext.test.tsx
 *
 * Panels sharing a dock group render their content into the group's slot.
 * Each panel's content must read its own object, not another tab's, whichever
 * tab is in front. Runs the full app with two real panels in one group; the
 * Details tab is stubbed to report the object it sees, and the other tabs'
 * contents are stubbed out. Only the backend boundary is faked
 * (test-utils/appState).
 */

import { act } from 'react';
import { expect, it, vi } from 'vitest';
import { installAppStateHarness, type ObjectIdentity } from '@/test-utils/appState/harness';

const seen = vi.hoisted(() => ({ objects: [] as unknown[] }));

vi.mock('@modules/object-panel/components/ObjectPanel/Details/DetailsTab', async () => {
  const { useCurrentObjectPanel } = await import('@modules/object-panel/hooks/useObjectPanel');
  return {
    default: function DetailsProbe() {
      seen.objects.push(useCurrentObjectPanel().objectData);
      return null;
    },
  };
});
for (const tab of [
  'Logs/LogViewer',
  'Shell/ShellTab',
  'Events/EventsTab',
  'Yaml/YamlTab',
  'Helm/ManifestTab',
  'Helm/ValuesTab',
]) {
  vi.doMock(`@modules/object-panel/components/ObjectPanel/${tab}`, () => ({ default: () => null }));
}

const app = installAppStateHarness();

const pod: ObjectIdentity = {
  group: '',
  version: 'v1',
  kind: 'Pod',
  namespace: 'argo-sandbox',
  name: 'api-123',
};
const deployment: ObjectIdentity = { ...pod, group: 'apps', kind: 'Deployment', name: 'api' };

it('keeps each tab’s own object identity in the group’s shared content slot', async () => {
  const dev = app.cluster({ name: 'dev', context: 'alpha' });
  app.namespaces(dev, ['argo-sandbox']);
  app.startScreen(dev);
  app.backend.answer('IsWorkloadHPAManaged', () => false);
  const objects = [deployment, pod].map((identity) =>
    app.servePanel(dev, identity, {
      detailType: identity.kind.toLowerCase(),
      details: { name: identity.name, namespace: identity.namespace },
    } as never)
  );
  const view = await app.mountApp();
  const [deploymentPanel] = objects;

  // Both panels open into the same dock group; the pod is in front.
  for (const object of objects) {
    await act(async () => {
      view.owners().objectPanel.openWithObject(object.ref);
    });
    await app.settle();
  }
  expect(seen.objects[seen.objects.length - 1]).toMatchObject({
    clusterId: dev.clusterId,
    kind: 'Pod',
    name: 'api-123',
    group: '',
    version: 'v1',
  });

  // Bringing the Deployment to the front shows its own object.
  await act(async () => {
    view.owners().objectPanel.openWithObject(deploymentPanel.ref);
  });
  await app.settle();
  expect(seen.objects[seen.objects.length - 1]).toMatchObject({
    clusterId: dev.clusterId,
    kind: 'Deployment',
    name: 'api',
    group: 'apps',
  });
});
