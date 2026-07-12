/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Yaml/YamlTab.test.tsx
 */

import React, { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type SnapshotStatus = 'idle' | 'loading' | 'ready' | 'updating' | 'initialising' | 'error';

interface MockSelectionRange {
  from: number;
  to: number;
}

interface MockSelection {
  main: MockSelectionRange;
  ranges?: MockSelectionRange[];
}

interface CapturedCodeMirrorProps {
  value: string;
  extensions: unknown[];
  onChange: (value: string) => void;
  onCreateEditor?: (view: unknown) => void;
  ref?: React.Ref<unknown>;
}

interface MockEditorView {
  state: {
    selection: MockSelection;
    sliceDoc: ReturnType<typeof vi.fn<() => string>>;
    changeByRange: (updater: (range: MockSelectionRange) => unknown) => unknown;
  };
  dispatch: ReturnType<typeof vi.fn>;
  focus: ReturnType<typeof vi.fn>;
}

interface CodeMirrorHarness {
  latestProps: { current: CapturedCodeMirrorProps };
  editorView: MockEditorView;
  value: string;
  selectionText: string;
}

const shortcutMocks = vi.hoisted(() => ({
  useShortcut: vi.fn(),
  useKeyboardSurface: vi.fn(),
}));
const searchShortcutMocks = vi.hoisted(() => ({
  useSearchShortcutTarget: vi.fn(),
}));

const refreshMocks = vi.hoisted(() => ({
  setScopedDomainEnabled: vi.fn(),
  fetchScopedDomain: vi.fn(() => Promise.resolve()),
  resetScopedDomain: vi.fn(),
}));

const refreshStoreMocks = vi.hoisted(() => ({
  useRefreshScopedDomain: vi.fn(),
}));

const codeMirrorState: CodeMirrorHarness = {
  latestProps: {
    current: {
      value: '',
      extensions: [],
      onChange: () => undefined,
    },
  },
  editorView: {
    state: {
      selection: {
        main: { from: 0, to: 0 },
        ranges: [],
      },
      sliceDoc: vi.fn(() => codeMirrorState.selectionText),
      changeByRange: (updater: (range: { from: number; to: number }) => unknown) =>
        updater({ from: 0, to: 0 }),
    },
    dispatch: vi.fn(),
    focus: vi.fn(),
  },
  value: '',
  selectionText: '',
};

const CodeMirrorMock = ({ ref, ...props }: CapturedCodeMirrorProps) => {
  const { onCreateEditor } = props;
  codeMirrorState.value = props.value;
  codeMirrorState.latestProps.current = props;
  if (ref && typeof ref === 'object') {
    (ref as React.RefObject<{ view: typeof codeMirrorState.editorView } | null>).current = {
      view: codeMirrorState.editorView,
    };
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
CodeMirrorMock.displayName = 'CodeMirrorMock';

const yamlErrorsMocks = vi.hoisted(() => ({
  parseObjectYamlError: vi.fn(),
}));

const wailsMocks = vi.hoisted(() => ({
  ValidateObjectYaml: vi.fn(),
  ApplyObjectYaml: vi.fn(),
  CheckObjectYamlOwnership: vi.fn(),
  GetObjectYAMLByGVK: vi.fn(),
  MergeObjectYamlWithLatest: vi.fn(),
}));

const errorHandlerMock = vi.hoisted(() => ({
  handle: vi.fn(),
}));

const themeMocks = vi.hoisted(() => ({
  buildCodeTheme: vi.fn(() => ({ theme: 'dark', highlight: 'highlight-ext' })),
}));

const searchModuleMocks = vi.hoisted(() => ({
  createSearchExtensions: vi.fn(() => ['search-ext']),
  closeSearchPanel: vi.fn(),
}));

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

vi.mock('@ui/shortcuts', () => ({
  useKeyboardSurface: (config: unknown) => shortcutMocks.useKeyboardSurface(config),
  useShortcut: shortcutMocks.useShortcut,
  useSearchShortcutTarget: (config: unknown) => searchShortcutMocks.useSearchShortcutTarget(config),
}));

vi.mock('@/core/refresh', () => ({
  refreshOrchestrator: refreshMocks,
}));

vi.mock('@/core/refresh/store', () => ({
  useRefreshScopedDomain: refreshStoreMocks.useRefreshScopedDomain,
}));

vi.mock('@uiw/react-codemirror', () => ({
  __esModule: true,
  default: CodeMirrorMock,
}));

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
  buildCodeTheme: themeMocks.buildCodeTheme,
}));

vi.mock('@core/contexts/ZoomContext', () => ({
  useZoom: () => ({ zoomLevel: 100 }),
}));

vi.mock('@/core/codemirror/search', () => ({
  createSearchExtensions: searchModuleMocks.createSearchExtensions,
  closeSearchPanel: searchModuleMocks.closeSearchPanel,
}));

vi.mock('./yamlErrors', () => ({
  parseObjectYamlError: yamlErrorsMocks.parseObjectYamlError,
}));

vi.mock('@utils/errorHandler', () => ({
  errorHandler: {
    handle: errorHandlerMock.handle,
  },
}));

vi.mock('@wailsjs/go/backend/App', () => ({
  ValidateObjectYaml: wailsMocks.ValidateObjectYaml,
  ApplyObjectYaml: wailsMocks.ApplyObjectYaml,
  CheckObjectYamlOwnership: wailsMocks.CheckObjectYamlOwnership,
  GetObjectYAMLByGVK: wailsMocks.GetObjectYAMLByGVK,
  MergeObjectYamlWithLatest: wailsMocks.MergeObjectYamlWithLatest,
}));

vi.mock('@/core/settings/appPreferences', () => ({
  getAutoRefreshEnabled: () => true,
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

type Snapshot = {
  status: SnapshotStatus;
  data?: { yaml?: string | null };
  error?: string | null;
};

const snapshotState: { current: Snapshot } = {
  current: { status: 'ready', data: { yaml: YAML }, error: null },
};

refreshStoreMocks.useRefreshScopedDomain.mockImplementation((_domain: string, _scope: string) => {
  return snapshotState.current;
});

Object.assign(globalThis, {
  navigator: {
    clipboard: {
      readText: vi.fn(() => Promise.resolve('')),
      writeText: vi.fn(() => Promise.resolve()),
    },
  },
});

const waitForUpdates = async () => {
  await act(async () => {
    await Promise.resolve();
  });
  await act(async () => {
    await Promise.resolve();
  });
};

const getIconButton = (container: ParentNode, label: string) =>
  container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);

const renderYamlTab = async (
  props: Partial<{
    scope: string | null;
    isActive: boolean;
    canEdit: boolean;
    editDisabledReason: string | null;
    clusterId: string;
  }> = {}
) => {
  const container = document.createElement('div');
  document.body.appendChild(container);

  const root = ReactDOM.createRoot(container);
  const defaultProps = {
    scope: 'default:pod:demo',
    isActive: true,
    canEdit: true,
    clusterId: 'alpha:ctx',
  };

  await act(async () => {
    const { default: YamlTab } = await import('./YamlTab');
    root.render(<YamlTab {...defaultProps} {...props} />);
  });

  return {
    container,
    root,
    rerender: async (propsOverride: Partial<typeof defaultProps> = {}) => {
      await act(async () => {
        const { default: YamlTab } = await import('./YamlTab');
        root.render(<YamlTab {...defaultProps} {...props} {...propsOverride} />);
      });
    },
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
};

describe('YamlTab', () => {
  beforeEach(() => {
    snapshotState.current = { status: 'ready', data: { yaml: YAML }, error: null };
    codeMirrorState.selectionText = '';
    codeMirrorState.value = '';
    codeMirrorState.latestProps.current = {
      value: '',
      extensions: [],
      onChange: () => undefined,
    };
    codeMirrorState.editorView.state.selection = {
      main: { from: 0, to: 0 },
      ranges: [],
    };
    codeMirrorState.editorView.dispatch.mockClear();
    codeMirrorState.editorView.focus.mockClear();
    (navigator.clipboard.writeText as unknown as ReturnType<typeof vi.fn>).mockClear();
    refreshMocks.setScopedDomainEnabled.mockClear();
    refreshMocks.fetchScopedDomain.mockClear();
    refreshMocks.resetScopedDomain.mockClear();
    shortcutMocks.useShortcut.mockClear();
    shortcutMocks.useKeyboardSurface.mockClear();
    searchShortcutMocks.useSearchShortcutTarget.mockClear();
    searchModuleMocks.createSearchExtensions.mockClear();
    searchModuleMocks.closeSearchPanel.mockClear();
    wailsMocks.ValidateObjectYaml.mockReset();
    wailsMocks.ApplyObjectYaml.mockReset();
    wailsMocks.CheckObjectYamlOwnership.mockReset();
    wailsMocks.CheckObjectYamlOwnership.mockResolvedValue({ conflicts: [] });
    wailsMocks.GetObjectYAMLByGVK.mockReset();
    wailsMocks.MergeObjectYamlWithLatest.mockReset();
    yamlErrorsMocks.parseObjectYamlError.mockReset();
    errorHandlerMock.handle.mockClear();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('normalizes YAML output and toggles managed fields', async () => {
    const { container, unmount } = await renderYamlTab();

    expect(codeMirrorState.value).not.toContain('managedFields');

    const toggleButton = getIconButton(container, 'Show managedFields');
    expect(toggleButton).toBeTruthy();

    await act(async () => {
      toggleButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await waitForUpdates();

    expect(codeMirrorState.value).toContain('managedFields');

    await unmount();
  });

  it('shows a default-on wrap toggle immediately after managed fields', async () => {
    const { container, unmount } = await renderYamlTab();
    const toolbarButtons = Array.from(
      container.querySelectorAll<HTMLButtonElement>('.yaml-editor-toolbar .icon-bar-button')
    );
    const managedFieldsIndex = toolbarButtons.findIndex(
      (button) => button.getAttribute('aria-label') === 'Show managedFields'
    );
    const wrapButton = getIconButton(container, 'Wrap YAML lines');

    expect(wrapButton).toBe(toolbarButtons[managedFieldsIndex + 1]);
    expect(wrapButton?.getAttribute('aria-pressed')).toBe('true');
    expect(codeMirrorState.latestProps.current.extensions).toContain('lineWrapping');

    await act(async () => {
      wrapButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(wrapButton?.getAttribute('aria-pressed')).toBe('false');
    expect(codeMirrorState.latestProps.current.extensions).not.toContain('lineWrapping');
    await unmount();
  });

  it('uses the managedFields visibility setting when entering edit mode', async () => {
    const { container, unmount } = await renderYamlTab();

    await act(async () => {
      getIconButton(container, 'Edit YAML')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true })
      );
    });

    expect(codeMirrorState.value).not.toContain('managedFields');

    await act(async () => {
      getIconButton(container, 'Cancel edit')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true })
      );
    });

    await act(async () => {
      getIconButton(container, 'Show managedFields')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true })
      );
    });
    await waitForUpdates();

    await act(async () => {
      getIconButton(container, 'Edit YAML')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true })
      );
    });

    expect(codeMirrorState.value).toContain('managedFields');

    await unmount();
  });

  it('shows the YAML edit denial reason when editing is not allowed', async () => {
    const { container, unmount } = await renderYamlTab({
      canEdit: false,
      editDisabledReason: 'permission denied for patch pods/demo',
    });

    expect(getIconButton(container, 'Edit YAML')).toBeNull();
    const disabledEditButton = getIconButton(
      container,
      'Edit YAML unavailable: permission denied for patch pods/demo'
    );
    expect(disabledEditButton).toBeTruthy();
    expect(disabledEditButton?.disabled).toBe(true);
    expect(disabledEditButton?.title).toBe('permission denied for patch pods/demo');

    await unmount();
  });

  it('registers the CodeMirror region as an editor surface', async () => {
    const { unmount } = await renderYamlTab();

    expect(shortcutMocks.useKeyboardSurface).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'editor',
        active: true,
        onEscape: expect.any(Function),
        onNativeAction: expect.any(Function),
      })
    );

    await unmount();
  });

  it('copies the current selection from the read-only editor via native copy action', async () => {
    const { unmount } = await renderYamlTab({ canEdit: false });

    codeMirrorState.editorView.state.selection = {
      main: { from: 0, to: 10 },
      ranges: [{ from: 0, to: 10 }],
    };
    codeMirrorState.selectionText = 'apiVersion';

    const surfaceConfig = shortcutMocks.useKeyboardSurface.mock.calls
      .map(([config]) => config as { onNativeAction?: (context: unknown) => boolean })
      .filter((config) => typeof config.onNativeAction === 'function')
      .pop();

    let handled = false;
    await act(async () => {
      handled =
        surfaceConfig?.onNativeAction?.({
          action: 'copy',
          activeElement: null,
          selection: null,
        }) ?? false;
      await Promise.resolve();
    });

    expect(handled).toBe(true);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('apiVersion');

    await unmount();
  });

  it('enables context-menu copy for a read-only CodeMirror selection', async () => {
    const { unmount } = await renderYamlTab({ canEdit: false });

    codeMirrorState.editorView.state.selection = {
      main: { from: 0, to: 10 },
      ranges: [{ from: 0, to: 10 }],
    };
    codeMirrorState.selectionText = 'apiVersion';

    const contextMenuExtension = (codeMirrorState.latestProps.current.extensions as unknown[]).find(
      (extension) =>
        typeof extension === 'object' &&
        extension !== null &&
        'contextmenu' in (extension as Record<string, unknown>)
    ) as { contextmenu: (event: MouseEvent, view: typeof codeMirrorState.editorView) => boolean };

    await act(async () => {
      contextMenuExtension.contextmenu(
        new MouseEvent('contextmenu', {
          clientX: 10,
          clientY: 20,
          bubbles: true,
          cancelable: true,
        }),
        codeMirrorState.editorView
      );
      await Promise.resolve();
    });

    const copyItem = Array.from(document.querySelectorAll('.context-menu-item')).find((item) =>
      item.textContent?.includes('Copy')
    );
    expect(copyItem?.getAttribute('aria-disabled')).toBe('false');

    await unmount();
  });

  it('focuses the editor when the tab is active in read mode', async () => {
    const rafSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback: FrameRequestCallback) => {
        callback(0);
        return 0;
      });

    // Clipboard and select-all shortcuts route to the surface that contains
    // the focused element, so the read-mode editor must take focus when the
    // tab becomes active.
    const { unmount } = await renderYamlTab();
    expect(codeMirrorState.editorView.focus).toHaveBeenCalled();
    await unmount();

    codeMirrorState.editorView.focus.mockClear();
    const inactive = await renderYamlTab({ isActive: false });
    expect(codeMirrorState.editorView.focus).not.toHaveBeenCalled();
    await inactive.unmount();

    rafSpy.mockRestore();
  });

  it('pastes native menu text into the editor while editing', async () => {
    const { container, unmount } = await renderYamlTab();

    const editButton = getIconButton(container, 'Edit YAML');
    await act(async () => {
      editButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    codeMirrorState.editorView.state.selection.main = { from: 0, to: 0 };

    const surfaceConfig = shortcutMocks.useKeyboardSurface.mock.calls
      .map(([config]) => config as { onNativeAction?: (context: unknown) => boolean })
      .filter((config) => typeof config.onNativeAction === 'function')
      .pop();

    let handled = false;
    await act(async () => {
      handled =
        surfaceConfig?.onNativeAction?.({
          action: 'paste',
          activeElement: null,
          selection: null,
          text: 'apiVersion: v1\n',
        }) ?? false;
    });

    expect(handled).toBe(true);
    expect(codeMirrorState.editorView.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        changes: { from: 0, to: 0, insert: 'apiVersion: v1\n' },
      })
    );
    expect(codeMirrorState.editorView.focus).toHaveBeenCalled();

    await unmount();
  });

  it('saves edited YAML and refreshes the snapshot', async () => {
    wailsMocks.ApplyObjectYaml.mockResolvedValue({ resourceVersion: '789' });
    // hydrateLatestObject routes through GetObjectYAMLByGVK now that the
    // YAML fixture carries apiVersion.
    wailsMocks.GetObjectYAMLByGVK.mockResolvedValue(UPDATED_YAML);

    const { container, unmount } = await renderYamlTab();

    const editButton = getIconButton(container, 'Edit YAML');
    expect(editButton).toBeTruthy();

    await act(async () => {
      editButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await act(async () => {
      codeMirrorState.latestProps.current.onChange(UPDATED_YAML);
    });

    const saveButton = getIconButton(container, 'Save YAML');
    expect(saveButton).toBeTruthy();

    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await waitForUpdates();

    expect(wailsMocks.ApplyObjectYaml).toHaveBeenCalledTimes(1);
    expect(wailsMocks.ApplyObjectYaml.mock.calls[0]?.[0]).toBe('alpha:ctx');
    expect(wailsMocks.ApplyObjectYaml.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        apiVersion: 'v1',
        kind: 'Pod',
        namespace: 'default',
        name: 'demo',
        uid: '',
        resourceVersion: '123',
      })
    );
    expect(wailsMocks.ApplyObjectYaml.mock.calls[0]?.[1]?.baseYAML).toContain('image: demo:v1');
    expect(wailsMocks.ApplyObjectYaml.mock.calls[0]?.[1]?.baseYAML).not.toContain('managedFields');
    expect(wailsMocks.ApplyObjectYaml.mock.calls[0]?.[1]?.yaml).toContain('image: demo:v2');
    expect(wailsMocks.ApplyObjectYaml.mock.calls[0]?.[1]?.yaml).not.toContain('managedFields');
    expect(wailsMocks.ValidateObjectYaml).not.toHaveBeenCalled();
    expect(wailsMocks.CheckObjectYamlOwnership).toHaveBeenCalledTimes(1);
    expect(refreshMocks.fetchScopedDomain).toHaveBeenCalledWith(
      'object-yaml',
      'default:pod:demo',
      expect.objectContaining({ isManual: false })
    );

    const editButtonAfterSave = getIconButton(container, 'Edit YAML');
    expect(editButtonAfterSave).toBeTruthy();

    await unmount();
  });

  it('asks for confirmation before saving fields owned by another manager', async () => {
    wailsMocks.CheckObjectYamlOwnership.mockResolvedValue({
      conflicts: [
        {
          field: '.spec.replicas',
          manager: 'flux',
          message: 'conflict with "flux" using apps/v1',
        },
      ],
    });
    wailsMocks.ApplyObjectYaml.mockResolvedValue({ resourceVersion: '789' });
    wailsMocks.GetObjectYAMLByGVK.mockResolvedValue(UPDATED_YAML);

    const { container, unmount } = await renderYamlTab();

    await act(async () => {
      getIconButton(container, 'Edit YAML')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true })
      );
    });
    await act(async () => {
      codeMirrorState.latestProps.current.onChange(UPDATED_YAML);
    });
    await act(async () => {
      getIconButton(container, 'Save YAML')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true })
      );
    });
    await waitForUpdates();

    expect(wailsMocks.ApplyObjectYaml).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('flux');
    expect(document.body.textContent).toContain('spec.replicas');

    const confirmButton = Array.from(document.querySelectorAll('button')).find(
      (button) => button.textContent === 'Save anyway'
    );
    expect(confirmButton).toBeTruthy();

    await act(async () => {
      confirmButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await waitForUpdates();

    expect(wailsMocks.ApplyObjectYaml).toHaveBeenCalledTimes(1);
    expect(wailsMocks.ApplyObjectYaml.mock.calls[0]?.[1]?.yaml).toContain('image: demo:v2');

    await unmount();
  });

  it('keeps editing without saving when the ownership warning is cancelled', async () => {
    wailsMocks.CheckObjectYamlOwnership.mockResolvedValue({
      conflicts: [
        {
          field: '.spec.replicas',
          manager: 'kube-controller-manager',
          message: 'conflict with "kube-controller-manager" using apps/v1',
        },
      ],
    });

    const { container, unmount } = await renderYamlTab();

    await act(async () => {
      getIconButton(container, 'Edit YAML')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true })
      );
    });
    await act(async () => {
      codeMirrorState.latestProps.current.onChange(UPDATED_YAML);
    });
    await act(async () => {
      getIconButton(container, 'Save YAML')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true })
      );
    });
    await waitForUpdates();

    const cancelButton = Array.from(document.querySelectorAll('button')).find(
      (button) => button.textContent === 'Keep editing'
    );
    expect(cancelButton).toBeTruthy();

    await act(async () => {
      cancelButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await waitForUpdates();

    expect(wailsMocks.ApplyObjectYaml).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain('Save anyway');
    // Still editing: the save action remains available.
    expect(getIconButton(container, 'Save YAML')).toBeTruthy();

    await unmount();
  });

  it('discards the draft and exits edit mode via the ownership warning cancel action', async () => {
    wailsMocks.CheckObjectYamlOwnership.mockResolvedValue({
      conflicts: [
        {
          field: '.spec.replicas',
          manager: 'flux',
          message: 'conflict with "flux" using apps/v1',
        },
      ],
    });

    const { container, unmount } = await renderYamlTab();

    await act(async () => {
      getIconButton(container, 'Edit YAML')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true })
      );
    });
    await act(async () => {
      codeMirrorState.latestProps.current.onChange(UPDATED_YAML);
    });
    await act(async () => {
      getIconButton(container, 'Save YAML')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true })
      );
    });
    await waitForUpdates();

    const discardButton = document.querySelector(
      '.confirmation-modal-secondary-action'
    ) as HTMLButtonElement | null;
    expect(discardButton).toBeTruthy();
    expect(discardButton?.textContent).toBe('Cancel');

    await act(async () => {
      discardButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await waitForUpdates();

    expect(wailsMocks.ApplyObjectYaml).not.toHaveBeenCalled();
    expect(document.querySelector('.confirmation-modal')).toBeNull();
    // Edit mode exited: the Edit action is back and Save is gone.
    expect(getIconButton(container, 'Edit YAML')).toBeTruthy();
    expect(getIconButton(container, 'Save YAML')).toBeNull();

    await unmount();
  });

  it('saves without prompting when the ownership check fails', async () => {
    wailsMocks.CheckObjectYamlOwnership.mockRejectedValue(
      new Error('server-side apply not supported')
    );
    wailsMocks.ApplyObjectYaml.mockResolvedValue({ resourceVersion: '789' });
    wailsMocks.GetObjectYAMLByGVK.mockResolvedValue(UPDATED_YAML);

    const { container, unmount } = await renderYamlTab();

    await act(async () => {
      getIconButton(container, 'Edit YAML')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true })
      );
    });
    await act(async () => {
      codeMirrorState.latestProps.current.onChange(UPDATED_YAML);
    });
    await act(async () => {
      getIconButton(container, 'Save YAML')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true })
      );
    });
    await waitForUpdates();

    expect(wailsMocks.ApplyObjectYaml).toHaveBeenCalledTimes(1);
    expect(errorHandlerMock.handle).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ action: 'checkYamlOwnership' })
    );

    await unmount();
  });

  it('preserves full backend mutation target identity when applying YAML', async () => {
    snapshotState.current = {
      status: 'ready',
      data: { yaml: VERIFIED_APPLIED_YAML_WITH_UID },
      error: null,
    };
    wailsMocks.ApplyObjectYaml.mockResolvedValue({ resourceVersion: '790' });
    wailsMocks.GetObjectYAMLByGVK.mockResolvedValue(SECOND_VERIFIED_APPLIED_YAML);

    const { container, unmount } = await renderYamlTab();

    await act(async () => {
      getIconButton(container, 'Edit YAML')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true })
      );
    });

    await act(async () => {
      codeMirrorState.latestProps.current.onChange(SECOND_UPDATED_YAML);
    });

    await act(async () => {
      getIconButton(container, 'Save YAML')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true })
      );
    });

    await waitForUpdates();

    expect(wailsMocks.ApplyObjectYaml).toHaveBeenCalledTimes(1);
    expect(wailsMocks.ApplyObjectYaml.mock.calls[0]?.[0]).toBe('alpha:ctx');
    expect(wailsMocks.ApplyObjectYaml.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        apiVersion: 'v1',
        kind: 'Pod',
        namespace: 'default',
        name: 'demo',
        uid: 'pod-uid-1',
        resourceVersion: '789',
      })
    );

    await unmount();
  });

  it('blocks protected field edits with a local message while editing', async () => {
    const { container, unmount } = await renderYamlTab();

    const editButton = getIconButton(container, 'Edit YAML');
    await act(async () => {
      editButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const transactionFilter = codeMirrorState.latestProps.current.extensions.find(
      (extension: unknown) => typeof extension === 'function'
    ) as
      | ((transaction: {
          docChanged: boolean;
          startState: { doc: { toString: () => string } };
          changes: { iterChanges: (callback: (from: number, to: number) => void) => void };
        }) => unknown)
      | undefined;
    expect(transactionFilter).toBeTruthy();

    let blockedResult: unknown;
    await act(async () => {
      blockedResult = transactionFilter?.({
        docChanged: true,
        startState: { doc: { toString: () => codeMirrorState.value } },
        changes: { iterChanges: (callback) => callback(0, 'apiVersion'.length) },
      });
    });

    expect(blockedResult).toEqual([]);
    expect(container.textContent).toContain(
      'apiVersion is managed by Kubernetes and cannot be edited.'
    );

    const kindIndex = codeMirrorState.value.indexOf('kind:');
    await act(async () => {
      blockedResult = transactionFilter?.({
        docChanged: true,
        startState: { doc: { toString: () => codeMirrorState.value } },
        changes: { iterChanges: (callback) => callback(kindIndex, kindIndex + 'kind'.length) },
      });
    });

    expect(blockedResult).toEqual([]);
    expect(container.textContent).toContain('kind is managed by Kubernetes and cannot be edited.');

    const imageIndex = codeMirrorState.value.indexOf('image: demo:v1');
    const allowedTransaction = {
      docChanged: true,
      startState: { doc: { toString: () => codeMirrorState.value } },
      changes: {
        iterChanges: (callback: (from: number, to: number) => void) =>
          callback(imageIndex, imageIndex),
      },
    };

    expect(transactionFilter?.(allowedTransaction)).toBe(allowedTransaction);

    await unmount();
  });

  it('shows a post-apply notice when the final stored object differs from the submitted YAML', async () => {
    wailsMocks.ApplyObjectYaml.mockResolvedValue({ resourceVersion: '789' });
    wailsMocks.GetObjectYAMLByGVK.mockResolvedValue(POST_APPLY_MUTATED_YAML);

    const { container, unmount } = await renderYamlTab();

    const editButton = getIconButton(container, 'Edit YAML');
    await act(async () => {
      editButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await act(async () => {
      codeMirrorState.latestProps.current.onChange(UPDATED_YAML);
    });

    const saveButton = getIconButton(container, 'Save YAML');
    expect(saveButton).toBeTruthy();
    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await waitForUpdates();

    expect(container.querySelector('.yaml-post-apply-notice')?.textContent).toContain(
      'Your changes were applied to the latest live object'
    );
    expect(container.querySelector('.yaml-post-apply-notice')?.textContent).toContain(
      'restartPolicy: Always'
    );
    const diff = container.querySelector('.yaml-drift-diff');
    expect(diff?.textContent).not.toContain('apiVersion: v1');
    const showFullDiffButton = Array.from(container.querySelectorAll('button')).find((btn) =>
      btn.textContent?.includes('Show full diff')
    );
    expect(showFullDiffButton).toBeTruthy();

    await act(async () => {
      showFullDiffButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container.querySelector('.yaml-drift-diff')?.textContent).toContain('apiVersion: v1');
    expect(codeMirrorState.value).toContain('restartPolicy: Always');

    await unmount();
  });

  it('allows dismissing the post-apply diff notice', async () => {
    wailsMocks.ApplyObjectYaml.mockResolvedValue({ resourceVersion: '789' });
    wailsMocks.GetObjectYAMLByGVK.mockResolvedValue(POST_APPLY_MUTATED_YAML);

    const { container, unmount } = await renderYamlTab();

    const editButton = getIconButton(container, 'Edit YAML');
    await act(async () => {
      editButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await act(async () => {
      codeMirrorState.latestProps.current.onChange(UPDATED_YAML);
    });

    const saveButton = getIconButton(container, 'Save YAML');
    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await waitForUpdates();

    const closeButton = container.querySelector('button[aria-label="Close diff notice"]');
    expect(closeButton).toBeTruthy();

    await act(async () => {
      closeButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container.querySelector('.yaml-post-apply-notice')).toBeNull();

    await unmount();
  });

  it('warns when apply succeeds but the final live object cannot be verified', async () => {
    wailsMocks.ApplyObjectYaml.mockResolvedValue({ resourceVersion: '789' });
    wailsMocks.GetObjectYAMLByGVK.mockRejectedValue(new Error('live read failed'));

    const { container, unmount } = await renderYamlTab();

    const editButton = getIconButton(container, 'Edit YAML');
    await act(async () => {
      editButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await act(async () => {
      codeMirrorState.latestProps.current.onChange(UPDATED_YAML);
    });

    const saveButton = getIconButton(container, 'Save YAML');
    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await waitForUpdates();

    expect(container.querySelector('.yaml-post-apply-notice-warning')?.textContent).toContain(
      'could not reload the final live object'
    );
    expect(codeMirrorState.value).toContain('resourceVersion: "789"');
    expect(errorHandlerMock.handle).toHaveBeenCalledWith(expect.any(Error), {
      action: 'loadLatestObjectYAML',
    });

    await unmount();
  });

  it('does not warn when the final live object only differs by generated annotations', async () => {
    wailsMocks.ApplyObjectYaml.mockResolvedValue({ resourceVersion: '789' });
    wailsMocks.GetObjectYAMLByGVK.mockResolvedValue(
      VERIFIED_APPLIED_YAML_WITH_GENERATED_ANNOTATION
    );

    const { container, unmount } = await renderYamlTab();

    const editButton = getIconButton(container, 'Edit YAML');
    await act(async () => {
      editButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await act(async () => {
      codeMirrorState.latestProps.current.onChange(UPDATED_YAML);
    });

    const saveButton = getIconButton(container, 'Save YAML');
    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await waitForUpdates();

    expect(container.querySelector('.yaml-post-apply-notice')).toBeNull();
    expect(codeMirrorState.value).toContain('deployment.kubernetes.io/revision: "3"');

    await unmount();
  });

  it('warns when the live object changes again after a verified save', async () => {
    wailsMocks.ApplyObjectYaml.mockResolvedValue({ resourceVersion: '789' });
    wailsMocks.GetObjectYAMLByGVK.mockResolvedValue(VERIFIED_APPLIED_YAML);

    const { container, rerender, unmount } = await renderYamlTab();

    const editButton = getIconButton(container, 'Edit YAML');
    await act(async () => {
      editButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await act(async () => {
      codeMirrorState.latestProps.current.onChange(UPDATED_YAML);
    });

    const saveButton = getIconButton(container, 'Save YAML');
    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await waitForUpdates();

    expect(container.querySelector('.yaml-post-apply-notice')).toBeNull();

    snapshotState.current = {
      status: 'ready',
      data: { yaml: VERIFIED_APPLIED_YAML },
      error: null,
    };

    await rerender();
    await waitForUpdates();

    snapshotState.current = {
      status: 'ready',
      data: { yaml: LATER_MUTATED_YAML },
      error: null,
    };

    await rerender();
    await waitForUpdates();
    await waitForUpdates();

    expect(container.querySelector('.yaml-post-apply-notice-stale')?.textContent).toContain(
      'changed again after save'
    );
    expect(container.querySelector('.yaml-post-apply-notice-stale')?.textContent).toContain(
      'restartPolicy: Always'
    );

    await unmount();
  });

  it('does not warn when an older snapshot from a previous save arrives after a rapid second save', async () => {
    wailsMocks.ApplyObjectYaml.mockResolvedValueOnce({
      resourceVersion: '789',
    }).mockResolvedValueOnce({ resourceVersion: '790' });
    wailsMocks.GetObjectYAMLByGVK.mockResolvedValueOnce(
      VERIFIED_APPLIED_YAML
    ).mockResolvedValueOnce(SECOND_VERIFIED_APPLIED_YAML);

    const { container, rerender, unmount } = await renderYamlTab();

    const editButton = getIconButton(container, 'Edit YAML');
    expect(editButton).toBeTruthy();

    await act(async () => {
      editButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await act(async () => {
      codeMirrorState.latestProps.current.onChange(UPDATED_YAML);
    });

    let saveButton = getIconButton(container, 'Save YAML');
    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await waitForUpdates();

    const editButtonAgain = getIconButton(container, 'Edit YAML');
    await act(async () => {
      editButtonAgain?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await act(async () => {
      codeMirrorState.latestProps.current.onChange(SECOND_UPDATED_YAML);
    });

    saveButton = getIconButton(container, 'Save YAML');
    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await waitForUpdates();

    snapshotState.current = {
      status: 'ready',
      data: { yaml: VERIFIED_APPLIED_YAML },
      error: null,
    };

    await rerender();
    await waitForUpdates();

    expect(container.querySelector('.yaml-post-apply-notice-stale')).toBeNull();
    expect(codeMirrorState.value).toContain('image: demo:v3');

    snapshotState.current = {
      status: 'ready',
      data: { yaml: SECOND_VERIFIED_APPLIED_YAML },
      error: null,
    };

    await rerender();
    await waitForUpdates();

    expect(container.querySelector('.yaml-post-apply-notice-stale')).toBeNull();
    expect(codeMirrorState.value).toContain('image: demo:v3');

    await unmount();
  });

  it('does not treat a recreated object as the same post-save target when uid changes', async () => {
    wailsMocks.ApplyObjectYaml.mockResolvedValue({ resourceVersion: '789' });
    wailsMocks.GetObjectYAMLByGVK.mockResolvedValue(VERIFIED_APPLIED_YAML_WITH_UID);

    const { container, rerender, unmount } = await renderYamlTab();

    const editButton = getIconButton(container, 'Edit YAML');
    await act(async () => {
      editButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await act(async () => {
      codeMirrorState.latestProps.current.onChange(UPDATED_YAML);
    });

    const saveButton = getIconButton(container, 'Save YAML');
    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await waitForUpdates();

    snapshotState.current = {
      status: 'ready',
      data: { yaml: VERIFIED_APPLIED_YAML_WITH_UID },
      error: null,
    };

    await rerender();
    await waitForUpdates();

    snapshotState.current = {
      status: 'ready',
      data: { yaml: REPLACEMENT_POD_YAML },
      error: null,
    };

    await rerender();
    await waitForUpdates();

    expect(container.querySelector('.yaml-post-apply-notice-stale')).toBeNull();

    await unmount();
  });

  it('pauses YAML auto-refresh while editing and resumes it after cancel', async () => {
    const { container, unmount } = await renderYamlTab();

    expect(refreshMocks.setScopedDomainEnabled).toHaveBeenCalledWith(
      'object-yaml',
      'default:pod:demo',
      true
    );
    expect(refreshMocks.fetchScopedDomain).toHaveBeenCalledWith(
      'object-yaml',
      'default:pod:demo',
      expect.objectContaining({ isManual: false })
    );

    refreshMocks.setScopedDomainEnabled.mockClear();
    refreshMocks.fetchScopedDomain.mockClear();

    const editButton = getIconButton(container, 'Edit YAML');
    await act(async () => {
      editButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(refreshMocks.setScopedDomainEnabled).toHaveBeenCalledWith(
      'object-yaml',
      'default:pod:demo',
      false
    );
    expect(refreshMocks.fetchScopedDomain).not.toHaveBeenCalled();

    refreshMocks.setScopedDomainEnabled.mockClear();
    refreshMocks.fetchScopedDomain.mockClear();

    const cancelButton = getIconButton(container, 'Cancel edit');
    await act(async () => {
      cancelButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(refreshMocks.setScopedDomainEnabled).toHaveBeenCalledWith(
      'object-yaml',
      'default:pod:demo',
      true
    );
    expect(refreshMocks.fetchScopedDomain).toHaveBeenCalledWith(
      'object-yaml',
      'default:pod:demo',
      expect.objectContaining({ isManual: false })
    );

    await unmount();
  });

  it('keeps drift non-blocking while editing and saves like kubectl edit', async () => {
    wailsMocks.ApplyObjectYaml.mockResolvedValue({ resourceVersion: '790' });
    wailsMocks.GetObjectYAMLByGVK.mockResolvedValue(LATER_MUTATED_YAML);

    const { container, rerender, unmount } = await renderYamlTab();

    const editButton = getIconButton(container, 'Edit YAML');
    await act(async () => {
      editButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await act(async () => {
      codeMirrorState.latestProps.current.onChange(UPDATED_YAML);
    });

    snapshotState.current = {
      status: 'ready',
      data: { yaml: LATER_MUTATED_YAML },
      error: null,
    };
    await rerender();
    await waitForUpdates();

    expect(container.querySelector('.yaml-validation-message')).toBeNull();

    const reloadButton = Array.from(container.querySelectorAll('button')).find((btn) =>
      btn.textContent?.includes('Reload & merge')
    );
    expect(reloadButton).toBeTruthy();

    const saveButton = getIconButton(container, 'Save YAML') as HTMLButtonElement | undefined;
    expect(saveButton).toBeTruthy();
    expect(saveButton?.disabled).toBe(false);

    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await waitForUpdates();

    expect(wailsMocks.ApplyObjectYaml).toHaveBeenCalledTimes(1);

    await unmount();
  });

  it('handles search shortcuts and navigation controls', async () => {
    const { container, unmount } = await renderYamlTab();
    await act(async () => {
      await Promise.resolve();
    });

    const input = container.querySelector('.find-input') as HTMLInputElement;
    expect(input).toBeTruthy();

    codeMirrorState.selectionText = 'demo';
    codeMirrorState.editorView.state.selection = {
      main: { from: 0, to: 4 },
    };
    const searchRegistration = searchShortcutMocks.useSearchShortcutTarget.mock.calls[
      searchShortcutMocks.useSearchShortcutTarget.mock.calls.length - 1
    ]?.[0] as { focus: () => void; isActive: boolean } | undefined;
    expect(searchRegistration?.isActive).toBe(true);

    await act(async () => {
      searchRegistration?.focus();
    });

    await act(async () => {
      await Promise.resolve();
    });
    expect(input.value).toBe('demo');

    const previousMatchButton = getIconButton(container, 'Previous match');
    const nextMatchButton = getIconButton(container, 'Next match');
    codeMirrorState.editorView.dispatch.mockClear();

    await act(async () => {
      Object.defineProperty(input, 'value', { value: '', configurable: true, writable: true });
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(codeMirrorState.editorView.dispatch).toHaveBeenCalledWith({
      selection: { cursor: 0 },
    });
    const initialNextCalls = codemirrorSearchMocks.findNext.mock.calls.length;
    await act(async () => {
      nextMatchButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(codemirrorSearchMocks.findNext.mock.calls.length).toBe(initialNextCalls);

    await act(async () => {
      Object.defineProperty(input, 'value', { value: 'pod', configurable: true, writable: true });
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(codeMirrorState.editorView.dispatch).toHaveBeenCalledWith({
      selection: { cursor: 0 },
    });
    expect(codemirrorSearchMocks.setSearchQuery.of).toHaveBeenCalled();
    expect(codemirrorSearchMocks.findNext).toHaveBeenCalledTimes(1);

    await act(async () => {
      nextMatchButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(codemirrorSearchMocks.findNext).toHaveBeenCalledTimes(2);

    await act(async () => {
      previousMatchButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(codemirrorSearchMocks.findPrevious).toHaveBeenCalled();

    await act(async () => {
      Object.defineProperty(input, 'value', { value: 'pods', configurable: true, writable: true });
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(
      codeMirrorState.editorView.dispatch.mock.calls.filter(
        ([payload]) => payload?.selection?.cursor === 0
      )
    ).toHaveLength(3);
    expect(codemirrorSearchMocks.findNext).toHaveBeenCalledTimes(3);

    const enterEvent = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(enterEvent, 'preventDefault', { value: vi.fn() });
    await act(async () => {
      input.dispatchEvent(enterEvent);
    });
    expect(codemirrorSearchMocks.findNext).toHaveBeenCalledTimes(4);

    const shiftEnterEvent = new KeyboardEvent('keydown', {
      key: 'Enter',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(shiftEnterEvent, 'preventDefault', { value: vi.fn() });
    await act(async () => {
      input.dispatchEvent(shiftEnterEvent);
    });
    expect(codemirrorSearchMocks.findPrevious).toHaveBeenCalledTimes(2);

    const downEvent = new KeyboardEvent('keydown', {
      key: 'ArrowDown',
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(downEvent, 'preventDefault', { value: vi.fn() });
    await act(async () => {
      input.dispatchEvent(downEvent);
    });
    expect(codemirrorSearchMocks.findNext).toHaveBeenCalledTimes(5);

    const upEvent = new KeyboardEvent('keydown', {
      key: 'ArrowUp',
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(upEvent, 'preventDefault', { value: vi.fn() });
    await act(async () => {
      input.dispatchEvent(upEvent);
    });
    expect(codemirrorSearchMocks.findPrevious).toHaveBeenCalledTimes(3);

    const textButtons = Array.from(container.querySelectorAll('button')).map((button) =>
      button.textContent?.trim()
    );
    expect(textButtons).not.toContain('Edit');
    expect(textButtons).not.toContain('Cancel');
    expect(textButtons).not.toContain('Show managedFields');

    const managedFieldsButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Show managedFields"]'
    );
    const editButton = getIconButton(container, 'Edit YAML');
    const saveButton = getIconButton(container, 'Save YAML');
    const caseSensitiveButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Case-sensitive search"]'
    );
    const regexButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Enable regular expression search"]'
    );
    expect(previousMatchButton).toBeTruthy();
    expect(nextMatchButton).toBeTruthy();
    expect(managedFieldsButton).toBeTruthy();
    expect(editButton).toBeTruthy();
    expect(saveButton).toBeNull();
    expect(caseSensitiveButton).toBeTruthy();
    expect(regexButton).toBeTruthy();

    await act(async () => {
      previousMatchButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(codemirrorSearchMocks.findPrevious).toHaveBeenCalledTimes(4);

    await act(async () => {
      nextMatchButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(codemirrorSearchMocks.findNext).toHaveBeenCalledTimes(6);

    await act(async () => {
      caseSensitiveButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(codemirrorSearchMocks.setSearchQuery.of).toHaveBeenCalledWith(
      expect.objectContaining({
        caseSensitive: true,
        regexp: false,
      })
    );

    await act(async () => {
      regexButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(codemirrorSearchMocks.setSearchQuery.of).toHaveBeenCalledWith(
      expect.objectContaining({
        caseSensitive: false,
        regexp: true,
      })
    );
    expect(caseSensitiveButton?.getAttribute('aria-pressed')).toBe('false');
    expect(caseSensitiveButton?.hasAttribute('disabled')).toBe(true);

    const blurSpy = vi.spyOn(input, 'blur');
    const escapeEvent = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(escapeEvent, 'preventDefault', { value: vi.fn() });
    await act(async () => {
      input.dispatchEvent(escapeEvent);
    });
    expect(codeMirrorState.editorView.focus).toHaveBeenCalled();
    expect(blurSpy).toHaveBeenCalled();

    const selectSpy = vi.fn();
    input.select = () => selectSpy();
    const selectEvent = new KeyboardEvent('keydown', {
      key: 'a',
      metaKey: false,
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(selectEvent, 'preventDefault', { value: vi.fn() });
    await act(async () => {
      input.dispatchEvent(selectEvent);
    });
    expect(selectSpy).toHaveBeenCalled();

    await unmount();
  });

  it('stops save when client-side validation fails', async () => {
    const { container, unmount } = await renderYamlTab();

    const editButton = getIconButton(container, 'Edit YAML');
    await act(async () => {
      editButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await act(async () => {
      codeMirrorState.latestProps.current.onChange('');
    });

    const saveButton = getIconButton(container, 'Save YAML');
    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container.textContent).toContain('YAML content is required.');
    await unmount();
  });

  it('allows saving without metadata.resourceVersion like kubectl edit', async () => {
    wailsMocks.ApplyObjectYaml.mockResolvedValue({ resourceVersion: '789' });
    wailsMocks.GetObjectYAMLByGVK.mockResolvedValue(
      UPDATED_YAML.replace('resourceVersion: "123"\n', '')
    );

    snapshotState.current = {
      status: 'ready',
      data: {
        yaml: YAML.replace('  resourceVersion: "123"\n', ''),
      },
      error: null,
    };

    const { container, unmount } = await renderYamlTab();

    const editButton = getIconButton(container, 'Edit YAML');
    await act(async () => {
      editButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const saveButton = getIconButton(container, 'Save YAML');
    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await waitForUpdates();

    expect(wailsMocks.ApplyObjectYaml.mock.calls[0]?.[0]).toBe('alpha:ctx');
    expect(wailsMocks.ApplyObjectYaml.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        apiVersion: 'v1',
        kind: 'Pod',
        namespace: 'default',
        name: 'demo',
        uid: '',
        resourceVersion: '',
      })
    );
    expect(wailsMocks.ApplyObjectYaml.mock.calls[0]?.[1]?.baseYAML).not.toContain(
      'resourceVersion'
    );
    expect(wailsMocks.ApplyObjectYaml.mock.calls[0]?.[1]?.yaml).not.toContain('resourceVersion');
    await unmount();
  });

  it('surfaces backend validation errors', async () => {
    yamlErrorsMocks.parseObjectYamlError.mockReturnValue({
      code: 'ValidationError',
      message: 'Invalid YAML payload',
      causes: ['disallowed field'],
    });
    wailsMocks.ApplyObjectYaml.mockRejectedValue(new Error('invalid'));

    const { container, unmount } = await renderYamlTab();

    const editButton = getIconButton(container, 'Edit YAML');
    await act(async () => {
      editButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await act(async () => {
      codeMirrorState.latestProps.current.onChange(UPDATED_YAML);
    });

    const saveButton = getIconButton(container, 'Save YAML');
    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container.textContent).toContain('Invalid YAML payload');
    expect(container.textContent).toContain('disallowed field');
    await unmount();
  });

  it('surfaces server-side apply ownership conflicts with field details', async () => {
    yamlErrorsMocks.parseObjectYamlError.mockReturnValue({
      code: 'Conflict',
      message:
        'Server-side apply found field ownership conflicts. Reload the latest object or remove the conflicting field edits listed below.',
      causes: ['spec.replicas: conflict with "deployment-controller" using apps/v1'],
    });
    wailsMocks.ApplyObjectYaml.mockRejectedValue(new Error('conflict'));

    const { container, unmount } = await renderYamlTab();

    const editButton = getIconButton(container, 'Edit YAML');
    await act(async () => {
      editButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await act(async () => {
      codeMirrorState.latestProps.current.onChange(UPDATED_YAML);
    });

    const saveButton = getIconButton(container, 'Save YAML');
    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container.textContent).toContain('field ownership conflicts');
    expect(container.textContent).toContain('spec.replicas');
    expect(container.textContent).toContain('deployment-controller');

    await unmount();
  });

  it('shows generic error when apply fails without parser details', async () => {
    wailsMocks.ApplyObjectYaml.mockRejectedValue(new Error('network down'));
    yamlErrorsMocks.parseObjectYamlError.mockReturnValue(null);

    const { container, unmount } = await renderYamlTab();

    const editButton = getIconButton(container, 'Edit YAML');
    await act(async () => {
      editButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await act(async () => {
      codeMirrorState.latestProps.current.onChange(UPDATED_YAML);
    });

    const saveButton = getIconButton(container, 'Save YAML');
    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await waitForUpdates();

    expect(container.textContent).toContain('network down');
    expect(errorHandlerMock.handle).toHaveBeenCalledWith(expect.any(Error), {
      action: 'saveObjectYAML',
    });

    await unmount();
  });

  it('evaluates managed fields and save shortcuts across editing states', async () => {
    wailsMocks.ApplyObjectYaml.mockResolvedValue({ resourceVersion: '456' });
    wailsMocks.GetObjectYAMLByGVK.mockResolvedValue(UPDATED_YAML);

    const { container, unmount } = await renderYamlTab();

    const managedShortcut = shortcutMocks.useShortcut.mock.calls.find(
      ([config]) => (config as { key: string }).key === 'm'
    )?.[0] as { handler: () => boolean } | undefined;
    let toggleResult = false;
    await act(async () => {
      toggleResult = managedShortcut?.handler() ?? false;
    });
    expect(toggleResult).toBe(true);

    const saveShortcut = shortcutMocks.useShortcut.mock.calls.find(([config]) => {
      const entry = config as { key: string; modifiers?: { meta?: boolean } };
      return entry.key === 's' && entry.modifiers?.meta;
    })?.[0] as { handler: () => boolean } | undefined;
    let saveResult = true;
    await act(async () => {
      saveResult = saveShortcut?.handler() ?? true;
    });
    expect(saveResult).toBe(false);

    const editButton = getIconButton(container, 'Edit YAML');
    await act(async () => {
      editButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await waitForUpdates();

    const updatedManagedShortcut = shortcutMocks.useShortcut.mock.calls
      .filter(([config]) => (config as { key: string }).key === 'm')
      .pop()?.[0] as { handler: () => boolean } | undefined;
    await act(async () => {
      toggleResult = updatedManagedShortcut?.handler() ?? true;
    });
    expect(toggleResult).toBe(false);

    await act(async () => {
      codeMirrorState.latestProps.current.onChange(UPDATED_YAML);
    });

    const updatedSaveShortcut = shortcutMocks.useShortcut.mock.calls
      .filter(([config]) => {
        const entry = config as { key: string; modifiers?: { meta?: boolean } };
        return entry.key === 's' && entry.modifiers?.meta;
      })
      .pop()?.[0] as { handler: () => boolean } | undefined;

    saveResult = false;
    await act(async () => {
      saveResult = updatedSaveShortcut?.handler() ?? false;
      await Promise.resolve();
    });
    expect(saveResult).toBe(true);
    expect(wailsMocks.ApplyObjectYaml).toHaveBeenCalled();

    await unmount();
  });

  it('ignores search shortcut when tab inactive', async () => {
    const { unmount } = await renderYamlTab({ isActive: false });

    const registration = searchShortcutMocks.useSearchShortcutTarget.mock.calls[
      searchShortcutMocks.useSearchShortcutTarget.mock.calls.length - 1
    ]?.[0] as { isActive: boolean } | undefined;
    expect(registration?.isActive).toBe(false);

    await unmount();
  });

  it('renders loading, error, and empty states appropriately', async () => {
    snapshotState.current = { status: 'loading', data: { yaml: null }, error: null };
    let render = await renderYamlTab();
    expect(render.container.textContent).toContain('Loading YAML');
    await render.unmount();

    snapshotState.current = { status: 'error', data: { yaml: YAML }, error: 'boom' };
    render = await renderYamlTab();
    expect(render.container.textContent).toContain('Error loading YAML: boom');
    await render.unmount();

    snapshotState.current = { status: 'ready', data: { yaml: '' }, error: null };
    render = await renderYamlTab();
    expect(render.container.textContent).toContain('No YAML content available');
    await render.unmount();

    const largeYaml = `kind: Pod\nmetadata:\n  name: demo\n${'a'.repeat(160000)}`;
    snapshotState.current = { status: 'ready', data: { yaml: largeYaml }, error: null };
    render = await renderYamlTab();
    expect(render.container.textContent).toContain('Large manifest detected');
    await render.unmount();
  });
});
