/**
 * frontend/src/modules/object-panel/hooks/useShowPodsToggle.test.tsx
 *
 * The "Show Pods" table toggle: a per-view remembered preference that makes
 * opening a workload or node land on its object panel's Pods tab.
 */

import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getShowPods, resetAppPreferencesCacheForTesting } from '@/core/settings/appPreferences';
import { requireValue } from '@/test-utils/requireValue';
import { type ShowPodsToggle, useShowPodsToggle } from './useShowPodsToggle';

vi.mock('@core/desktop-runtime', () => ({
  desktopRuntimeAvailable: () => false,
  onEvent: vi.fn(),
}));

const results: Partial<Record<'workloads' | 'nodes', ShowPodsToggle>> = {};

const Harness: React.FC<{ view: 'workloads' | 'nodes' }> = ({ view }) => {
  results[view] = useShowPodsToggle(view);
  return null;
};

const toggleOf = (view: 'workloads' | 'nodes') => {
  const item = requireValue(results[view], `expected ${view} toggle`).toggle;
  if (item.type !== 'toggle') {
    throw new Error('expected an icon-bar toggle');
  }
  return item;
};

describe('useShowPodsToggle', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    resetAppPreferencesCacheForTesting();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const render = () =>
    act(() => {
      root.render(
        <>
          <Harness view="workloads" />
          <Harness view="nodes" />
        </>
      );
    });

  it('remembers the toggle per view', () => {
    render();
    expect(toggleOf('workloads').active).toBe(false);
    expect(toggleOf('nodes').active).toBe(false);

    act(() => toggleOf('workloads').onClick());

    expect(toggleOf('workloads').active).toBe(true);
    expect(toggleOf('nodes').active).toBe(false);
    expect(getShowPods('workloads')).toBe(true);
    expect(getShowPods('nodes')).toBe(false);
  });

  it('opens objects that have a Pods tab on that tab only while the toggle is on', () => {
    render();
    const workloads = () => requireValue(results.workloads, 'expected workloads toggle');
    const nodes = () => requireValue(results.nodes, 'expected nodes toggle');
    expect(workloads().openOptions('Deployment')).toBeUndefined();

    act(() => toggleOf('workloads').onClick());
    act(() => toggleOf('nodes').onClick());

    for (const kind of ['Deployment', 'StatefulSet', 'DaemonSet', 'Job', 'CronJob', 'ReplicaSet']) {
      expect(workloads().openOptions(kind)).toEqual({ initialTab: 'pods' });
    }
    expect(nodes().openOptions('Node')).toEqual({ initialTab: 'pods' });
    // A standalone Pod has no Pods tab, so it opens on Details as usual.
    expect(workloads().openOptions('Pod')).toBeUndefined();
  });
});
