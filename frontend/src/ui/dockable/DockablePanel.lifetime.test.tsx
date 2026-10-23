/**
 * frontend/src/ui/dockable/DockablePanel.lifetime.test.tsx
 *
 * Moving, closing, and reordering dock tabs keeps every other tab's YAML
 * draft and its lifecycle guard. Runs inside the production shell (keyboard,
 * zoom, cluster selection, and the real lifecycle guard registry), with only
 * the backend boundary faked (test-utils/appState).
 */

import { getYamlPanelBlockReason } from '@modules/object-panel/components/ObjectPanel/Yaml/yamlPanelGuard';
import { useYamlTransaction } from '@modules/object-panel/components/ObjectPanel/Yaml/yamlTransaction';
import DockablePanel from '@ui/dockable/DockablePanel';
import { DockablePanelProvider, useDockablePanelContext } from '@ui/dockable/DockablePanelProvider';
import { PanelErrorBoundary } from '@ui/errors/PanelErrorBoundary';
import { act } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import {
  usePanelLifecycleGuard,
  usePanelLifecycleGuardRegistry,
} from '@/core/panel-windows/panelLifecycleGuards';
import {
  installAppStateHarness,
  type MountedApp,
  type TestCluster,
} from '@/test-utils/appState/harness';
import { DockablePanelTestHost } from '@/test-utils/DockablePanelTestHost';
import { requireValue } from '@/test-utils/requireValue';

const app = installAppStateHarness();
let view: MountedApp;
let dev: TestCluster;

const transactions = new Map<string, ReturnType<typeof useYamlTransaction>>();
let dock: ReturnType<typeof useDockablePanelContext>;
let guards: ReturnType<typeof usePanelLifecycleGuardRegistry>;
const passthrough = (yaml: string) => yaml;
const seed = (id: string) =>
  `apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: ${id}\n  namespace: default\n  uid: ${id}-uid\n  resourceVersion: "1"\ndata:\n  value: initial\n`;
const draft = (id: string) => seed(id).replace('initial', 'unsaved-change');

const configMap = (id: string) =>
  app.object(dev, { group: '', version: 'v1', kind: 'ConfigMap', namespace: 'default', name: id });

function Editor({ id }: { id: string }) {
  const tx = useYamlTransaction({
    scope: configMap(id).scopes.detailScope,
    isActive: true,
    canEdit: true,
    clusterId: dev.clusterId,
    yamlContent: seed(id),
    prepareVisibleDraftYaml: passthrough,
  });
  transactions.set(id, tx);
  usePanelLifecycleGuard(id, () => {
    const reason = getYamlPanelBlockReason({
      isEditing: tx.isEditing,
      isSaving: tx.isSaving,
      hasUnsavedEdits: tx.hasUnsavedEdits,
    });
    return reason ? { reason, focus: () => undefined } : null;
  });
  return <output data-editor={id}>{tx.draftYaml}</output>;
}
function Probe() {
  dock = useDockablePanelContext();
  guards = usePanelLifecycleGuardRegistry();
  return null;
}
type Item = { id: string; position?: 'right' | 'bottom'; broken?: boolean };
function BrokenContent(): never {
  throw new Error('failed object content');
}
let currentItems: Item[];
async function draw(items: Item[]) {
  currentItems = items;
  await view.show(
    <DockablePanelProvider>
      <DockablePanelTestHost />
      <Probe />
      {items.map(({ id, position, broken }) => (
        <PanelErrorBoundary key={id} panelName={id} onClose={() => undefined}>
          <DockablePanel
            panelId={id}
            title={id}
            isOpen
            defaultPosition={position ?? 'right'}
            onClose={() => {
              void draw(currentItems.filter((item) => item.id !== id));
            }}
          >
            {broken ? <BrokenContent /> : <Editor id={id} />}
          </DockablePanel>
        </PanelErrorBoundary>
      ))}
    </DockablePanelProvider>
  );
}
async function start(items: Item[]) {
  const content = document.createElement('div');
  content.className = 'content';
  const body = document.createElement('div');
  body.className = 'content-body';
  content.appendChild(body);
  content.getBoundingClientRect = () =>
    DOMRect.fromRect({ x: 0, y: 0, width: window.innerWidth, height: window.innerHeight });
  document.body.appendChild(content);
  dev = app.cluster({ name: 'dev', context: 'alpha' });
  app.namespaces(dev, ['default']);
  // Every tab a test opens reads its object's YAML.
  for (const id of ['a', 'b', 'c']) {
    app.snapshots.serve('object-yaml', configMap(id).scopes.detailScope ?? '', {
      clusterId: dev.clusterId,
      clusterName: dev.clusterName,
      yaml: seed(id),
    });
  }
  view = await app.render(null);
  await draw(items);
}
async function edit(id: string) {
  await act(async () =>
    requireValue(transactions.get(id), 'mounted YAML transaction').handleEnterEdit()
  );
  await act(async () =>
    requireValue(transactions.get(id), 'mounted YAML transaction').handleEditorChange(draft(id))
  );
}
afterEach(() => {
  document.querySelectorAll('.content').forEach((node) => {
    node.remove();
  });
  transactions.clear();
});

it('preserves an existing YAML draft when a second object tab opens', async () => {
  await start([{ id: 'a' }]);
  await edit('a');
  expect(requireValue(transactions.get('a'), 'edited transaction').draftYaml).toBe(draft('a'));
  expect(guards.firstBlocker(['a'])?.reason).toBe('unsaved-yaml');
  await draw([{ id: 'a' }, { id: 'b' }]);
  expect
    .soft(requireValue(transactions.get('a'), 'mounted YAML transaction').draftYaml)
    .toBe(draft('a'));
  expect.soft(guards.firstBlocker(['a'])?.reason).toBe('unsaved-yaml');
});
it('preserves a sibling YAML draft when the clean group leader closes', async () => {
  await start([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
  await edit('b');
  expect(requireValue(transactions.get('b'), 'edited transaction').draftYaml).toBe(draft('b'));
  expect(guards.firstBlocker(['b'])?.reason).toBe('unsaved-yaml');
  await act(async () => dock.closeTab('a'));
  expect
    .soft(requireValue(transactions.get('b'), 'mounted YAML transaction').draftYaml)
    .toBe(draft('b'));
  expect.soft(guards.firstBlocker(['b'])?.reason).toBe('unsaved-yaml');
});
it('preserves an existing target draft when a clean tab moves into its group', async () => {
  await start([
    { id: 'a', position: 'right' },
    { id: 'b', position: 'bottom' },
  ]);
  await edit('b');
  expect(requireValue(transactions.get('b'), 'edited transaction').draftYaml).toBe(draft('b'));
  expect(guards.firstBlocker(['b'])?.reason).toBe('unsaved-yaml');
  await act(async () => dock.requestTabMove('a', 'bottom'));
  expect
    .soft(requireValue(transactions.get('b'), 'mounted YAML transaction').draftYaml)
    .toBe(draft('b'));
  expect.soft(guards.firstBlocker(['b'])?.reason).toBe('unsaved-yaml');
});
it('preserves a YAML draft when tabs reorder within the same group', async () => {
  await start([{ id: 'a' }, { id: 'b' }]);
  await edit('b');
  expect(requireValue(transactions.get('b'), 'edited transaction').draftYaml).toBe(draft('b'));
  expect(guards.firstBlocker(['b'])?.reason).toBe('unsaved-yaml');
  await act(async () => dock.reorderTabInGroup('right', 'b', 0));
  expect(requireValue(transactions.get('b'), 'mounted YAML transaction').draftYaml).toBe(
    draft('b')
  );
});

it('preserves the remaining draft when its last clean sibling moves out', async () => {
  await start([{ id: 'a' }, { id: 'b' }]);
  await edit('b');
  expect(requireValue(transactions.get('b'), 'edited transaction').draftYaml).toBe(draft('b'));
  expect(guards.firstBlocker(['b'])?.reason).toBe('unsaved-yaml');
  await act(async () => dock.requestTabMove('a', 'bottom'));
  expect(requireValue(transactions.get('b'), 'remaining editor').draftYaml).toBe(draft('b'));
  expect(guards.firstBlocker(['b'])?.reason).toBe('unsaved-yaml');
});

it('blocks closing or moving the dirty tab itself without losing its draft', async () => {
  await start([{ id: 'a' }, { id: 'b' }]);
  await edit('b');
  expect(requireValue(transactions.get('b'), 'edited transaction').draftYaml).toBe(draft('b'));
  expect(guards.firstBlocker(['b'])?.reason).toBe('unsaved-yaml');
  await act(async () => dock.closeTab('b'));
  await act(async () => dock.requestTabMove('b', 'bottom'));
  expect(dock.tabGroups.right.tabs).toEqual(['a', 'b']);
  expect(requireValue(transactions.get('b'), 'blocked editor').draftYaml).toBe(draft('b'));
  // Each blocked request tells the user why.
  expect(
    app.errors.take((record) => record.kinds.includes('warning')).map(({ kinds }) => kinds)
  ).toEqual([['warning'], ['warning']]);
});

it('isolates a sibling content failure without discarding another tab’s work', async () => {
  const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    await start([{ id: 'a' }, { id: 'b' }]);
    await edit('a');
    expect(requireValue(transactions.get('a'), 'edited transaction').draftYaml).toBe(draft('a'));
    expect(guards.firstBlocker(['a'])?.reason).toBe('unsaved-yaml');
    await draw([{ id: 'a' }, { id: 'b', broken: true }]);
    expect(document.querySelector('[data-editor="a"]')).not.toBeNull();
    expect(requireValue(transactions.get('a'), 'unaffected editor').draftYaml).toBe(draft('a'));
    expect(guards.firstBlocker(['a'])?.reason).toBe('unsaved-yaml');
    expect(document.querySelector('[data-editor="b"]')).toBeNull();
    // The failure is caught by its own panel's boundary and reported once.
    expect(
      app.errors
        .take((record) => record.kinds.includes('render-caught'))
        .map(({ kinds, error }) => ({ kinds, message: (error as Error).message }))
    ).toEqual([{ kinds: ['render-caught', 'toast'], message: 'failed object content' }]);
  } finally {
    errors.mockRestore();
  }
});
