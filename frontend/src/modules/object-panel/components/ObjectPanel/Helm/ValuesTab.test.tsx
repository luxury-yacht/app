/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Helm/ValuesTab.test.tsx
 *
 * Covers the Defaults/Overrides/Merged views of the backend payload, YAML that
 * Helm reads back unchanged, per-panel view memory, the release's values read
 * lifecycle, and loading/paused/error states. Runs inside the real app shell
 * over a faked backend (test-utils/appState); only the code editor is stubbed,
 * to read the text it shows.
 */

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as YAML from 'yaml';
import type { ObjectHelmValuesSnapshotPayload } from '@/core/refresh/types';
import { objectPanelId } from '@/modules/object-panel/objectPanelRef';
import {
  installAppStateHarness,
  type MountedApp,
  type TestCluster,
  type TestObject,
} from '@/test-utils/appState/harness';
import { makeErrorStatus } from '@/test-utils/errorStatusFixtures';
import { requireValue } from '@/test-utils/requireValue';
import ValuesTab from './ValuesTab';

vi.mock('@uiw/react-codemirror', () => ({
  __esModule: true,
  default: ({ value }: { value: string }) => <pre data-testid="code-mirror">{value}</pre>,
}));

const app = installAppStateHarness();

type Values = Pick<ObjectHelmValuesSnapshotPayload, 'defaults' | 'overrides' | 'merged'>;

const VALUES: Values = {
  defaults: { replicaCount: 1, image: { repository: 'nginx', tag: '' }, podAnnotations: {} },
  overrides: { replicaCount: 3, image: { tag: 'v2.0' } },
  merged: { replicaCount: 3, image: { repository: 'nginx', tag: 'v2.0' }, podAnnotations: {} },
};

describe('ValuesTab', () => {
  let dev: TestCluster;
  let release: TestObject;
  let scope: string;
  let view: MountedApp;
  let releaseSequence = 0;

  beforeEach(async () => {
    dev = app.cluster({ name: 'dev', context: 'alpha' });
    app.namespaces(dev, ['team-a']);
    // The view memory outlives a test, so each test opens its own release.
    releaseSequence += 1;
    release = app.object(dev, {
      group: 'helm.sh',
      version: 'v3',
      kind: 'HelmRelease',
      namespace: 'team-a',
      name: `my-app-${releaseSequence}`,
    });
    scope = release.scopes.helmScope ?? '';
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const serveValues = (values: Values) => {
    app.snapshots.serve('object-helm-values', scope, {
      clusterId: dev.clusterId,
      clusterName: dev.clusterName,
      subchartPaths: null,
      ...values,
    });
  };

  const showTab = async (panelId = objectPanelId(release.ref)) => {
    await view.show(<ValuesTab scope={scope} isActive panelId={panelId} />);
  };

  const startWorkspace = async () => {
    view = await app.render(null);
  };

  const shownYaml = () =>
    requireValue(
      view.container.querySelector('[data-testid="code-mirror"]')?.textContent,
      'expected the values editor'
    );

  /** The YAML the editor shows, as Helm reads it back. */
  const shownValues = (): unknown => YAML.parse(shownYaml());

  const chooseView = async (label: string) => {
    const option = Array.from(view.container.querySelectorAll('.segmented-button__option')).find(
      (element) => element.textContent === label
    );
    await act(async () => {
      requireValue(option, `expected the ${label} view`).dispatchEvent(
        new MouseEvent('click', { bubbles: true })
      );
    });
    await app.settle();
  };

  const valuesReads = () => app.snapshots.reads('object-helm-values').map((read) => read.scope);

  // -----------------------------------------------------------------------
  // Views of the payload
  // -----------------------------------------------------------------------

  it('shows the chart defaults, user overrides, and merged values for the selected view', async () => {
    serveValues(VALUES);
    await startWorkspace();
    await showTab();

    expect(shownValues()).toEqual(VALUES.defaults);

    await chooseView('Overrides');
    expect(shownValues()).toEqual(VALUES.overrides);

    await chooseView('Merged');
    expect(shownValues()).toEqual(VALUES.merged);
  });

  it('shows an empty map when the release has no user-supplied values', async () => {
    serveValues({ ...VALUES, overrides: null });
    await startWorkspace();
    await showTab();

    await chooseView('Overrides');
    expect(shownValues()).toEqual({});
  });

  it('summarizes the overrides it marks in the Merged and Overrides views', async () => {
    serveValues({
      ...VALUES,
      defaults: { ...VALUES.defaults, testFramework: { enabled: true } },
      overrides: { ...VALUES.overrides, testFramework: null },
    });
    await startWorkspace();
    await showTab();
    const summary = () => view.container.querySelector('.helm-values-override-summary');

    expect(summary()).toBeNull();

    // replicaCount and image.tag are overridden; testFramework was removed.
    for (const label of ['Merged', 'Overrides']) {
      await chooseView(label);
      expect(summary()?.textContent, label).toContain('2 overridden');
      expect(summary()?.textContent, label).toContain('1 removed');
    }

    await chooseView('Defaults');
    expect(summary()).toBeNull();
  });

  it('quotes strings that Helm would otherwise read back as booleans', async () => {
    const strings = { tls: 'on', enabled: 'yes', legacy: 'off', confirm: 'n' };
    serveValues({ ...VALUES, defaults: strings });
    await startWorkspace();
    await showTab();

    // Helm parses values files as YAML 1.1, where bare yes/on/off/n are booleans.
    expect(YAML.parse(shownYaml(), { version: '1.1' })).toEqual(strings);
  });

  it('keeps the selected view for its panel when the tab remounts', async () => {
    serveValues(VALUES);
    await startWorkspace();
    await showTab();
    await chooseView('Merged');

    view.clear();
    await showTab();
    expect(shownValues()).toEqual(VALUES.merged);

    view.clear();
    await showTab(`${objectPanelId(release.ref)}-other`);
    expect(shownValues()).toEqual(VALUES.defaults);
  });

  // -----------------------------------------------------------------------
  // Read lifecycle and states
  // -----------------------------------------------------------------------

  it('reads the values while the tab is open and stops polling once it closes', async () => {
    vi.useFakeTimers();
    serveValues(VALUES);
    await startWorkspace();
    await showTab();
    expect(valuesReads()).toContain(scope);

    // The open tab keeps its values current on the domain's interval.
    app.snapshots.clearReads();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(valuesReads()).toContain(scope);

    view.clear();
    await app.settle();
    app.snapshots.clearReads();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(valuesReads()).toEqual([]);
  });

  it('shows a loading spinner while the first read is in flight', async () => {
    // The backend has not answered yet; the read settles only when aborted.
    app.snapshots.respond(({ domain, signal }) =>
      domain === 'object-helm-values'
        ? new Promise<Response>((_resolve, reject) => {
            signal?.addEventListener('abort', () => reject(signal.reason));
          })
        : undefined
    );
    await startWorkspace();
    await showTab();

    expect(valuesReads()).toContain(scope);
    expect(view.container.textContent).toContain('Loading values...');
  });

  it('reads nothing and says data is paused while auto-refresh is off', async () => {
    app.preferences({ autoRefreshEnabled: false });
    await startWorkspace();
    await showTab();

    expect(view.container.textContent).not.toContain('Loading values...');
    expect(view.container.textContent).toContain('Auto-refresh is disabled');
    expect(valuesReads()).toEqual([]);
  });

  it('shows the backend failure when the values cannot be read', async () => {
    app.snapshots.fail(
      'object-helm-values',
      scope,
      makeErrorStatus('ServiceUnavailable', 'connection refused')
    );
    await startWorkspace();
    await showTab();

    expect(view.container.textContent).toContain('Error loading values: connection refused');
    // The refresh layer also reports the failed read once.
    expect(
      app.errors.take(
        (record) =>
          record.kinds.includes('toast') && record.context?.domain === 'object-helm-values'
      )
    ).toHaveLength(1);
  });
});
