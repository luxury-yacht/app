/**
 * frontend/src/shared/components/kubernetes/ResourceHeader.test.tsx
 *
 * The header every object panel's Overview opens with: Age counts up from the
 * object's creationTimestamp without new panel data, Last Modified shows what
 * the backend derived, both rows are omitted when the backend reports nothing,
 * and Alt+click on the Namespace value reveals the panel's own object (not the
 * Namespace kind) in its view. ResourceHeader reads the open panel's object
 * and timestamps, so the suite mounts the full app and opens a real panel;
 * only the backend boundary is faked (test-utils/appState).
 */

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DomainPayloadMap } from '@/core/refresh/types';
import {
  installAppStateHarness,
  type MountedApp,
  type TestCluster,
} from '@/test-utils/appState/harness';
import { objectDetailOf } from '@/test-utils/objectDetail';
import { requireValue } from '@/test-utils/requireValue';

const app = installAppStateHarness();
let dev: TestCluster;
let view: MountedApp;

const configMap = {
  group: '',
  version: 'v1',
  kind: 'ConfigMap',
  namespace: 'shop',
  name: 'web-config',
};

/** Opens the ConfigMap's panel, whose details carry these backend-derived timestamps. */
const openPanel = async (
  timestamps: Pick<DomainPayloadMap['object-details'], 'creationTimestamp' | 'lastModified'>
) => {
  const detail: Partial<DomainPayloadMap['object-details']> = {
    ...objectDetailOf('configmap', {
      name: configMap.name,
      namespace: configMap.namespace,
      usedBy: [],
    }),
    ...timestamps,
  };
  const object = app.servePanel(dev, configMap, detail);
  view = await app.mountApp();
  await act(async () => {
    view.owners().objectPanel.openWithObject(object.ref);
  });
  await app.settle();
};

const rowValue = (label: string) => {
  const labelElement = Array.from(
    view.container.querySelectorAll<HTMLElement>('.object-panel-body .overview-label')
  ).find((element) => element.textContent === label);
  return labelElement?.parentElement?.querySelector<HTMLElement>('.overview-value') ?? null;
};

beforeEach(() => {
  dev = app.cluster({ name: 'dev', context: 'alpha' });
  app.namespaces(dev, ['default', 'shop']);
  app.startScreen(dev);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ResourceHeader', () => {
  it('counts Age up from the object’s creationTimestamp without new panel data', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:10Z'));
    await openPanel({ creationTimestamp: '2026-01-01T00:00:00Z' });
    const detailReads = app.snapshots.reads('object-details').length;
    expect(rowValue('Age')?.textContent).toBe('10s');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });

    expect(rowValue('Age')?.textContent).toBe('11s');
    expect(app.snapshots.reads('object-details')).toHaveLength(detailReads);
  });

  it('shows the Last Modified time the backend derived', async () => {
    await openPanel({ creationTimestamp: '2020-01-01T00:00:00Z', lastModified: '2h' });

    expect(rowValue('Last Modified')?.textContent).toBe('2h');
  });

  it('omits Age and Last Modified when the backend reports neither', async () => {
    await openPanel({});

    expect(rowValue('Name')?.textContent).toBe(configMap.name);
    expect(rowValue('Age')).toBeNull();
    expect(rowValue('Last Modified')).toBeNull();
  });

  it('reveals the panel’s own object, not the Namespace kind, on Alt+click of its namespace', async () => {
    // The object's namespace view lists it.
    app.serveTable(dev, 'namespace-config');
    await openPanel({});
    const namespaceLink = requireValue(
      rowValue('Namespace')?.querySelector<HTMLElement>('.object-panel-link'),
      'expected the namespace link'
    );

    await act(async () => {
      namespaceLink.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true, altKey: true })
      );
    });
    await app.settle();

    // Not Cluster → Namespaces, where a { kind: 'Namespace' } ref routes.
    const { viewState, namespace } = view.owners();
    expect(viewState?.viewType).toBe('namespace');
    expect(viewState?.activeNamespaceTab).toBe('config');
    expect(namespace.selectedNamespace).toBe('shop');
    expect(view.openPanels()).toEqual([
      { ...configMap, clusterId: dev.clusterId, clusterName: dev.clusterName },
    ]);
  });
});
