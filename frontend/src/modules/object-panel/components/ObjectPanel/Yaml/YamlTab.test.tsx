/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Yaml/YamlTab.test.tsx
 *
 * The object panel's YAML tab: it shows the object's YAML snapshot through the
 * real refresh lease and store, pauses that refresh while editing, and saves,
 * verifies, and reloads-and-merges edits through the YAML RPCs, showing every
 * outcome in the editor. YamlTab takes its scope, cluster, and edit capability
 * as props; it reads CurrentObjectPanelContext only for the unsaved-edit
 * guard's panel id (YamlTab.tsx:596), which no assertion here depends on, so
 * the suite runs in provider mode inside the real app shell. Only the backend
 * boundary is faked (test-utils/appState); the CodeMirror editor and its
 * extension modules are stubbed to reach the editor's value, extensions, and
 * view. Keyboard and Edit-menu routing lives in YamlTab.shortcuts.test.tsx.
 */

import { Clipboard } from '@wailsio/runtime';
import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parse as parseYaml } from 'yaml';
import type { CatalogItem, ErrorStatus } from '@/core/refresh/types';
import {
  installAppStateHarness,
  type MountedApp,
  type TestCluster,
} from '@/test-utils/appState/harness';
import {
  type BackendArgs,
  type SnapshotRequest,
  snapshotResponse,
} from '@/test-utils/appState/transport';
import { makeErrorStatus } from '@/test-utils/errorStatusFixtures';
import { requireValue } from '@/test-utils/requireValue';
import { useObjectDiffYaml } from '@/ui/modals/useObjectDiffYaml';
import YamlTab from './YamlTab';

interface CapturedCodeMirrorProps {
  value: string;
  extensions: unknown[];
  onChange: (value: string) => void;
  onCreateEditor?: (view: unknown) => void;
  ref?: React.Ref<unknown>;
}

type SelectionRange = { from: number; to: number };

interface CodeMirrorHarness {
  latestProps: { current: Omit<CapturedCodeMirrorProps, 'ref' | 'onCreateEditor'> };
  editorView: {
    state: {
      selection: { main: SelectionRange; ranges?: SelectionRange[] };
      sliceDoc: (from?: number, to?: number) => string;
    };
    dispatch: (transaction: unknown) => void;
    focus: () => void;
  };
  value: string;
}

const codeMirrorState = vi.hoisted(
  (): CodeMirrorHarness => ({
    latestProps: { current: { value: '', extensions: [], onChange: () => undefined } },
    editorView: {
      state: {
        selection: { main: { from: 0, to: 0 }, ranges: [] },
        sliceDoc: () => '',
      },
      dispatch: () => undefined,
      focus: () => undefined,
    },
    value: '',
  })
);

const codemirrorSearchMocks = vi.hoisted(() => {
  class SearchQuery {
    search!: string;
    caseSensitive!: boolean;
    literal!: boolean;
    regexp!: boolean;
    wholeWord!: boolean;
    replace!: string;

    constructor(options: {
      search: string;
      caseSensitive: boolean;
      literal: boolean;
      regexp: boolean;
      wholeWord: boolean;
      replace: string;
    }) {
      Object.assign(this, options);
    }
  }

  return {
    SearchQuery,
    findNext: vi.fn(),
    findPrevious: vi.fn(),
    getSearchQuery: vi.fn(() => ({
      search: '',
      caseSensitive: false,
      literal: false,
      regexp: false,
      wholeWord: false,
      replace: '',
    })),
    setSearchQuery: {
      of: vi.fn((query: unknown) => query),
    },
  };
});

// The code editor: renders its value and hands the editor its stand-in view.
vi.mock('@uiw/react-codemirror', () => {
  const CodeMirrorMock = ({ ref, ...props }: CapturedCodeMirrorProps) => {
    const { onCreateEditor } = props;
    codeMirrorState.value = props.value;
    codeMirrorState.latestProps.current = props;
    if (ref && typeof ref === 'object') {
      (ref as React.RefObject<unknown>).current = { view: codeMirrorState.editorView };
    }
    React.useEffect(() => {
      onCreateEditor?.(codeMirrorState.editorView);
    }, [onCreateEditor]);
    return (
      <div data-testid="code-mirror" data-value={props.value}>
        {props.value}
      </div>
    );
  };
  return { __esModule: true, default: CodeMirrorMock, ExternalChange: {} };
});

vi.mock('@codemirror/lang-yaml', () => ({
  yaml: () => 'yaml-extension',
}));

vi.mock('@codemirror/view', () => ({
  Decoration: {
    mark: () => ({
      range: (from: number, to: number) => ({ from, to }),
    }),
    set: (ranges: unknown[]) => ranges,
  },
  EditorView: Object.assign(class EditorViewMock {}, {
    decorations: {
      of: (decorations: unknown) => decorations,
      compute: (_dependencies: unknown, compute: unknown) => ({
        type: 'computedDecorations',
        compute,
      }),
    },
    contentAttributes: {
      of: (attrs: unknown) => ({ type: 'contentAttributes', attrs }),
    },
    domEventHandlers(handlers: unknown) {
      return handlers;
    },
    lineWrapping: 'lineWrapping',
  }),
  keymap: {
    of: (bindings: unknown) => bindings,
  },
}));

vi.mock('@codemirror/state', () => ({
  EditorSelection: {
    cursor: (position: number) => ({ cursor: position }),
  },
  EditorState: {
    transactionFilter: {
      of: (filter: unknown) => filter,
    },
  },
}));

vi.mock('@codemirror/search', () => ({
  SearchQuery: codemirrorSearchMocks.SearchQuery,
  findNext: codemirrorSearchMocks.findNext,
  findPrevious: codemirrorSearchMocks.findPrevious,
  getSearchQuery: codemirrorSearchMocks.getSearchQuery,
  setSearchQuery: codemirrorSearchMocks.setSearchQuery,
}));

vi.mock('@/core/codemirror/theme', () => ({
  buildCodeTheme: () => ({ theme: 'dark', highlight: 'highlight-ext' }),
}));

vi.mock('@/core/codemirror/search', () => ({
  createSearchExtensions: () => ['search-ext'],
  closeSearchPanel: () => undefined,
}));

const YAML = `
apiVersion: v1
kind: Pod
metadata:
  name: demo
  namespace: default
  resourceVersion: "123"
  managedFields:
    - manager: kubelet
spec:
  containers:
    - name: demo
      image: demo:v1
`.trim();

const UPDATED_YAML = `
apiVersion: v1
kind: Pod
metadata:
  name: demo
  namespace: default
  resourceVersion: "123"
spec:
  containers:
    - name: demo
      image: demo:v2
`.trim();

const SECOND_UPDATED_YAML = `
apiVersion: v1
kind: Pod
metadata:
  name: demo
  namespace: default
  resourceVersion: "789"
spec:
  containers:
    - name: demo
      image: demo:v3
`.trim();

const POST_APPLY_MUTATED_YAML = `
apiVersion: v1
kind: Pod
metadata:
  name: demo
  namespace: default
  resourceVersion: "789"
spec:
  containers:
    - name: demo
      image: demo:v2
  restartPolicy: Always
`.trim();

const VERIFIED_APPLIED_YAML = `
apiVersion: v1
kind: Pod
metadata:
  name: demo
  namespace: default
  resourceVersion: "789"
spec:
  containers:
    - name: demo
      image: demo:v2
`.trim();

const VERIFIED_APPLIED_YAML_WITH_GENERATED_ANNOTATION = `
apiVersion: v1
kind: Pod
metadata:
  name: demo
  namespace: default
  resourceVersion: "789"
  annotations:
    deployment.kubernetes.io/revision: "3"
spec:
  containers:
    - name: demo
      image: demo:v2
`.trim();

const SECOND_VERIFIED_APPLIED_YAML = `
apiVersion: v1
kind: Pod
metadata:
  name: demo
  namespace: default
  resourceVersion: "790"
spec:
  containers:
    - name: demo
      image: demo:v3
`.trim();

const LATER_MUTATED_YAML = `
apiVersion: v1
kind: Pod
metadata:
  name: demo
  namespace: default
  resourceVersion: "790"
spec:
  containers:
    - name: demo
      image: demo:v2
  restartPolicy: Always
`.trim();

const VERIFIED_APPLIED_YAML_WITH_UID = `
apiVersion: v1
kind: Pod
metadata:
  name: demo
  namespace: default
  uid: pod-uid-1
  resourceVersion: "789"
spec:
  containers:
    - name: demo
      image: demo:v2
`.trim();

const REPLACEMENT_POD_YAML = `
apiVersion: v1
kind: Pod
metadata:
  name: demo
  namespace: default
  uid: pod-uid-2
  resourceVersion: "790"
spec:
  containers:
    - name: demo
      image: demo:v2
  restartPolicy: Always
`.trim();

const app = installAppStateHarness();

const pod = { group: '', version: 'v1', kind: 'Pod', namespace: 'default', name: 'demo' };

let dev: TestCluster;
let view: MountedApp;
let scope: string;

type TabProps = Partial<{
  scope: string | null;
  isActive: boolean;
  canEdit: boolean;
  editDisabledReason: string | null;
}>;

/** backend/refresh/snapshot/object_content.go: the object's YAML snapshot. */
const serveYaml = (yaml: string) => {
  app.snapshots.serve('object-yaml', scope, {
    clusterId: dev.clusterId,
    clusterName: dev.clusterName,
    yaml,
  });
};

/**
 * Mirrors the Wails runtime: a bound method's returned error rejects with a
 * RuntimeError whose cause is the backend's status
 * (backend/internal/errorstatus).
 */
const rejectedWithStatus = (
  status: Partial<ErrorStatus> & Pick<ErrorStatus, 'reason' | 'category'>
) => {
  const error = new Error(status.message ?? 'request failed');
  error.name = 'RuntimeError';
  (error as Error & { cause?: unknown }).cause = {
    kind: 'Status',
    apiVersion: 'v1',
    code: 422,
    message: error.message,
    retryable: false,
    expected: false,
    ...status,
  };
  return error;
};

/** backend/object_yaml_mutation.go ApplyObjectYaml: the patched object's resourceVersion. */
const answerApply = (resourceVersion: string) => {
  app.backend.answer('ApplyObjectYaml', () => ({ resourceVersion }));
};

/** backend/object_yaml_by_gvk.go GetObjectYAMLByGVK: the live object's YAML. */
const answerLiveYaml = (...yamls: string[]) => {
  let read = 0;
  app.backend.answer('GetObjectYAMLByGVK', () => {
    const yaml = yamls[Math.min(read, yamls.length - 1)] ?? '';
    read += 1;
    return yaml;
  });
};

/** backend/object_yaml_ownership.go CheckObjectYamlOwnership: contested fields. */
const answerOwnership = (conflicts: Array<{ field: string; manager: string; message: string }>) => {
  app.backend.answer('CheckObjectYamlOwnership', () => ({ conflicts }));
};

const applyCalls = (): BackendArgs<'ApplyObjectYaml'>[] => app.backend.calls('ApplyObjectYaml');

const tab = (props: TabProps = {}) => (
  <YamlTab scope={scope} isActive canEdit clusterId={dev.clusterId} {...props} />
);

const renderYamlTab = async (props: TabProps = {}) => {
  view = await app.render(null);
  await view.show(tab(props));
  return {
    container: view.container,
    rerender: (next: TabProps = {}) => view.show(tab({ ...props, ...next })),
  };
};

const activate = async (run: () => void) => {
  await act(async () => {
    run();
  });
  await app.settle();
};

const getIconButton = (label: string) =>
  view.container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);

const clickButton = async (label: string) => {
  const button = requireValue(getIconButton(label), `expected the ${label} button`);
  await activate(() => button.click());
};

const clickText = async (text: string) => {
  const button = requireValue(
    Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find((candidate) =>
      candidate.textContent?.includes(text)
    ),
    `expected the ${text} button`
  );
  await activate(() => button.click());
};

const typeDraft = (yaml: string) =>
  activate(() => codeMirrorState.latestProps.current.onChange(yaml));

const editTo = async (yaml: string) => {
  await clickButton('Edit YAML');
  await typeDraft(yaml);
};

const save = () => clickButton('Save YAML');

const yamlReads = () => app.snapshots.reads('object-yaml').filter((read) => read.scope === scope);

const buttonWithText = (text: string) =>
  Array.from(view.container.querySelectorAll('button')).find((button) =>
    button.textContent?.includes(text)
  );

const driftRowElement = (field: string) =>
  Array.from(
    view.container.querySelectorAll<HTMLTableRowElement>('.yaml-drift-notice tbody tr')
  ).find((candidate) => candidate.cells[0]?.textContent?.startsWith(field));

// The drift table's columns: field, before, theirs, yours.
const THEIRS_CELL = 2;
const YOURS_CELL = 3;

// A value the row offers to keep: a pressable chip in that value's cell.
const rowOption = (row: HTMLTableRowElement, cell: number) =>
  row.cells[cell]?.querySelector<HTMLButtonElement>('button[aria-pressed]') ?? null;

const isPressed = (option: HTMLButtonElement) => option.getAttribute('aria-pressed') === 'true';

/**
 * The drift notice's row for `field`: its value when editing began, theirs, and
 * yours, and the choice the row offers: undefined when it needs none, null
 * while undecided, or the option that is checked.
 */
const driftRow = (field: string) => {
  const row = driftRowElement(field);
  if (!row) {
    return undefined;
  }
  const theirs = rowOption(row, THEIRS_CELL);
  const yours = rowOption(row, YOURS_CELL);
  let choice: 'theirs' | 'yours' | null | undefined;
  if (theirs && yours) {
    choice = isPressed(theirs) ? 'theirs' : isPressed(yours) ? 'yours' : null;
  }
  return {
    values: Array.from(row.cells)
      .slice(1, 4)
      .map((cell) => cell.textContent?.trim()),
    choice,
  };
};

/** Picks theirs or yours in the conflicting `field`'s row. */
const chooseInRow = async (field: string, choice: 'theirs' | 'yours') => {
  const row = requireValue(driftRowElement(field), `expected the ${field} row`);
  const option = requireValue(
    rowOption(row, choice === 'theirs' ? THEIRS_CELL : YOURS_CELL),
    `expected the ${choice} option on ${field}`
  );
  await activate(() => option.click());
};

/** The text of the elements that describe `element` to assistive technology. */
const describedText = (element: Element) =>
  (element.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .map((id) => document.getElementById(id)?.textContent ?? '')
    .join(' ');

/**
 * Serves `yaml` as the object's live YAML and lets the tab's next poll read it
 * (`object-yaml` polls every 5 s: core/refresh/types.generated.ts). Needs fake
 * timers from before the render.
 */
const pollLiveYaml = async (yaml: string) => {
  serveYaml(yaml);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5_000);
  });
  await app.settle();
};

/** Serves `yaml` as the object's next YAML snapshot and has the tab read it. */
const deliverSnapshot = async (rerender: (next?: TabProps) => Promise<void>, yaml: string) => {
  serveYaml(yaml);
  // Returning to the YAML tab rereads the object's YAML.
  await rerender({ isActive: false });
  await rerender({ isActive: true });
  await app.settle();
};

/**
 * The object diff (ui/modals/useObjectDiffYaml.ts) of the same object shares
 * the YAML tab's scope; while it is open it keeps reading that scope, also
 * while the tab is editing.
 */
function ObjectDiffOfSameObject() {
  const item: CatalogItem = {
    ref: { clusterId: dev.clusterId, resource: 'pods', uid: '', ...pod },
    resourceVersion: '',
    creationTimestamp: '',
    scope: 'Namespace',
  };
  useObjectDiffYaml(item, true);
  return null;
}

/** Opens the object's diff while editing, which reads `yaml` as the live YAML. */
const openObjectDiffReading = async (yaml: string, props: TabProps = {}) => {
  serveYaml(yaml);
  await view.show(
    <>
      {tab(props)}
      <ObjectDiffOfSameObject />
    </>
  );
  await app.settle();
};

const takeReports = (action: string) =>
  app.errors.take((record) => record.context?.action === action).map(({ kinds }) => kinds);

beforeEach(() => {
  dev = app.cluster({ name: 'dev', context: 'alpha' });
  app.namespaces(dev, ['default']);
  scope = requireValue(app.object(dev, pod).scopes.detailScope, 'expected the pod scope');
  serveYaml(YAML);
  answerOwnership([]);
  // The Wails runtime's Clipboard.SetText resolves once the text is copied.
  vi.mocked(Clipboard.SetText).mockReset().mockResolvedValue(undefined);
  codeMirrorState.value = '';
  codeMirrorState.editorView.state.selection = { main: { from: 0, to: 0 }, ranges: [] };
  codeMirrorState.editorView.dispatch = vi.fn();
  codeMirrorState.editorView.focus = vi.fn();
  codemirrorSearchMocks.findNext.mockClear();
  codemirrorSearchMocks.findPrevious.mockClear();
  codemirrorSearchMocks.setSearchQuery.of.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('YamlTab', () => {
  it('hides managedFields until they are shown', async () => {
    await renderYamlTab();
    expect(codeMirrorState.value).not.toContain('managedFields');

    await clickButton('Show managedFields');

    expect(codeMirrorState.value).toContain('managedFields');
  });

  it('wraps YAML lines by default from the toggle next to managedFields', async () => {
    const { container } = await renderYamlTab();
    const toolbarButtons = Array.from(
      container.querySelectorAll<HTMLButtonElement>('.yaml-editor-toolbar .icon-bar-button')
    );
    const managedFieldsIndex = toolbarButtons.findIndex(
      (button) => button.getAttribute('aria-label') === 'Show managedFields'
    );
    const wrapButton = getIconButton('Wrap YAML lines');

    expect(wrapButton).toBe(toolbarButtons[managedFieldsIndex + 1]);
    expect(wrapButton?.getAttribute('aria-pressed')).toBe('true');
    expect(codeMirrorState.latestProps.current.extensions).toContain('lineWrapping');

    await clickButton('Wrap YAML lines');

    expect(getIconButton('Wrap YAML lines')?.getAttribute('aria-pressed')).toBe('false');
    expect(codeMirrorState.latestProps.current.extensions).not.toContain('lineWrapping');
  });

  it('edits with managedFields only when they are shown', async () => {
    await renderYamlTab();

    await clickButton('Edit YAML');
    expect(codeMirrorState.value).not.toContain('managedFields');

    await clickButton('Cancel edit');
    await clickButton('Show managedFields');
    await clickButton('Edit YAML');

    expect(codeMirrorState.value).toContain('managedFields');
  });

  it('shows why YAML editing is not allowed', async () => {
    await renderYamlTab({
      canEdit: false,
      editDisabledReason: 'permission denied for patch pods/demo',
    });

    expect(getIconButton('Edit YAML')).toBeNull();
    const disabledEditButton = requireValue(
      getIconButton('Edit YAML unavailable: permission denied for patch pods/demo'),
      'expected the disabled Edit button'
    );
    expect(disabledEditButton.disabled).toBe(true);
    expect(disabledEditButton.title).toBe('permission denied for patch pods/demo');
  });

  // Clipboard and select-all shortcuts route to the surface holding focus.
  it('focuses the editor while the tab is active in read mode', async () => {
    const { rerender } = await renderYamlTab({ isActive: false });
    await act(async () => {
      await new Promise((resolve) => window.requestAnimationFrame(resolve));
    });
    expect(codeMirrorState.editorView.focus).not.toHaveBeenCalled();

    await rerender({ isActive: true });
    await act(async () => {
      await new Promise((resolve) => window.requestAnimationFrame(resolve));
    });

    expect(codeMirrorState.editorView.focus).toHaveBeenCalled();
  });

  it('saves the edited YAML against its baseline and rereads the object', async () => {
    answerApply('789');
    answerLiveYaml(UPDATED_YAML);
    await renderYamlTab();
    await editTo(UPDATED_YAML);
    const readsBeforeSave = yamlReads().length;

    await save();

    expect(applyCalls()).toHaveLength(1);
    const [clusterId, request] = requireValue(applyCalls()[0], 'expected the apply call');
    expect(clusterId).toBe(dev.clusterId);
    expect(request).toEqual(
      expect.objectContaining({
        apiVersion: 'v1',
        kind: 'Pod',
        namespace: 'default',
        name: 'demo',
        uid: '',
        resourceVersion: '123',
      })
    );
    expect(request.baseYAML).toContain('image: demo:v1');
    expect(request.baseYAML).not.toContain('managedFields');
    expect(request.yaml).toContain('image: demo:v2');
    expect(request.yaml).not.toContain('managedFields');
    expect(app.backend.calls('CheckObjectYamlOwnership')).toHaveLength(1);
    expect(yamlReads().length).toBeGreaterThan(readsBeforeSave);
    expect(getIconButton('Edit YAML')).not.toBeNull();
  });

  it('asks before saving fields owned by another manager', async () => {
    answerOwnership([
      { field: '.spec.replicas', manager: 'flux', message: 'conflict with "flux" using apps/v1' },
    ]);
    answerApply('789');
    answerLiveYaml(UPDATED_YAML);
    await renderYamlTab();
    await editTo(UPDATED_YAML);

    await save();

    expect(applyCalls()).toEqual([]);
    expect(document.body.textContent).toContain('flux');
    expect(document.body.textContent).toContain('spec.replicas');

    await clickText('Save anyway');

    expect(applyCalls()).toHaveLength(1);
    expect(applyCalls()[0]?.[1].yaml).toContain('image: demo:v2');
  });

  it('keeps editing without saving when the ownership warning is dismissed', async () => {
    answerOwnership([
      {
        field: '.spec.replicas',
        manager: 'kube-controller-manager',
        message: 'conflict with "kube-controller-manager" using apps/v1',
      },
    ]);
    await renderYamlTab();
    await editTo(UPDATED_YAML);
    await save();

    await clickText('Keep editing');

    expect(applyCalls()).toEqual([]);
    expect(document.body.textContent).not.toContain('Save anyway');
    expect(getIconButton('Save YAML')).not.toBeNull();
  });

  it('discards the draft from the ownership warning’s Cancel', async () => {
    answerOwnership([
      { field: '.spec.replicas', manager: 'flux', message: 'conflict with "flux" using apps/v1' },
    ]);
    await renderYamlTab();
    await editTo(UPDATED_YAML);
    await save();

    const discardButton = requireValue(
      document.querySelector<HTMLButtonElement>('.confirmation-modal-secondary-action'),
      'expected the warning’s Cancel'
    );
    expect(discardButton.textContent).toBe('Cancel');
    await activate(() => discardButton.click());

    expect(applyCalls()).toEqual([]);
    expect(document.querySelector('.confirmation-modal')).toBeNull();
    expect(getIconButton('Edit YAML')).not.toBeNull();
    expect(getIconButton('Save YAML')).toBeNull();
  });

  it('saves without asking when the ownership check fails, reporting it without a toast', async () => {
    app.backend.answer('CheckObjectYamlOwnership', () => {
      throw new Error('server-side apply not supported');
    });
    answerApply('789');
    answerLiveYaml(UPDATED_YAML);
    await renderYamlTab();
    await editTo(UPDATED_YAML);

    await save();

    expect(applyCalls()).toHaveLength(1);
    expect(takeReports('checkYamlOwnership')).toEqual([['operational']]);
  });

  it('applies to the object with the uid and resourceVersion it was edited from', async () => {
    serveYaml(VERIFIED_APPLIED_YAML_WITH_UID);
    answerApply('790');
    answerLiveYaml(SECOND_VERIFIED_APPLIED_YAML);
    await renderYamlTab();
    await editTo(SECOND_UPDATED_YAML);

    await save();

    expect(applyCalls()).toHaveLength(1);
    expect(applyCalls()[0]?.[0]).toBe(dev.clusterId);
    expect(applyCalls()[0]?.[1]).toEqual(
      expect.objectContaining({
        apiVersion: 'v1',
        kind: 'Pod',
        namespace: 'default',
        name: 'demo',
        uid: 'pod-uid-1',
        resourceVersion: '789',
      })
    );
  });

  it('blocks edits to Kubernetes-managed fields with a message while editing', async () => {
    const { container } = await renderYamlTab();
    await clickButton('Edit YAML');

    const transactionFilter = requireValue(
      codeMirrorState.latestProps.current.extensions.find(
        (extension: unknown) => typeof extension === 'function'
      ) as
        | ((transaction: {
            docChanged: boolean;
            startState: { doc: { toString: () => string } };
            changes: { iterChanges: (callback: (from: number, to: number) => void) => void };
          }) => unknown)
        | undefined,
      'expected the protected-range filter'
    );
    const editAt = (from: number, to: number) => ({
      docChanged: true,
      startState: { doc: { toString: () => codeMirrorState.value } },
      changes: {
        iterChanges: (callback: (from: number, to: number) => void) => callback(from, to),
      },
    });

    let blocked: unknown;
    await act(async () => {
      blocked = transactionFilter(editAt(0, 'apiVersion'.length));
    });
    expect(blocked).toEqual([]);
    expect(container.textContent).toContain(
      'apiVersion is managed by Kubernetes and cannot be edited.'
    );

    const kindIndex = codeMirrorState.value.indexOf('kind:');
    await act(async () => {
      blocked = transactionFilter(editAt(kindIndex, kindIndex + 'kind'.length));
    });
    expect(blocked).toEqual([]);
    expect(container.textContent).toContain('kind is managed by Kubernetes and cannot be edited.');

    const imageIndex = codeMirrorState.value.indexOf('image: demo:v1');
    const allowed = editAt(imageIndex, imageIndex);
    expect(transactionFilter(allowed)).toBe(allowed);
  });

  it('shows how the stored object differs from the submitted YAML, until dismissed', async () => {
    answerApply('789');
    answerLiveYaml(POST_APPLY_MUTATED_YAML);
    const { container } = await renderYamlTab();
    await editTo(UPDATED_YAML);

    await save();

    const notice = () => container.querySelector('.yaml-post-apply-notice');
    expect(notice()?.textContent).toContain('Your changes were applied to the latest live object');
    expect(notice()?.textContent).toContain('restartPolicy: Always');
    expect(container.querySelector('.yaml-drift-diff')?.textContent).not.toContain(
      'apiVersion: v1'
    );
    await clickText('Show full diff');
    expect(container.querySelector('.yaml-drift-diff')?.textContent).toContain('apiVersion: v1');
    expect(codeMirrorState.value).toContain('restartPolicy: Always');

    await clickButton('Close diff notice');

    expect(notice()).toBeNull();
  });

  it('warns, without a toast, when the saved object cannot be read back', async () => {
    answerApply('789');
    app.backend.answer('GetObjectYAMLByGVK', () => {
      throw new Error('live read failed');
    });
    const { container } = await renderYamlTab();
    await editTo(UPDATED_YAML);

    await save();

    expect(container.querySelector('.yaml-post-apply-notice-warning')?.textContent).toContain(
      'could not reload the final live object'
    );
    expect(codeMirrorState.value).toContain('resourceVersion: "789"');
    // The notice explains it in place; a toast would only repeat it.
    expect(takeReports('loadLatestObjectYAML')).toEqual([['inline']]);
  });

  it('does not warn when the stored object only adds generated annotations', async () => {
    answerApply('789');
    answerLiveYaml(VERIFIED_APPLIED_YAML_WITH_GENERATED_ANNOTATION);
    const { container } = await renderYamlTab();
    await editTo(UPDATED_YAML);

    await save();

    expect(container.querySelector('.yaml-post-apply-notice')).toBeNull();
    expect(codeMirrorState.value).toContain('deployment.kubernetes.io/revision: "3"');
  });

  it('warns when the live object changes again after a verified save', async () => {
    answerApply('789');
    answerLiveYaml(VERIFIED_APPLIED_YAML);
    serveYaml(YAML);
    const { container, rerender } = await renderYamlTab();
    await editTo(UPDATED_YAML);
    await save();
    expect(container.querySelector('.yaml-post-apply-notice')).toBeNull();

    await deliverSnapshot(rerender, VERIFIED_APPLIED_YAML);
    await deliverSnapshot(rerender, LATER_MUTATED_YAML);

    const stale = container.querySelector('.yaml-post-apply-notice-stale');
    expect(stale?.textContent).toContain('changed again after save');
    expect(stale?.textContent).toContain('restartPolicy: Always');
  });

  it('does not warn when a previous save’s snapshot arrives after a rapid second save', async () => {
    let applied = 0;
    app.backend.answer('ApplyObjectYaml', () => {
      applied += 1;
      return { resourceVersion: applied === 1 ? '789' : '790' };
    });
    answerLiveYaml(VERIFIED_APPLIED_YAML, SECOND_VERIFIED_APPLIED_YAML);
    const { container, rerender } = await renderYamlTab();
    await editTo(UPDATED_YAML);
    await save();
    await editTo(SECOND_UPDATED_YAML);
    await save();

    await deliverSnapshot(rerender, VERIFIED_APPLIED_YAML);
    expect(container.querySelector('.yaml-post-apply-notice-stale')).toBeNull();
    expect(codeMirrorState.value).toContain('image: demo:v3');

    await deliverSnapshot(rerender, SECOND_VERIFIED_APPLIED_YAML);
    expect(container.querySelector('.yaml-post-apply-notice-stale')).toBeNull();
    expect(codeMirrorState.value).toContain('image: demo:v3');
  });

  it('does not compare a recreated object (new uid) with the saved one', async () => {
    answerApply('789');
    answerLiveYaml(VERIFIED_APPLIED_YAML_WITH_UID);
    const { container, rerender } = await renderYamlTab();
    await editTo(UPDATED_YAML);
    await save();

    await deliverSnapshot(rerender, VERIFIED_APPLIED_YAML_WITH_UID);
    await deliverSnapshot(rerender, REPLACEMENT_POD_YAML);

    // The tab shows the new object without a changed-again warning.
    expect(codeMirrorState.value).toContain('uid: pod-uid-2');
    expect(container.querySelector('.yaml-post-apply-notice-stale')).toBeNull();
  });

  it('warns of a live change while editing, keeping the draft and a kubectl-edit-style save', async () => {
    vi.useFakeTimers();
    answerApply('791');
    answerLiveYaml(LATER_MUTATED_YAML);
    await renderYamlTab();
    await editTo(UPDATED_YAML);

    // Another client changes the object while the user edits.
    await pollLiveYaml(LATER_MUTATED_YAML);

    expect(codeMirrorState.value).toBe(UPDATED_YAML);
    // The other client's change is listed field by field, next to the draft's value.
    expect(driftRow('spec.restartPolicy')).toEqual({
      values: ['—', 'Always', '—'],
      choice: undefined,
    });
    // Both sides changed the image to the same value: no choice to make.
    expect(driftRow('containers[demo].image')?.choice).toBeUndefined();
    expect(buttonWithText('Merge changes and continue editing')?.disabled).toBe(false);
    expect(getIconButton('Save YAML')?.disabled).toBe(false);

    await save();

    expect(applyCalls()).toHaveLength(1);
  });

  it('shows no value of yours for a field changed externally that you did not edit', async () => {
    vi.useFakeTimers();
    await renderYamlTab();
    // Editing begins, but the draft keeps the original image.
    await editTo(YAML);

    await pollLiveYaml(LATER_MUTATED_YAML);

    expect(driftRow('containers[demo].image')).toEqual({
      values: ['demo:v1', 'demo:v2', '—'],
      choice: undefined,
    });
  });

  it('lights Save and Cancel while the draft holds edits, but not for a change made elsewhere', async () => {
    vi.useFakeTimers();
    await renderYamlTab();
    await clickButton('Edit YAML');
    const original = codeMirrorState.value;
    // Save lights green and Cancel red while there is something to save or lose.
    const lit = () => ({
      save: getIconButton('Save YAML')?.classList.contains('tone-success'),
      cancel: getIconButton('Cancel edit')?.classList.contains('tone-error'),
    });
    expect(lit()).toEqual({ save: false, cancel: false });

    await typeDraft(UPDATED_YAML);
    expect(lit()).toEqual({ save: true, cancel: true });

    await typeDraft(original);
    expect(lit()).toEqual({ save: false, cancel: false });

    // Someone else changes the object; the draft still holds no edits.
    await pollLiveYaml(LATER_MUTATED_YAML);
    expect(lit()).toEqual({ save: false, cancel: false });
  });

  it('shows long values in full, so the choice is made seeing them', async () => {
    vi.useFakeTimers();
    const image = (tag: string) => `registry.example.com/payments/api:${tag}`;
    const withImage = (tag: string) => YAML.replace('demo:v1', image(tag));
    serveYaml(withImage('1.4.2'));
    await renderYamlTab();
    await editTo(withImage('1.5.0'));

    await pollLiveYaml(withImage('1.4.3').replace('"123"', '"124"'));

    expect(driftRow('containers[demo].image')?.values).toEqual([
      image('1.4.2'),
      image('1.4.3'),
      image('1.5.0'),
    ]);
  });

  it('does not flag status churn on the live object while editing', async () => {
    vi.useFakeTimers();
    const { container } = await renderYamlTab();
    await editTo(UPDATED_YAML);

    // A controller updates only the status, which bumps the resourceVersion.
    await pollLiveYaml(`${YAML.replace('"123"', '"124"')}\nstatus:\n  phase: Running`);

    expect(container.querySelector('.yaml-drift-notice')).toBeNull();
    expect(buttonWithText('Merge changes and continue editing')).toBeUndefined();
  });

  it('asks for a choice in the row of a field both sides changed, and lets it be changed back', async () => {
    vi.useFakeTimers();
    await renderYamlTab();
    await editTo(UPDATED_YAML.replace('image: demo:v2', 'image: demo:v3'));

    // Someone else sets the image to v2 while the draft sets it to v3.
    await pollLiveYaml(LATER_MUTATED_YAML);

    expect(driftRow('containers[demo].image')).toEqual({
      values: ['demo:v1', 'demo:v2', 'demo:v3'],
      choice: null,
    });
    expect(getIconButton('Save YAML')?.disabled).toBe(true);
    // The merge waits for the choice.
    const merge = requireValue(
      buttonWithText('Select values to keep'),
      'expected the merge button waiting for a choice'
    );
    expect(merge.disabled).toBe(true);
    // The reason is on screen, not only in a tooltip, and names the field.
    expect(describedText(merge)).toContain('containers[demo].image');

    await chooseInRow('containers[demo].image', 'theirs');

    expect(parseYaml(codeMirrorState.value).spec.containers[0].image).toBe('demo:v2');
    // Your value stays on offer.
    expect(driftRow('containers[demo].image')).toEqual({
      values: ['demo:v1', 'demo:v2', 'demo:v3'],
      choice: 'theirs',
    });
    expect(getIconButton('Save YAML')?.disabled).toBe(false);
    expect(buttonWithText('Merge changes and continue editing')?.disabled).toBe(false);

    await chooseInRow('containers[demo].image', 'yours');

    expect(parseYaml(codeMirrorState.value).spec.containers[0].image).toBe('demo:v3');
    expect(driftRow('containers[demo].image')?.choice).toBe('yours');
  });

  it('merges their other changes while keeping your value for a field you chose', async () => {
    vi.useFakeTimers();
    app.backend.answer('MergeObjectYamlWithLatest', () => ({
      currentYAML: LATER_MUTATED_YAML,
      mergedYAML: LATER_MUTATED_YAML.replace('image: demo:v2', 'image: demo:v3'),
      resourceVersion: '790',
    }));
    await renderYamlTab();
    await editTo(UPDATED_YAML.replace('image: demo:v2', 'image: demo:v3'));
    await pollLiveYaml(LATER_MUTATED_YAML);

    await chooseInRow('containers[demo].image', 'yours');
    await clickText('Merge changes and continue editing');

    // The merge applies only the draft's edits from its baseline
    // (backend/object_yaml_reload_merge.go), so the baseline carries their
    // value for the field and the draft carries yours.
    const [, request] = requireValue(
      app.backend.calls('MergeObjectYamlWithLatest')[0],
      'expected the merge call'
    );
    expect(parseYaml(request.baseYAML).spec.containers[0].image).toBe('demo:v2');
    expect(parseYaml(request.draftYAML).spec.containers[0].image).toBe('demo:v3');
  });

  it('saves your value over theirs once you choose it', async () => {
    vi.useFakeTimers();
    answerApply('791');
    answerLiveYaml(LATER_MUTATED_YAML);
    await renderYamlTab();
    const draft = UPDATED_YAML.replace('image: demo:v2', 'image: demo:v3');
    await editTo(draft);
    await pollLiveYaml(LATER_MUTATED_YAML);

    await chooseInRow('containers[demo].image', 'yours');

    expect(codeMirrorState.value).toBe(draft);
    expect(getIconButton('Save YAML')?.disabled).toBe(false);

    await save();

    expect(applyCalls()).toHaveLength(1);
    expect(parseYaml(requireValue(applyCalls()[0], 'apply')[1].yaml).spec.containers[0].image).toBe(
      'demo:v3'
    );
  });

  /** The live pod with `image` at `resourceVersion`. */
  const liveWith = (image: string, resourceVersion: string) =>
    LATER_MUTATED_YAML.replace('image: demo:v2', `image: ${image}`).replace(
      '"790"',
      `"${resourceVersion}"`
    );

  /** Merge answers with a conflict whose live object is `currentYaml`. */
  const answerMergeConflict = (currentYaml: string) => {
    app.backend.answer('MergeObjectYamlWithLatest', () => ({
      currentYAML: '',
      mergedYAML: '',
      resourceVersion: '',
      yamlConflict: {
        code: 'MergeConflict',
        message: 'Kubernetes-aware merge found conflicting live changes.',
        causes: ['spec.containers'],
        currentYaml,
        currentResourceVersion: parseYaml(currentYaml).metadata.resourceVersion,
      },
    }));
  };

  // A resourceVersion is opaque: only the API server's are integers, so
  // freshness cannot come from ordering them.
  it.each([
    { atConflict: '790', later: '791' },
    { atConflict: 'rev-a', later: 'rev-b' },
  ])(
    'compares with a newer live object after a merge conflict, so an earlier choice no longer holds (versions $atConflict, $later)',
    async ({ atConflict, later }) => {
      vi.useFakeTimers();
      answerMergeConflict(liveWith('demo:v2', atConflict));
      await renderYamlTab();
      await editTo(UPDATED_YAML.replace('image: demo:v2', 'image: demo:v3'));
      await pollLiveYaml(liveWith('demo:v2', atConflict));
      await chooseInRow('containers[demo].image', 'yours');
      await clickText('Merge changes and continue editing');

      // Someone sets the image again after the conflict.
      await pollLiveYaml(liveWith('demo:v4', later));

      expect(driftRow('containers[demo].image')).toEqual({
        values: ['demo:v1', 'demo:v4', 'demo:v3'],
        choice: null,
      });
      expect(getIconButton('Save YAML')?.disabled).toBe(true);
    }
  );

  it('keeps comparing with the conflict’s live object when a read sent before the conflict lands after it', async () => {
    vi.useFakeTimers();
    answerMergeConflict(liveWith('demo:v5', 'rev-c'));
    await renderYamlTab();
    await editTo(UPDATED_YAML.replace('image: demo:v2', 'image: demo:v3'));
    await pollLiveYaml(liveWith('demo:v2', 'rev-a'));
    await chooseInRow('containers[demo].image', 'yours');
    // The next poll goes out and the backend holds it.
    let releaseRead!: () => void;
    const readHeld = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });
    let holding = true;
    app.snapshots.respond(async ({ domain }) => {
      if (domain === 'object-yaml' && holding) {
        holding = false;
        await readHeld;
      }
      return undefined;
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    serveYaml(liveWith('demo:v5', 'rev-c'));
    await clickText('Merge changes and continue editing');
    // The held read saw an object older than the conflict's.
    serveYaml(liveWith('demo:v4', 'rev-b'));
    await act(async () => {
      releaseRead();
    });
    await app.settle();

    expect(driftRow('containers[demo].image')?.values).toEqual(['demo:v1', 'demo:v5', 'demo:v3']);
  });

  it('restores an environment variable you deleted when you keep their changed value', async () => {
    vi.useFakeTimers();
    const withEnv = (resourceVersion: string, ...env: string[]) =>
      [
        'apiVersion: v1',
        'kind: Pod',
        'metadata:',
        '  name: demo',
        '  namespace: default',
        `  resourceVersion: "${resourceVersion}"`,
        'spec:',
        '  containers:',
        '    - name: demo',
        '      image: demo:v1',
        '      env:',
        ...env,
      ].join('\n');
    const MODE = (value: string) => ['        - name: MODE', `          value: ${value}`];
    const KEEP = ['        - name: KEEP', '          value: "1"'];
    serveYaml(withEnv('123', ...MODE('a'), ...KEEP));
    await renderYamlTab();
    // You delete MODE while someone else changes it.
    await editTo(withEnv('123', ...KEEP));
    await pollLiveYaml(withEnv('790', ...MODE('b'), ...KEEP));

    await chooseInRow('env[MODE].value', 'theirs');

    // MODE is back where the live object lists it.
    expect(parseYaml(codeMirrorState.value).spec.containers[0].env).toEqual([
      { name: 'MODE', value: 'b' },
      { name: 'KEEP', value: '1' },
    ]);
    expect(driftRow('env[MODE].value')?.choice).toBe('theirs');
    expect(getIconButton('Save YAML')?.disabled).toBe(false);
  });

  it('finishes a save normally when a live change lands while the save is in flight', async () => {
    vi.useFakeTimers();
    // The live object after the save: the other client's change plus the draft's.
    const saved = LATER_MUTATED_YAML.replace('"790"', '"791"');
    answerApply('791');
    answerLiveYaml(saved);
    const { container } = await renderYamlTab();
    await editTo(UPDATED_YAML);
    const landSave = app.backend.hold('ApplyObjectYaml');
    await save();

    await pollLiveYaml(LATER_MUTATED_YAML);
    serveYaml(saved);
    await act(async () => {
      landSave();
    });
    await app.settle();

    expect(applyCalls()).toHaveLength(1);
    expect(getIconButton('Edit YAML')).not.toBeNull();
    expect(parseYaml(codeMirrorState.value)).toMatchObject({
      metadata: { resourceVersion: '791' },
      spec: { restartPolicy: 'Always', containers: [{ name: 'demo', image: 'demo:v2' }] },
    });
    expect(container.querySelector('.yaml-validation-message')).toBeNull();
    expect(container.querySelector('.yaml-post-apply-notice-stale')).toBeNull();
  });

  it('offers to copy the draft and edit the new object when it is recreated during the edit', async () => {
    vi.useFakeTimers();
    serveYaml(VERIFIED_APPLIED_YAML_WITH_UID);
    const { container } = await renderYamlTab();
    await editTo(VERIFIED_APPLIED_YAML_WITH_UID.replace('image: demo:v2', 'image: demo:v3'));

    // The pod is deleted and recreated under the same name, with a new uid.
    await pollLiveYaml(REPLACEMENT_POD_YAML);

    expect(codeMirrorState.value).toContain('image: demo:v3');
    expect(container.querySelector('.yaml-drift-notice')).not.toBeNull();
    // backend/object_yaml_reload_merge.go refuses to merge into a replaced object,
    // and the save would be refused too.
    expect(buttonWithText('Merge changes and continue editing')).toBeUndefined();
    expect(getIconButton('Save YAML')?.disabled).toBe(true);

    await clickText('Copy draft');
    expect(Clipboard.SetText).toHaveBeenLastCalledWith(codeMirrorState.value);

    await clickText('Edit the new object');
    expect(parseYaml(codeMirrorState.value).metadata.uid).toBe('pod-uid-2');
    expect(container.querySelector('.yaml-drift-notice')).toBeNull();
    expect(getIconButton('Save YAML')?.disabled).toBe(false);
  });

  it.each(['before', 'after'] as const)(
    'keeps merged edits when the matching live snapshot arrives %s the merge response',
    async (snapshotTiming) => {
      const base = YAML.replace('apiVersion: v1', 'apiVersion: example.com/v1alpha1')
        .replace('kind: Pod', 'kind: Deployment')
        .replace('  name: demo', '  uid: original-object\n  name: demo');
      const draft = base.replace('image: demo:v1', 'image: demo:v2');
      const current = base.replace('"123"', '"456"').replace('spec:', 'spec:\n  replicas: 3');
      const merged = current.replace('image: demo:v1', 'image: demo:v2');
      serveYaml(base);
      // backend/object_yaml_reload_merge.go MergeObjectYamlWithLatest.
      app.backend.answer('MergeObjectYamlWithLatest', () => ({
        currentYAML: current,
        mergedYAML: merged,
        resourceVersion: '456',
      }));
      await renderYamlTab();
      await editTo(draft);
      const liveBeforeMerge = snapshotTiming === 'before' ? current : current.replace('456', '400');
      await openObjectDiffReading(liveBeforeMerge);
      if (snapshotTiming === 'after') {
        // The merge's own reread brings the matching snapshot after its response.
        serveYaml(current);
      }

      await clickText('Merge changes and continue editing');

      expect(app.backend.calls('MergeObjectYamlWithLatest')).toHaveLength(1);
      const [clusterId, request] = requireValue(
        app.backend.calls('MergeObjectYamlWithLatest')[0],
        'expected the merge call'
      );
      expect(clusterId).toBe(dev.clusterId);
      expect(request).toMatchObject({
        apiVersion: 'example.com/v1alpha1',
        kind: 'Deployment',
        namespace: 'default',
        name: 'demo',
        uid: 'original-object',
      });
      expect(parseYaml(request.baseYAML).metadata.resourceVersion).toBe('123');
      expect(parseYaml(request.draftYAML).spec.containers[0].image).toBe('demo:v2');
      expect(parseYaml(codeMirrorState.value)).toMatchObject({
        metadata: { resourceVersion: '456', uid: 'original-object' },
        spec: { replicas: 3, containers: [{ name: 'demo', image: 'demo:v2' }] },
      });
      expect(getIconButton('Save YAML')?.disabled).toBe(false);
      expect(applyCalls()).toEqual([]);
    }
  );

  it('searches the YAML from the find controls', async () => {
    const { container } = await renderYamlTab();
    const input = requireValue(
      container.querySelector<HTMLInputElement>('.find-input'),
      'expected the find input'
    );
    const typeSearch = (value: string) =>
      act(async () => {
        Object.defineProperty(input, 'value', { value, configurable: true, writable: true });
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
    const press = (init: KeyboardEventInit) =>
      act(async () => {
        input.dispatchEvent(
          new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
        );
      });
    const previousMatch = requireValue(getIconButton('Previous match'), 'previous match');
    const nextMatch = requireValue(getIconButton('Next match'), 'next match');
    const dispatch = vi.mocked(codeMirrorState.editorView.dispatch);

    // Typing searches from the top and finds the first match.
    await typeSearch('pod');
    expect(dispatch).toHaveBeenCalledWith({ selection: { cursor: 0 } });
    expect(codemirrorSearchMocks.setSearchQuery.of).toHaveBeenCalledWith(
      expect.objectContaining({ search: 'pod' })
    );
    expect(codemirrorSearchMocks.findNext).toHaveBeenCalledTimes(1);
    await act(async () => nextMatch.click());
    expect(codemirrorSearchMocks.findNext).toHaveBeenCalledTimes(2);
    await act(async () => previousMatch.click());
    expect(codemirrorSearchMocks.findPrevious).toHaveBeenCalledTimes(1);

    // Enter, Shift+Enter, and the arrow keys step through matches.
    await press({ key: 'Enter' });
    expect(codemirrorSearchMocks.findNext).toHaveBeenCalledTimes(3);
    await press({ key: 'Enter', shiftKey: true });
    expect(codemirrorSearchMocks.findPrevious).toHaveBeenCalledTimes(2);
    await press({ key: 'ArrowDown' });
    expect(codemirrorSearchMocks.findNext).toHaveBeenCalledTimes(4);
    await press({ key: 'ArrowUp' });
    expect(codemirrorSearchMocks.findPrevious).toHaveBeenCalledTimes(3);

    // Edit is offered and Save is not while reading.
    expect(getIconButton('Show managedFields')).not.toBeNull();
    expect(getIconButton('Edit YAML')).not.toBeNull();
    expect(getIconButton('Save YAML')).toBeNull();

    // Case sensitivity applies until a regular expression search replaces it.
    await act(async () => requireValue(getIconButton('Case-sensitive search'), 'case').click());
    expect(codemirrorSearchMocks.setSearchQuery.of).toHaveBeenCalledWith(
      expect.objectContaining({ caseSensitive: true, regexp: false })
    );
    await act(async () =>
      requireValue(getIconButton('Enable regular expression search'), 'regex').click()
    );
    expect(codemirrorSearchMocks.setSearchQuery.of).toHaveBeenCalledWith(
      expect.objectContaining({ caseSensitive: false, regexp: true })
    );
    const caseSensitive = requireValue(getIconButton('Case-sensitive search'), 'case');
    expect(caseSensitive.getAttribute('aria-pressed')).toBe('false');
    expect(caseSensitive.hasAttribute('disabled')).toBe(true);

    // Escape returns to the editor; Ctrl+A selects the search text.
    input.focus();
    await press({ key: 'Escape' });
    expect(codeMirrorState.editorView.focus).toHaveBeenCalled();
    expect(document.activeElement).not.toBe(input);
    const select = vi.spyOn(input, 'select');
    await press({ key: 'a', ctrlKey: true });
    expect(select).toHaveBeenCalled();

    // A cleared search finds nothing.
    await typeSearch('');
    await act(async () => nextMatch.click());
    expect(codemirrorSearchMocks.findNext).toHaveBeenCalledTimes(4);
  });

  it('refuses to save an empty draft', async () => {
    const { container } = await renderYamlTab();
    await editTo('');

    await save();

    expect(container.textContent).toContain('YAML content is required.');
    expect(applyCalls()).toEqual([]);
  });

  it('saves an object without metadata.resourceVersion like kubectl edit', async () => {
    serveYaml(YAML.replace('  resourceVersion: "123"\n', ''));
    answerApply('789');
    answerLiveYaml(UPDATED_YAML.replace('resourceVersion: "123"\n', ''));
    await renderYamlTab();
    await clickButton('Edit YAML');

    await save();

    expect(applyCalls()[0]?.[0]).toBe(dev.clusterId);
    const request = requireValue(applyCalls()[0]?.[1], 'expected the apply request');
    expect(request).toEqual(
      expect.objectContaining({
        apiVersion: 'v1',
        kind: 'Pod',
        namespace: 'default',
        name: 'demo',
        uid: '',
        resourceVersion: '',
      })
    );
    expect(request.baseYAML).not.toContain('resourceVersion');
    expect(request.yaml).not.toContain('resourceVersion');
  });

  it('shows backend validation errors with their causes and blocks resaving', async () => {
    app.backend.answer('ApplyObjectYaml', () => {
      throw rejectedWithStatus({
        reason: 'Invalid',
        category: 'VALIDATION',
        message: 'Invalid YAML payload',
        details: { causes: ['disallowed field'] },
      });
    });
    const { container } = await renderYamlTab();
    await editTo(UPDATED_YAML);

    await save();

    expect(container.textContent).toContain('Invalid YAML payload');
    expect(container.textContent).toContain('disallowed field');
    expect(getIconButton('Save YAML')?.disabled).toBe(true);
    expect(takeReports('saveObjectYAML')).toEqual([['inline']]);
  });

  it('keeps the draft and lists the replacement’s changes, without a merge, when the save finds the object replaced', async () => {
    // backend/object_yaml_mutation.go checks the uid the editor tracked, and
    // returns the live object's YAML without its uid (sanitizeForUpdate).
    const yamlConflict = {
      code: 'ObjectUIDMismatch',
      message: 'object identity changed since editing began: current uid is pod-uid-2',
      causes: ['uid changed'],
      currentYaml: LATER_MUTATED_YAML,
      currentResourceVersion: '790',
    };
    app.backend.answer('CheckObjectYamlOwnership', () => ({ conflicts: [], yamlConflict }));
    app.backend.answer('ApplyObjectYaml', () => ({ resourceVersion: '', yamlConflict }));
    serveYaml(VERIFIED_APPLIED_YAML_WITH_UID);
    await renderYamlTab();
    const draft = VERIFIED_APPLIED_YAML_WITH_UID.replace('image: demo:v2', 'image: demo:v3');
    await editTo(draft);

    await save();

    expect(applyCalls()).toHaveLength(1);
    expect(codeMirrorState.value).toBe(draft);
    expect(app.backend.calls('GetObjectYAMLByGVK')).toEqual([]);
    expect(driftRow('spec.restartPolicy')?.values).toEqual(['—', 'Always', '—']);
    expect(buttonWithText('Copy draft')).toBeDefined();
    expect(buttonWithText('Merge changes and continue editing')).toBeUndefined();
    expect(getIconButton('Save YAML')?.disabled).toBe(true);
  });

  it('shows a reload-merge conflict with the live YAML without reporting an error', async () => {
    app.backend.answer('MergeObjectYamlWithLatest', () => ({
      currentYAML: '',
      mergedYAML: '',
      resourceVersion: '',
      yamlConflict: {
        code: 'MergeConflict',
        message: 'Kubernetes-aware merge found conflicting live changes.',
        causes: ['spec.containers'],
        currentYaml: LATER_MUTATED_YAML,
        currentResourceVersion: '999',
      },
    }));
    const { container } = await renderYamlTab();
    await editTo(UPDATED_YAML);
    await openObjectDiffReading(LATER_MUTATED_YAML);

    await clickText('Merge changes and continue editing');

    expect(container.textContent).toContain('conflicting live changes');
    expect(container.textContent).toContain('spec.containers');
  });

  it('shows a failed reload-merge in the editor and reports it without a toast', async () => {
    app.backend.answer('MergeObjectYamlWithLatest', () => {
      throw new Error('merge backend unavailable');
    });
    const { container } = await renderYamlTab();
    await editTo(UPDATED_YAML);
    await openObjectDiffReading(LATER_MUTATED_YAML);

    await clickText('Merge changes and continue editing');

    expect(container.textContent).toContain('merge backend unavailable');
    expect(takeReports('reloadAndMerge')).toEqual([['inline']]);
  });

  it('reports a denied ownership check without a toast and leaves the outcome to Apply', async () => {
    const forbidden = () =>
      rejectedWithStatus({
        reason: 'Forbidden',
        category: 'PERMISSION',
        code: 403,
        message: 'patch denied',
      });
    app.backend.answer('CheckObjectYamlOwnership', () => {
      throw forbidden();
    });
    app.backend.answer('ApplyObjectYaml', () => {
      throw forbidden();
    });
    const { container } = await renderYamlTab();
    await editTo(UPDATED_YAML);

    await save();

    expect(container.textContent).toContain('patch denied');
    expect(takeReports('checkYamlOwnership')).toEqual([['operational']]);
    expect(takeReports('saveObjectYAML')).toEqual([['inline']]);
  });

  it('shows the apply failure in the editor and reports it without a toast', async () => {
    app.backend.answer('ApplyObjectYaml', () => {
      throw new Error('network down');
    });
    const { container } = await renderYamlTab();
    await editTo(UPDATED_YAML);

    await save();

    expect(container.textContent).toContain('network down');
    expect(takeReports('saveObjectYAML')).toEqual([['inline']]);
  });

  it('shows loading, failure, empty, and large-manifest states', async () => {
    const otherPod = (name: string) =>
      requireValue(app.object(dev, { ...pod, name }).scopes.detailScope, 'expected a scope');
    const loadingScope = otherPod('loading');
    const failedScope = otherPod('failed');
    const emptyScope = otherPod('empty');
    const largeScope = otherPod('large');
    const parked: Array<() => void> = [];
    app.snapshots.respond(({ domain, scope: readScope }: SnapshotRequest) =>
      domain === 'object-yaml' && readScope === loadingScope
        ? new Promise<Response>((resolve) => {
            parked.push(() =>
              resolve(
                snapshotResponse({
                  domain,
                  scope: readScope,
                  version: 1,
                  payload: { clusterId: dev.clusterId, clusterName: dev.clusterName, yaml: YAML },
                })
              )
            );
          })
        : undefined
    );
    app.snapshots.fail('object-yaml', failedScope, makeErrorStatus('InternalError', 'boom'));
    for (const [readScope, yaml] of [
      [emptyScope, ''],
      [largeScope, `kind: Pod\nmetadata:\n  name: demo\n${'a'.repeat(160000)}`],
    ] as const) {
      app.snapshots.serve('object-yaml', readScope, {
        clusterId: dev.clusterId,
        clusterName: dev.clusterName,
        yaml,
      });
    }
    const { container } = await renderYamlTab({ scope: loadingScope });
    expect(container.textContent).toContain('Loading YAML');
    await act(async () => {
      parked.splice(0).forEach((answer) => {
        answer();
      });
    });

    await view.show(tab({ scope: failedScope }));
    expect(container.textContent).toContain('Error loading YAML: boom');
    expect(
      app.errors
        .take((record) => record.context?.domain === 'object-yaml')
        .map(({ context }) => context?.scope)
    ).toEqual([failedScope]);

    await view.show(tab({ scope: emptyScope }));
    expect(container.textContent).toContain('No YAML content available');

    await view.show(tab({ scope: largeScope }));
    expect(container.textContent).toContain('Large manifest detected');
  });
});
