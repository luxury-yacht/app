/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Helm/ManifestTab.test.tsx
 *
 * The Helm Manifest tab reads its release's manifest when it opens, and reads
 * nothing while cluster data is paused. Runs inside the real app shell over a
 * faked backend (test-utils/appState); only the code editor is stubbed, to
 * read the text it shows.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  installAppStateHarness,
  type MountedApp,
  type TestCluster,
} from '@/test-utils/appState/harness';
import ManifestTab from './ManifestTab';

vi.mock('@uiw/react-codemirror', () => ({
  __esModule: true,
  default: ({ value }: { value: string }) => <pre data-testid="code-mirror">{value}</pre>,
}));

const app = installAppStateHarness();

const MANIFEST = 'apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: demo\n';

describe('ManifestTab', () => {
  let dev: TestCluster;
  let scope: string;
  let view: MountedApp;

  beforeEach(() => {
    dev = app.cluster({ name: 'dev', context: 'alpha' });
    app.namespaces(dev, ['team-a']);
    scope =
      app.object(dev, {
        group: 'helm.sh',
        version: 'v3',
        kind: 'HelmRelease',
        namespace: 'team-a',
        name: 'demo',
      }).scopes.helmScope ?? '';
  });

  const showTab = async () => {
    view = await app.render(null);
    await view.show(<ManifestTab scope={scope} isActive />);
  };

  const manifestReads = () => app.snapshots.reads('object-helm-manifest').map((read) => read.scope);

  it('reads the release manifest when the tab opens and shows it', async () => {
    app.snapshots.serve('object-helm-manifest', scope, {
      clusterId: dev.clusterId,
      clusterName: dev.clusterName,
      manifest: MANIFEST,
    });

    await showTab();

    expect(manifestReads()).toContain(scope);
    expect(view.container.querySelector('[data-testid="code-mirror"]')?.textContent).toBe(MANIFEST);
  });

  it('reads nothing and says data is paused while auto-refresh is off', async () => {
    app.preferences({ autoRefreshEnabled: false });

    await showTab();

    expect(view.container.textContent).not.toContain('Loading manifest...');
    expect(view.container.textContent).toContain('Auto-refresh is disabled');
    expect(manifestReads()).toEqual([]);
  });
});
