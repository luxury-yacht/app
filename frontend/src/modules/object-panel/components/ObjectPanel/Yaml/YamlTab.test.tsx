/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Yaml/YamlTab.test.tsx
 */

import React, { act } from 'react';
import ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type SnapshotStatus = 'idle' | 'loading' | 'ready' | 'updating' | 'initialising' | 'error';

const shortcutMocks = vi.hoisted(() => ({
  useShortcut: vi.fn(),
  useKeyboardSurface: vi.fn(),
}));
const searchShortcutMocks = vi.hoisted(() => ({
  useSearchShortcutTarget: vi.fn(),
}));
const createResourceModalMocks = vi.hoisted(() => ({
  latestProps: null as any,
}));

const refreshMocks = vi.hoisted(() => ({
  setScopedDomainEnabled: vi.fn(),
  fetchScopedDomain: vi.fn(() => Promise.resolve()),
  resetScopedDomain: vi.fn(),
}));

const refreshStoreMocks = vi.hoisted(() => ({
  useRefreshScopedDomain: vi.fn(),
}));

const codeMirrorState = {
  latestProps: { current: null as any },
  editorView: {
    state: {
      selection: { main: { from: 0, to: 0 } },
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

const CodeMirrorMock = React.forwardRef((_props: any, ref) => {
  const props = _props;
  const { onCreateEditor } = props;
  codeMirrorState.value = props.value;
  codeMirrorState.latestProps.current = props;
  if (ref && typeof ref === 'object' && ref !== null) {
    (ref as React.RefObject<{ view: typeof codeMirrorState.editorView } | null>).current = {
      view: codeMirrorState.editorView as any,
    };
  }
  React.useEffect(() => {
    onCreateEditor?.(codeMirrorState.editorView as any);
  }, [onCreateEditor]);
  return (
    <div data-testid="code-mirror" data-value={props.value}>
      {props.value}
    </div>
  );
});
CodeMirrorMock.displayName = 'CodeMirrorMock';

const yamlErrorsMocks = vi.hoisted(() => ({
  parseObjectYamlError: vi.fn(),
}));

const wailsMocks = vi.hoisted(() => ({
  ValidateObjectYaml: vi.fn(),
  ApplyObjectYaml: vi.fn(),
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

vi.mock('@ui/modals/CreateResourceModal', () => ({
  __esModule: true,
  default: (props: any) => {
    createResourceModalMocks.latestProps = props;
    if (!props.isOpen) {
      return null;
    }
    return (
      <div data-testid="edit-resource-modal">
        {props.request?.mode}:{props.request?.identity?.kind}:{props.request?.identity?.name}
      </div>
    );
  },
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
  EditorView: class {
    static domEventHandlers(handlers: unknown) {
      return handlers;
    }
  },
  keymap: {
    of: (bindings: unknown) => bindings,
  },
  lineWrapping: 'lineWrapping',
}));

vi.mock('@codemirror/state', () => ({
  EditorSelection: {
    cursor: (position: number) => ({ cursor: position }),
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
  GetObjectYAMLByGVK: wailsMocks.GetObjectYAMLByGVK,
  MergeObjectYamlWithLatest: wailsMocks.MergeObjectYamlWithLatest,
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
    createResourceModalMocks.latestProps = null;
    codeMirrorState.value = '';
    codeMirrorState.latestProps.current = null;
    codeMirrorState.editorView.state.selection = { main: { from: 0, to: 0 }, ranges: [] } as any;
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
    } as any;
    codeMirrorState.selectionText = 'apiVersion';

    const surfaceConfig = shortcutMocks.useKeyboardSurface.mock.calls
      .map(([config]) => config as { onNativeAction?: (context: any) => boolean })
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
    } as any;
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
        codeMirrorState.editorView as any
      );
      await Promise.resolve();
    });

    const copyItem = Array.from(document.querySelectorAll('.context-menu-item')).find((item) =>
      item.textContent?.includes('Copy')
    );
    expect(copyItem?.getAttribute('aria-disabled')).toBe('false');

    await unmount();
  });

  it('pastes native menu text into the editor while editing', async () => {
    const { container, unmount } = await renderYamlTab();

    const editButton = getIconButton(container, 'Edit YAML');
    await act(async () => {
      editButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    codeMirrorState.editorView.state.selection.main = { from: 0, to: 0 } as any;

    const surfaceConfig = shortcutMocks.useKeyboardSurface.mock.calls
      .map(([config]) => config as { onNativeAction?: (context: any) => boolean })
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
    expect(wailsMocks.ValidateObjectYaml).not.toHaveBeenCalled();
    expect(refreshMocks.fetchScopedDomain).toHaveBeenCalledWith(
      'object-yaml',
      'default:pod:demo',
      expect.objectContaining({ isManual: true })
    );

    const editButtonAfterSave = getIconButton(container, 'Edit YAML');
    expect(editButtonAfterSave).toBeTruthy();

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
      expect.objectContaining({ isManual: true })
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
      expect.objectContaining({ isManual: true })
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
    } as any;
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
    input.select = selectSpy as any;
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
    expect(toggleResult).toBe(true);

    const updatedSaveShortcut = shortcutMocks.useShortcut.mock.calls
      .filter(([config]) => {
        const entry = config as { key: string; modifiers?: { meta?: boolean } };
        return entry.key === 's' && entry.modifiers?.meta;
      })
      .pop()?.[0] as { handler: () => boolean } | undefined;

    saveResult = true;
    await act(async () => {
      saveResult = updatedSaveShortcut?.handler() ?? true;
      await Promise.resolve();
    });
    expect(saveResult).toBe(false);
    expect(container.querySelector('[data-testid="edit-resource-modal"]')).toBeTruthy();

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

    const largeYaml = 'kind: Pod\nmetadata:\n  name: demo\n' + 'a'.repeat(160000);
    snapshotState.current = { status: 'ready', data: { yaml: largeYaml }, error: null };
    render = await renderYamlTab();
    expect(render.container.textContent).toContain('Large manifest detected');
    await render.unmount();
  });
});
