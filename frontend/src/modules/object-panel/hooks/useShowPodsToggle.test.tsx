/**
 * frontend/src/modules/object-panel/hooks/useShowPodsToggle.test.tsx
 *
 * The "Show Pods" table toggle: a per-view remembered preference under which
 * activating a workload or node row shows its pods in the Pods dock tab.
 */

import {
  PodsPanelStateProvider,
  type PodsPanelStateValue,
  useOptionalPodsPanelState,
} from '@modules/object-panel/contexts/PodsPanelStateContext';
import {
  buildRequiredCanonicalObjectRowKey,
  buildRequiredObjectReference,
} from '@shared/utils/objectIdentity';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getShowPods, resetAppPreferencesCacheForTesting } from '@/core/settings/appPreferences';
import { makeResourceRef } from '@/test-utils/makeResourceRef';
import { requireValue } from '@/test-utils/requireValue';
import { type ShowPodsToggle, useShowPodsToggle } from './useShowPodsToggle';

vi.mock('@core/desktop-runtime', () => ({
  desktopRuntimeAvailable: () => false,
  onEvent: vi.fn(),
}));

vi.mock('@modules/kubernetes/config/KubeconfigContext', () => ({
  useKubeconfig: () => ({ selectedClusterId: 'alpha:ctx', managedClusterIds: ['alpha:ctx'] }),
}));

type View = 'workloads' | 'nodes';
const results: Partial<Record<View, ShowPodsToggle>> = {};
const podsTab: { current: PodsPanelStateValue | null } = { current: null };

const Harness: React.FC<{ view: View }> = ({ view }) => {
  results[view] = useShowPodsToggle(view);
  return null;
};
const PodsTabProbe: React.FC = () => {
  podsTab.current = useOptionalPodsPanelState();
  return null;
};

const table = (view: View) => requireValue(results[view], `expected the ${view} toggle`);
const clickToggle = (view: View) => {
  const item = table(view).toggle;
  if (item.type !== 'toggle') {
    throw new Error('expected an icon-bar toggle');
  }
  act(() => item.onClick());
};
const toggleActive = (view: View) => {
  const item = table(view).toggle;
  return item.type === 'toggle' && item.active;
};

const deployment = buildRequiredObjectReference(
  makeResourceRef({
    group: 'apps',
    kind: 'Deployment',
    resource: 'deployments',
    namespace: 'team-a',
    name: 'api',
  })
);
const standalonePod = buildRequiredObjectReference(
  makeResourceRef({ kind: 'Pod', resource: 'pods', namespace: 'team-a', name: 'debug' })
);
const node = buildRequiredObjectReference(
  makeResourceRef({ kind: 'Node', resource: 'nodes', name: 'worker-1' })
);

describe('useShowPodsToggle', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    resetAppPreferencesCacheForTesting();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    act(() => {
      root.render(
        <PodsPanelStateProvider>
          <Harness view="workloads" />
          <Harness view="nodes" />
          <PodsTabProbe />
        </PodsPanelStateProvider>
      );
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('starts on and remembers the toggle per view', () => {
    expect(toggleActive('workloads')).toBe(true);
    expect(toggleActive('nodes')).toBe(true);

    clickToggle('workloads');

    expect(toggleActive('workloads')).toBe(false);
    expect(toggleActive('nodes')).toBe(true);
    expect(getShowPods('workloads')).toBe(false);
    expect(getShowPods('nodes')).toBe(true);
  });

  it('shows the pods of objects that have a Pods tab, only while the toggle is on', () => {
    act(() => table('workloads').showPods?.(deployment));

    expect(podsTab.current?.target).toMatchObject({
      object: { kind: 'Deployment', name: 'api' },
      source: 'workloads',
    });
    expect(table('workloads').shownRowKey).toBe(buildRequiredCanonicalObjectRowKey(deployment));
    expect(table('nodes').shownRowKey).toBeNull();

    // A standalone Pod has no pods of its own; the tab keeps its object.
    act(() => table('workloads').showPods?.(standalonePod));
    expect(podsTab.current?.target?.object.name).toBe('api');

    clickToggle('workloads');
    expect(table('workloads').showPods).toBeUndefined();
  });

  it('closes the Pods tab a table opened when that table’s toggle turns off', () => {
    act(() => table('nodes').showPods?.(node));

    // The Workloads toggle did not open the tab, so turning it off leaves it.
    clickToggle('workloads');
    expect(podsTab.current?.target?.object.name).toBe('worker-1');

    clickToggle('nodes');
    expect(podsTab.current?.target).toBeNull();
  });
});
