import { ZoomProvider } from '@core/contexts/ZoomContext';
import { getYamlPanelBlockReason } from '@modules/object-panel/components/ObjectPanel/Yaml/yamlPanelGuard';
import { useYamlTransaction } from '@modules/object-panel/components/ObjectPanel/Yaml/yamlTransaction';
import DockablePanel from '@ui/dockable/DockablePanel';
import { DockablePanelProvider, useDockablePanelContext } from '@ui/dockable/DockablePanelProvider';
import { PanelErrorBoundary } from '@ui/errors/PanelErrorBoundary';
import { KeyboardProvider } from '@ui/shortcuts/context';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import {
  PanelLifecycleGuardProvider,
  usePanelLifecycleGuard,
  usePanelLifecycleGuardRegistry,
} from '@/core/panel-windows/panelLifecycleGuards';
import { DockablePanelTestHost } from '@/test-utils/DockablePanelTestHost';
import { requireValue } from '@/test-utils/requireValue';

vi.mock('@core/backend-api', () => ({
  GetZoomLevel: vi.fn().mockResolvedValue(100),
  SetZoomLevel: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/utils/errorHandler', () => ({
  errorHandler: { warn: vi.fn(), handle: vi.fn() },
  reportOperationalError: vi.fn(),
}));
vi.mock('@modules/kubernetes/config/KubeconfigContext', () => ({
  useKubeconfig: vi.fn(() => ({
    selectedClusterId: 'cluster-a',
    selectedClusterIds: ['cluster-a'],
  })),
}));
vi.mock('@/core/data-access', () => ({
  requestRefreshDomain: vi.fn().mockResolvedValue(undefined),
  setRefreshDomainEnabled: vi.fn(),
  readObjectYAMLForRef: vi.fn(),
  requestData: vi.fn(),
}));

const transactions = new Map<string, ReturnType<typeof useYamlTransaction>>();
let dock: ReturnType<typeof useDockablePanelContext>;
let guards: ReturnType<typeof usePanelLifecycleGuardRegistry>;
const passthrough = (yaml: string) => yaml;
const seed = (id: string) =>
  `apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: ${id}\n  namespace: default\n  uid: ${id}-uid\n  resourceVersion: "1"\ndata:\n  value: initial\n`;
const draft = (id: string) => seed(id).replace('initial', 'unsaved-change');

function Editor({ id }: { id: string }) {
  const tx = useYamlTransaction({
    scope: `cluster-a|default:/v1:ConfigMap:${id}`,
    isActive: true,
    canEdit: true,
    clusterId: 'cluster-a',
    yamlContent: seed(id),
    prepareVisibleDraftYaml: passthrough,
  });
  transactions.set(id, tx);
  usePanelLifecycleGuard(id, () => {
    const reason = getYamlPanelBlockReason({
      isEditing: tx.isEditing,
      isSaving: tx.isSaving,
      draftYaml: tx.draftYaml,
      baselineYaml: seed(id),
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
let root: ReactDOM.Root;
let host: HTMLDivElement;
let currentItems: Item[];
async function draw(items: Item[]) {
  currentItems = items;
  await act(async () =>
    root.render(
      <KeyboardProvider>
        <PanelLifecycleGuardProvider>
          <DockablePanelProvider>
            <ZoomProvider>
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
            </ZoomProvider>
          </DockablePanelProvider>
        </PanelLifecycleGuardProvider>
      </KeyboardProvider>
    )
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
  host = document.createElement('div');
  document.body.appendChild(host);
  root = ReactDOM.createRoot(host);
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
afterEach(async () => {
  if (root) {
    await act(async () => root.unmount());
  }
  document.body.replaceChildren();
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
  } finally {
    errors.mockRestore();
  }
});
