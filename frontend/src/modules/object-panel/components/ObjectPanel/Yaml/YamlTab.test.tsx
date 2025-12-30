/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Yaml/YamlTab.test.tsx
 *
 * Test suite for YamlTab.
 * Covers key behaviors and edge cases for YamlTab.
 */

import React, { act } from 'react';
import ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type SnapshotStatus = 'idle' | 'loading' | 'ready' | 'updating' | 'initialising' | 'error';

const shortcutMocks = vi.hoisted(() => ({
  useShortcut: vi.fn(),
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
  coerceDiffResult: vi.fn(() => ({
    truncated: false,
    lines: [
      {
        type: 'added' as const,
        leftLineNumber: null,
        rightLineNumber: 1,
        value: 'metadata:',
      },
    ],
  })),
}));

const wailsMocks = vi.hoisted(() => ({
  ValidateObjectYaml: vi.fn(),
  ApplyObjectYaml: vi.fn(),
  GetObjectYAML: vi.fn(),
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
  EditorView: class {},
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

vi.mock('@/core/codemirror/search', () => ({
  createSearchExtensions: searchModuleMocks.createSearchExtensions,
  closeSearchPanel: searchModuleMocks.closeSearchPanel,
}));

vi.mock('./yamlErrors', () => ({
  parseObjectYamlError: yamlErrorsMocks.parseObjectYamlError,
  coerceDiffResult: yamlErrorsMocks.coerceDiffResult,
}));

vi.mock('@utils/errorHandler', () => ({
  errorHandler: {
    handle: errorHandlerMock.handle,
  },
}));

vi.mock('@wailsjs/go/backend/App', () => ({
  ValidateObjectYaml: wailsMocks.ValidateObjectYaml,
  ApplyObjectYaml: wailsMocks.ApplyObjectYaml,
  GetObjectYAML: wailsMocks.GetObjectYAML,
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
    codeMirrorState.latestProps.current = null;
    codeMirrorState.editorView.dispatch.mockClear();
    codeMirrorState.editorView.focus.mockClear();
    refreshMocks.setScopedDomainEnabled.mockClear();
    refreshMocks.fetchScopedDomain.mockClear();
    refreshMocks.resetScopedDomain.mockClear();
    shortcutMocks.useShortcut.mockClear();
    searchShortcutMocks.useSearchShortcutTarget.mockClear();
    searchModuleMocks.createSearchExtensions.mockClear();
    searchModuleMocks.closeSearchPanel.mockClear();
    wailsMocks.ValidateObjectYaml.mockReset();
    wailsMocks.ApplyObjectYaml.mockReset();
    wailsMocks.GetObjectYAML.mockReset();
    yamlErrorsMocks.parseObjectYamlError.mockReset();
    yamlErrorsMocks.coerceDiffResult.mockClear();
    errorHandlerMock.handle.mockClear();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('normalizes YAML output and toggles managed fields', async () => {
    const { container, unmount } = await renderYamlTab();

    expect(codeMirrorState.value).not.toContain('managedFields');

    const toggleButton = Array.from(container.querySelectorAll('button')).find((btn) =>
      btn.textContent?.includes('managedFields')
    );
    expect(toggleButton).toBeTruthy();

    await act(async () => {
      toggleButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await waitForUpdates();

    expect(codeMirrorState.value).toContain('managedFields');

    await unmount();
  });

  it('saves edited YAML and refreshes the snapshot', async () => {
    wailsMocks.ValidateObjectYaml.mockResolvedValue({ resourceVersion: '456' });
    wailsMocks.ApplyObjectYaml.mockResolvedValue({ resourceVersion: '789' });
    wailsMocks.GetObjectYAML.mockResolvedValue(UPDATED_YAML);

    const { container, unmount } = await renderYamlTab();

    const editButton = Array.from(container.querySelectorAll('button')).find((btn) =>
      btn.textContent?.includes('Edit')
    );
    expect(editButton).toBeTruthy();

    await act(async () => {
      editButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await act(async () => {
      codeMirrorState.latestProps.current.onChange(UPDATED_YAML);
    });

    const saveButton = Array.from(container.querySelectorAll('button')).find((btn) =>
      btn.textContent?.includes('Save')
    );
    expect(saveButton).toBeTruthy();

    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await waitForUpdates();

    expect(wailsMocks.ValidateObjectYaml).toHaveBeenCalledTimes(1);
    expect(wailsMocks.ApplyObjectYaml).toHaveBeenCalledTimes(1);
    expect(refreshMocks.fetchScopedDomain).toHaveBeenCalledWith(
      'object-yaml',
      'default:pod:demo',
      expect.objectContaining({ isManual: true })
    );

    const editButtonAfterSave = Array.from(container.querySelectorAll('button')).find((btn) =>
      btn.textContent?.includes('Edit')
    );
    expect(editButtonAfterSave).toBeTruthy();

    await unmount();
  });

  it('handles resource version mismatches by surfacing drift diff and reload option', async () => {
    yamlErrorsMocks.parseObjectYamlError.mockReturnValue({
      code: 'ResourceVersionMismatch',
      message: 'Object changed upstream',
      causes: ['Remote diff detected'],
      currentResourceVersion: '999',
    });
    wailsMocks.ValidateObjectYaml.mockRejectedValue(new Error('mismatch'));
    wailsMocks.GetObjectYAML.mockResolvedValue(UPDATED_YAML);

    const { container, unmount } = await renderYamlTab();

    const editButton = Array.from(container.querySelectorAll('button')).find((btn) =>
      btn.textContent?.includes('Edit')
    );
    await act(async () => {
      editButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await act(async () => {
      codeMirrorState.latestProps.current.onChange(UPDATED_YAML);
    });

    const saveButton = Array.from(container.querySelectorAll('button')).find((btn) =>
      btn.textContent?.includes('Save')
    );
    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await waitForUpdates();

    const warning = container.querySelector('.yaml-validation-message');
    expect(warning?.textContent).toContain('Object changed upstream');
    expect(container.querySelector('.yaml-drift-diff')).toBeTruthy();

    const reloadButton = Array.from(container.querySelectorAll('button')).find((btn) =>
      btn.textContent?.includes('Reload')
    );
    expect(reloadButton).toBeTruthy();

    await act(async () => {
      reloadButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await waitForUpdates();

    expect(wailsMocks.GetObjectYAML).toHaveBeenCalled();
    expect(refreshMocks.fetchScopedDomain).toHaveBeenCalledWith(
      'object-yaml',
      'default:pod:demo',
      expect.objectContaining({ isManual: true })
    );

    await unmount();
  });

  it('reports reload errors when merge fails', async () => {
    yamlErrorsMocks.parseObjectYamlError.mockReturnValue({
      code: 'ResourceVersionMismatch',
      message: 'Conflict detected',
      causes: [],
    });
    wailsMocks.ValidateObjectYaml.mockRejectedValue(new Error('mismatch'));
    wailsMocks.GetObjectYAML.mockRejectedValue(new Error('reload failed'));

    const { container, unmount } = await renderYamlTab();

    const editButton = Array.from(container.querySelectorAll('button')).find((btn) =>
      btn.textContent?.includes('Edit')
    );
    await act(async () => {
      editButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await act(async () => {
      codeMirrorState.latestProps.current.onChange(UPDATED_YAML);
    });

    const saveButton = Array.from(container.querySelectorAll('button')).find((btn) =>
      btn.textContent?.includes('Save')
    );
    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await act(async () => {
      await Promise.resolve();
    });

    const reloadButton = Array.from(container.querySelectorAll('button')).find((btn) =>
      btn.textContent?.includes('Reload')
    );
    await act(async () => {
      reloadButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container.textContent).toContain('reload failed');
    expect(errorHandlerMock.handle).toHaveBeenCalledWith(expect.any(Error), {
      action: 'reloadAndMerge',
    });

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

    const navButtons = container.querySelectorAll('.find-nav button');

    await act(async () => {
      Object.defineProperty(input, 'value', { value: '', configurable: true, writable: true });
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const initialNextCalls = codemirrorSearchMocks.findNext.mock.calls.length;
    await act(async () => {
      navButtons[1].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(codemirrorSearchMocks.findNext.mock.calls.length).toBe(initialNextCalls);

    await act(async () => {
      Object.defineProperty(input, 'value', { value: 'pod', configurable: true, writable: true });
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(codemirrorSearchMocks.setSearchQuery.of).toHaveBeenCalled();

    await act(async () => {
      navButtons[1].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(codemirrorSearchMocks.findNext).toHaveBeenCalled();

    await act(async () => {
      navButtons[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(codemirrorSearchMocks.findPrevious).toHaveBeenCalled();

    const enterEvent = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(enterEvent, 'preventDefault', { value: vi.fn() });
    await act(async () => {
      input.dispatchEvent(enterEvent);
    });
    expect(codemirrorSearchMocks.findNext).toHaveBeenCalledTimes(2);

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

    const editButton = Array.from(container.querySelectorAll('button')).find((btn) =>
      btn.textContent?.includes('Edit')
    );
    await act(async () => {
      editButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await act(async () => {
      codeMirrorState.latestProps.current.onChange('');
    });

    const saveButton = Array.from(container.querySelectorAll('button')).find((btn) =>
      btn.textContent?.includes('Save')
    );
    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container.textContent).toContain('YAML content is required.');
    await unmount();
  });

  it('requires metadata.resourceVersion before saving', async () => {
    snapshotState.current = {
      status: 'ready',
      data: {
        yaml: YAML.replace('  resourceVersion: "123"\n', ''),
      },
      error: null,
    };

    const { container, unmount } = await renderYamlTab();

    const editButton = Array.from(container.querySelectorAll('button')).find((btn) =>
      btn.textContent?.includes('Edit')
    );
    await act(async () => {
      editButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const saveButton = Array.from(container.querySelectorAll('button')).find((btn) =>
      btn.textContent?.includes('Save')
    );
    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container.textContent).toContain('metadata.resourceVersion is required');
    await unmount();
  });

  it('surfaces backend validation errors', async () => {
    yamlErrorsMocks.parseObjectYamlError.mockReturnValue({
      code: 'ValidationError',
      message: 'Invalid YAML payload',
      causes: ['disallowed field'],
    });
    wailsMocks.ValidateObjectYaml.mockRejectedValue(new Error('invalid'));

    const { container, unmount } = await renderYamlTab();

    const editButton = Array.from(container.querySelectorAll('button')).find((btn) =>
      btn.textContent?.includes('Edit')
    );
    await act(async () => {
      editButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await act(async () => {
      codeMirrorState.latestProps.current.onChange(UPDATED_YAML);
    });

    const saveButton = Array.from(container.querySelectorAll('button')).find((btn) =>
      btn.textContent?.includes('Save')
    );
    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container.textContent).toContain('Invalid YAML payload');
    expect(container.textContent).toContain('disallowed field');
    await unmount();
  });

  it('shows generic error when apply fails without parser details', async () => {
    wailsMocks.ValidateObjectYaml.mockResolvedValue({ resourceVersion: '456' });
    wailsMocks.ApplyObjectYaml.mockRejectedValue(new Error('network down'));
    yamlErrorsMocks.parseObjectYamlError.mockReturnValue(null);

    const { container, unmount } = await renderYamlTab();

    const editButton = Array.from(container.querySelectorAll('button')).find((btn) =>
      btn.textContent?.includes('Edit')
    );
    await act(async () => {
      editButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await act(async () => {
      codeMirrorState.latestProps.current.onChange(UPDATED_YAML);
    });

    const saveButton = Array.from(container.querySelectorAll('button')).find((btn) =>
      btn.textContent?.includes('Save')
    );
    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container.textContent).toContain('network down');
    expect(errorHandlerMock.handle).toHaveBeenCalledWith(expect.any(Error), {
      action: 'saveObjectYAML',
    });

    await unmount();
  });

  it('evaluates managed fields and save shortcuts across editing states', async () => {
    wailsMocks.ValidateObjectYaml.mockResolvedValue({ resourceVersion: '456' });
    wailsMocks.ApplyObjectYaml.mockResolvedValue({ resourceVersion: '456' });
    wailsMocks.GetObjectYAML.mockResolvedValue(UPDATED_YAML);

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

    const editButton = Array.from(container.querySelectorAll('button')).find((btn) =>
      btn.textContent?.includes('Edit')
    );
    await act(async () => {
      editButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

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

    const largeYaml = 'kind: Pod\nmetadata:\n  name: demo\n' + 'a'.repeat(160000);
    snapshotState.current = { status: 'ready', data: { yaml: largeYaml }, error: null };
    render = await renderYamlTab();
    expect(render.container.textContent).toContain('Large manifest detected');
    await render.unmount();
  });
});
