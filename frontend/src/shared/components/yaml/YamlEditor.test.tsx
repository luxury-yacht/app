import type React from 'react';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { YamlEditorProps } from './YamlEditor';

interface CapturedCodeMirrorProps {
  value: string;
  onChange: (value: string) => void;
  extensions?: unknown[];
  onCreateEditor?: (view: unknown) => void;
  'aria-label'?: string;
}

const shortcutMocks = vi.hoisted(() => ({
  useKeyboardSurface: vi.fn(),
  useSearchShortcutTarget: vi.fn(),
}));

const nativeActionMocks = vi.hoisted(() => ({
  copyCodeMirrorSelection: vi.fn(() => true),
  cutCodeMirrorSelection: vi.fn(() => true),
  getCodeMirrorSelectedText: vi.fn(() => 'selected'),
  selectCodeMirrorContent: vi.fn(() => true),
}));

const wailsRuntimeMocks = vi.hoisted(() => ({
  ClipboardGetText: vi.fn(() => Promise.resolve('clipboard-text')),
}));

const searchMocks = vi.hoisted(() => {
  class SearchQuery {
    search!: string;

    constructor(options: Record<string, unknown>) {
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
      literal: true,
      regexp: false,
      wholeWord: false,
      replace: '',
    })),
    setSearchQuery: { of: vi.fn((query: unknown) => query) },
  };
});

const codeMirrorState = vi.hoisted(() => ({
  props: {
    value: '',
    onChange: () => undefined,
  } as CapturedCodeMirrorProps,
  editorView: {
    state: {
      selection: { main: { from: 0, to: 0 } },
      sliceDoc: vi.fn(() => ''),
    },
    dispatch: vi.fn(),
    focus: vi.fn(),
  },
  contextMenuHandler: null as ((event: MouseEvent, view: unknown) => boolean) | null,
  transactionFilters: [] as Array<(transaction: unknown) => unknown>,
  decorationRanges: [] as Array<{ from: number; to: number; spec: Record<string, unknown> }>,
}));

vi.mock('@uiw/react-codemirror', async () => {
  const ReactModule = await vi.importActual<typeof import('react')>('react');
  const ExternalChange = {
    of: (value: boolean) => ({ type: 'externalChange', value }),
  };
  const CodeMirrorMock = ReactModule.forwardRef((props: CapturedCodeMirrorProps, ref) => {
    codeMirrorState.props = props;
    codeMirrorState.decorationRanges = [];
    props.extensions?.forEach((extension: unknown) => {
      if (
        extension &&
        typeof extension === 'object' &&
        'compute' in extension &&
        typeof (extension as { compute?: unknown }).compute === 'function'
      ) {
        (extension as { compute: (state: { doc: { toString: () => string } }) => unknown }).compute(
          {
            doc: { toString: () => props.value },
          }
        );
      }
    });
    const contextMenuExtension = props.extensions?.find(
      (extension): extension is { contextmenu: (event: MouseEvent, view: unknown) => boolean } =>
        Boolean(
          extension &&
            typeof extension === 'object' &&
            'contextmenu' in extension &&
            typeof (extension as { contextmenu?: unknown }).contextmenu === 'function'
        )
    );
    codeMirrorState.contextMenuHandler = contextMenuExtension?.contextmenu ?? null;

    if (ref && typeof ref === 'object') {
      (ref as React.RefObject<{ view: typeof codeMirrorState.editorView } | null>).current = {
        view: codeMirrorState.editorView,
      };
    }

    ReactModule.useEffect(() => {
      props.onCreateEditor?.(codeMirrorState.editorView);
    }, [props]);

    return ReactModule.createElement(
      'div',
      {
        'data-testid': 'code-mirror',
        'aria-label': props['aria-label'],
        onContextMenu: (event: React.MouseEvent) => {
          codeMirrorState.contextMenuHandler?.(event.nativeEvent, codeMirrorState.editorView);
        },
      },
      props.value
    );
  });
  CodeMirrorMock.displayName = 'CodeMirrorMock';

  return {
    __esModule: true,
    default: CodeMirrorMock,
    ExternalChange,
  };
});

vi.mock('@codemirror/lang-yaml', () => ({
  yaml: () => 'yaml-extension',
}));

vi.mock('@codemirror/view', () => ({
  Decoration: {
    mark: (spec: Record<string, unknown>) => ({
      range: (from: number, to: number) => {
        const range = { from, to, spec };
        codeMirrorState.decorationRanges.push(range);
        return range;
      },
    }),
    set: (ranges: Array<{ from: number; to: number }>) => {
      for (let index = 1; index < ranges.length; index += 1) {
        if (ranges[index - 1].from > ranges[index].from) {
          throw new Error('Ranges must be added sorted by `from` position and `startSide`');
        }
      }
      return ranges;
    },
  },
  EditorView: Object.assign(class EditorViewMock {}, {
    decorations: {
      of: (decorations: unknown) => ({ type: 'decorations', decorations }),
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
    of: (bindings: unknown) => ({ type: 'keymap', bindings }),
  },
}));

vi.mock('@codemirror/state', () => ({
  EditorSelection: {
    cursor: (position: number) => ({ cursor: position }),
  },
  EditorState: {
    transactionFilter: {
      of: (filter: (transaction: unknown) => unknown) => {
        codeMirrorState.transactionFilters.push(filter);
        return { type: 'transactionFilter', filter };
      },
    },
  },
}));

vi.mock('@codemirror/search', () => ({
  SearchQuery: searchMocks.SearchQuery,
  findNext: searchMocks.findNext,
  findPrevious: searchMocks.findPrevious,
  getSearchQuery: searchMocks.getSearchQuery,
  setSearchQuery: searchMocks.setSearchQuery,
}));

vi.mock('@/core/codemirror/theme', () => ({
  buildCodeTheme: () => ({ theme: 'theme-extension', highlight: 'highlight-extension' }),
}));

vi.mock('@/core/codemirror/search', () => ({
  createSearchExtensions: () => ['search-extension'],
  closeSearchPanel: vi.fn(),
}));

vi.mock('@/core/codemirror/nativeActions', () => nativeActionMocks);

vi.mock('@wailsjs/runtime/runtime', () => wailsRuntimeMocks);

vi.mock('@ui/shortcuts', () => ({
  useKeyboardSurface: (config: unknown) => shortcutMocks.useKeyboardSurface(config),
  useSearchShortcutTarget: (config: unknown) => shortcutMocks.useSearchShortcutTarget(config),
}));

vi.mock('@ui/shortcuts/context', () => ({
  deriveCopyText: () => '',
}));

vi.mock('@core/contexts/ZoomContext', () => ({
  useZoom: () => ({ zoomLevel: 100 }),
}));

const renderYamlEditor = async (props: Partial<YamlEditorProps> = {}) => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = ReactDOM.createRoot(container);

  await act(async () => {
    const { default: YamlEditor } = await import('./YamlEditor');
    root.render(<YamlEditor value="kind: ConfigMap\n" ariaLabel="YAML editor" {...props} />);
  });

  return {
    container,
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
};

describe('YamlEditor', () => {
  beforeEach(() => {
    shortcutMocks.useKeyboardSurface.mockClear();
    shortcutMocks.useSearchShortcutTarget.mockClear();
    nativeActionMocks.copyCodeMirrorSelection.mockClear();
    nativeActionMocks.cutCodeMirrorSelection.mockClear();
    nativeActionMocks.getCodeMirrorSelectedText.mockClear();
    nativeActionMocks.selectCodeMirrorContent.mockClear();
    wailsRuntimeMocks.ClipboardGetText.mockClear();
    searchMocks.findNext.mockClear();
    searchMocks.findPrevious.mockClear();
    codeMirrorState.props = { value: '', onChange: () => undefined };
    codeMirrorState.editorView.dispatch.mockClear();
    codeMirrorState.editorView.focus.mockClear();
    codeMirrorState.editorView.state.sliceDoc.mockClear();
    codeMirrorState.contextMenuHandler = null;
    codeMirrorState.transactionFilters = [];
    codeMirrorState.decorationRanges = [];
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn(() => Promise.resolve()),
        readText: vi.fn(() => Promise.resolve('pasted')),
      },
    });
  });

  afterEach(() => {
    document.body.textContent = '';
  });

  it('allows callers to disable line wrapping', async () => {
    const { unmount } = await renderYamlEditor({ lineWrapping: false });

    expect(codeMirrorState.props.extensions).not.toContain('lineWrapping');
    await unmount();
  });

  it('renders view-only YAML and suppresses changes', async () => {
    const onChange = vi.fn();
    const { container, unmount } = await renderYamlEditor({
      value: 'metadata:\n  name: demo\n',
      editable: false,
      onChange,
    });

    expect(container.textContent).toContain('metadata:');

    await act(async () => {
      codeMirrorState.props.onChange('changed');
    });

    expect(onChange).not.toHaveBeenCalled();
    await unmount();
  });

  it('calls onChange only when editable and enabled', async () => {
    const onChange = vi.fn();
    const { unmount } = await renderYamlEditor({ editable: true, onChange });

    await act(async () => {
      codeMirrorState.props.onChange('changed');
    });

    expect(onChange).toHaveBeenCalledWith('changed');
    await unmount();

    onChange.mockClear();
    const disabled = await renderYamlEditor({ editable: true, disabled: true, onChange });

    await act(async () => {
      codeMirrorState.props.onChange('ignored');
    });

    expect(onChange).not.toHaveBeenCalled();
    await disabled.unmount();
  });

  it('registers search and native-action ownership with caller activation metadata', async () => {
    const { unmount } = await renderYamlEditor({
      active: false,
      shortcutLabel: 'Helm manifest search',
      shortcutPriority: 20,
    });

    expect(shortcutMocks.useSearchShortcutTarget).toHaveBeenCalledWith(
      expect.objectContaining({
        isActive: false,
        label: 'Helm manifest search',
        priority: 20,
      })
    );
    expect(shortcutMocks.useKeyboardSurface).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'editor',
        active: false,
        priority: 20,
      })
    );

    await unmount();
  });

  it('handles native copy, select-all, and editable paste through the editor surface', async () => {
    const { unmount } = await renderYamlEditor({ editable: true });
    const surfaceCalls = shortcutMocks.useKeyboardSurface.mock.calls;
    const surfaceConfig = surfaceCalls[surfaceCalls.length - 1]?.[0] as {
      onNativeAction: (event: { action: string; text?: string }) => boolean;
    };

    expect(surfaceConfig.onNativeAction({ action: 'copy' })).toBe(true);
    expect(nativeActionMocks.copyCodeMirrorSelection).toHaveBeenCalledWith(
      codeMirrorState.editorView
    );
    expect(surfaceConfig.onNativeAction({ action: 'selectAll' })).toBe(true);
    expect(nativeActionMocks.selectCodeMirrorContent).toHaveBeenCalledWith(
      codeMirrorState.editorView
    );
    expect(surfaceConfig.onNativeAction({ action: 'paste', text: 'abc' })).toBe(true);
    expect(codeMirrorState.editorView.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        changes: { from: 0, to: 0, insert: 'abc' },
      })
    );

    await unmount();
  });

  it('handles native cut through the editor surface only when editable', async () => {
    const editableEditor = await renderYamlEditor({ editable: true });
    let surfaceCalls = shortcutMocks.useKeyboardSurface.mock.calls;
    let surfaceConfig = surfaceCalls[surfaceCalls.length - 1]?.[0] as {
      onNativeAction: (event: { action: string }) => boolean;
    };

    expect(surfaceConfig.onNativeAction({ action: 'cut' })).toBe(true);
    expect(nativeActionMocks.cutCodeMirrorSelection).toHaveBeenCalledWith(
      codeMirrorState.editorView
    );
    await editableEditor.unmount();

    nativeActionMocks.cutCodeMirrorSelection.mockClear();
    const readOnlyEditor = await renderYamlEditor({ editable: false });
    surfaceCalls = shortcutMocks.useKeyboardSurface.mock.calls;
    surfaceConfig = surfaceCalls[surfaceCalls.length - 1]?.[0] as {
      onNativeAction: (event: { action: string }) => boolean;
    };

    expect(surfaceConfig.onNativeAction({ action: 'cut' })).toBe(false);
    expect(nativeActionMocks.cutCodeMirrorSelection).not.toHaveBeenCalled();
    await readOnlyEditor.unmount();
  });

  it('makes read-only editor content focusable for selection and clipboard shortcuts', async () => {
    const readOnlyEditor = await renderYamlEditor({ editable: false });

    expect(codeMirrorState.props.extensions).toContainEqual(
      expect.objectContaining({
        type: 'contentAttributes',
        attrs: expect.objectContaining({ tabindex: '0' }),
      })
    );
    await readOnlyEditor.unmount();

    const editableEditor = await renderYamlEditor({ editable: true });

    expect(codeMirrorState.props.extensions).not.toContainEqual(
      expect.objectContaining({ type: 'contentAttributes' })
    );
    await editableEditor.unmount();
  });

  it('suppresses paste when disabled', async () => {
    const { unmount } = await renderYamlEditor({ editable: true, disabled: true });
    const surfaceCalls = shortcutMocks.useKeyboardSurface.mock.calls;
    const surfaceConfig = surfaceCalls[surfaceCalls.length - 1]?.[0] as {
      onNativeAction: (event: { action: string; text?: string }) => boolean;
    };

    codeMirrorState.editorView.dispatch.mockClear();

    expect(surfaceConfig.onNativeAction({ action: 'paste', text: 'abc' })).toBe(false);
    expect(codeMirrorState.editorView.dispatch).not.toHaveBeenCalled();

    await unmount();
  });

  it('renders toolbar actions and focuses search with the current selection', async () => {
    const { container, unmount } = await renderYamlEditor({
      toolbarActions: <button type="button">Save</button>,
    });
    expect(container.textContent).toContain('Save');

    codeMirrorState.editorView.dispatch.mockClear();
    codeMirrorState.editorView.state.sliceDoc.mockReturnValue('kind');
    const searchCalls = shortcutMocks.useSearchShortcutTarget.mock.calls;
    const searchConfig = searchCalls[searchCalls.length - 1]?.[0] as { focus: () => boolean };

    await act(async () => {
      expect(searchConfig.focus()).toBe(true);
    });

    expect(codeMirrorState.editorView.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        effects: expect.objectContaining({ search: 'kind' }),
      })
    );
    await unmount();
  });

  it('limits context-menu mutation actions to editable mode', async () => {
    const viewOnly = await renderYamlEditor({ editable: false });

    await act(async () => {
      viewOnly.container
        .querySelector('[data-testid="code-mirror"]')
        ?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    });

    expect(document.body.textContent).toContain('Copy');
    expect(document.body.textContent).toContain('Select All');
    expect(document.body.textContent).not.toContain('Cut');
    expect(document.body.textContent).not.toContain('Paste');
    await viewOnly.unmount();

    const editable = await renderYamlEditor({ editable: true });

    await act(async () => {
      editable.container
        .querySelector('[data-testid="code-mirror"]')
        ?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    });

    expect(document.body.textContent).toContain('Cut');
    expect(document.body.textContent).toContain('Paste');
    await editable.unmount();
  });

  it('cuts through the shared CodeMirror helper from the context menu', async () => {
    const { container, unmount } = await renderYamlEditor({ editable: true });

    await act(async () => {
      container
        .querySelector('[data-testid="code-mirror"]')
        ?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    });

    const cutItem = Array.from(document.querySelectorAll('.context-menu-item')).find(
      (candidate) => candidate.querySelector('.context-menu-label')?.textContent === 'Cut'
    );
    expect(cutItem).toBeTruthy();

    await act(async () => {
      cutItem?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(nativeActionMocks.cutCodeMirrorSelection).toHaveBeenCalledWith(
      codeMirrorState.editorView
    );

    await unmount();
  });

  it('pastes from the Wails clipboard in the context menu', async () => {
    const { container, unmount } = await renderYamlEditor({ editable: true });

    await act(async () => {
      container
        .querySelector('[data-testid="code-mirror"]')
        ?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    });

    const pasteItem = Array.from(document.querySelectorAll('.context-menu-item')).find(
      (candidate) => candidate.querySelector('.context-menu-label')?.textContent === 'Paste'
    );
    expect(pasteItem).toBeTruthy();

    codeMirrorState.editorView.dispatch.mockClear();

    await act(async () => {
      pasteItem?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    // navigator.clipboard.readText is permission-gated inside the Wails
    // WebView; paste must read through the Go-side clipboard instead.
    expect(wailsRuntimeMocks.ClipboardGetText).toHaveBeenCalled();
    expect(navigator.clipboard.readText).not.toHaveBeenCalled();
    expect(codeMirrorState.editorView.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        changes: { from: 0, to: 0, insert: 'clipboard-text' },
      })
    );

    await unmount();
  });

  it('decorates protected ranges and rejects edits that touch them', async () => {
    const onProtectedEditBlocked = vi.fn();
    const { unmount } = await renderYamlEditor({
      value: 'kind: ConfigMap\nmetadata:\n',
      editable: true,
      protectedRanges: [{ from: 0, to: 4, blockedMessage: 'kind is read-only' }],
      onProtectedEditBlocked,
    });

    expect(codeMirrorState.decorationRanges).toEqual([
      expect.objectContaining({
        from: 0,
        to: 4,
        spec: expect.objectContaining({ class: 'cm-yaml-protected-range' }),
      }),
    ]);

    const transactionFilter =
      codeMirrorState.transactionFilters[codeMirrorState.transactionFilters.length - 1];
    const blocked = transactionFilter?.({
      docChanged: true,
      startState: { doc: { toString: () => 'kind: ConfigMap\nmetadata:\n' } },
      changes: { iterChanges: (callback: (from: number, to: number) => void) => callback(1, 2) },
    });

    expect(blocked).toEqual([]);
    expect(onProtectedEditBlocked).toHaveBeenCalledWith('kind is read-only');

    const wholeDocumentReplacement = transactionFilter?.({
      docChanged: true,
      startState: { doc: { toString: () => 'kind: ConfigMap\nmetadata:\n' } },
      changes: {
        iterChanges: (callback: (from: number, to: number) => void) => callback(0, 26),
      },
    });

    expect(wholeDocumentReplacement).toEqual([]);
    expect(onProtectedEditBlocked).toHaveBeenCalledTimes(2);

    const startBoundaryInsertion = transactionFilter?.({
      docChanged: true,
      startState: { doc: { toString: () => 'kind: ConfigMap\nmetadata:\n' } },
      changes: {
        iterChanges: (callback: (from: number, to: number) => void) => callback(0, 0),
      },
    });

    expect(startBoundaryInsertion).toEqual([]);
    expect(onProtectedEditBlocked).toHaveBeenCalledTimes(3);

    const endBoundaryInsertion = transactionFilter?.({
      docChanged: true,
      startState: { doc: { toString: () => 'kind: ConfigMap\nmetadata:\n' } },
      changes: {
        iterChanges: (callback: (from: number, to: number) => void) => callback(4, 4),
      },
    });

    expect(endBoundaryInsertion).toEqual([]);
    expect(onProtectedEditBlocked).toHaveBeenCalledTimes(4);

    const externalDocumentSync = {
      docChanged: true,
      annotation: () => true,
      startState: { doc: { toString: () => 'kind: ConfigMap\nmetadata:\n' } },
      changes: {
        iterChanges: (callback: (from: number, to: number) => void) => callback(0, 26),
      },
    };

    expect(transactionFilter?.(externalDocumentSync)).toBe(externalDocumentSync);
    expect(onProtectedEditBlocked).toHaveBeenCalledTimes(4);

    const allowedTransaction = {
      docChanged: true,
      annotation: () => false,
      startState: { doc: { toString: () => 'kind: ConfigMap\nmetadata:\n' } },
      changes: { iterChanges: (callback: (from: number, to: number) => void) => callback(12, 12) },
    };

    expect(transactionFilter?.(allowedTransaction)).toBe(allowedTransaction);
    await unmount();
  });

  it('sorts protected ranges before creating CodeMirror decorations', async () => {
    const { unmount } = await renderYamlEditor({
      value: 'kind: ConfigMap\nmetadata:\n  name: demo\n',
      editable: true,
      protectedRanges: [
        { from: 16, to: 25, blockedMessage: 'metadata is read-only' },
        { from: 0, to: 4, blockedMessage: 'kind is read-only' },
      ],
    });

    expect(codeMirrorState.decorationRanges.map((range) => range.from)).toEqual([0, 16]);

    const transactionFilter =
      codeMirrorState.transactionFilters[codeMirrorState.transactionFilters.length - 1];
    const blocked = transactionFilter?.({
      docChanged: true,
      startState: { doc: { toString: () => 'kind: ConfigMap\nmetadata:\n  name: demo\n' } },
      changes: { iterChanges: (callback: (from: number, to: number) => void) => callback(17, 18) },
    });

    expect(blocked).toEqual([]);
    await unmount();
  });

  it('trims protected decorations to visible line text without weakening edit blocking', async () => {
    const value = 'metadata:\n  generation: 5\n  labels:\n    app: demo\n';
    const onProtectedEditBlocked = vi.fn();
    const { unmount } = await renderYamlEditor({
      value,
      editable: true,
      protectedRanges: [
        {
          from: value.indexOf('  generation:'),
          to: value.indexOf('\n  labels:'),
          blockedMessage: 'generation is read-only',
        },
      ],
      onProtectedEditBlocked,
    });

    expect(codeMirrorState.decorationRanges).toEqual([
      expect.objectContaining({
        from: value.indexOf('generation:'),
        to: value.indexOf('\n  labels:'),
      }),
    ]);

    const transactionFilter =
      codeMirrorState.transactionFilters[codeMirrorState.transactionFilters.length - 1];
    const blockedIndentEdit = transactionFilter?.({
      docChanged: true,
      startState: { doc: { toString: () => value } },
      changes: {
        iterChanges: (callback: (from: number, to: number) => void) =>
          callback(value.indexOf('  generation:'), value.indexOf('  generation:') + 1),
      },
    });

    expect(blockedIndentEdit).toEqual([]);
    expect(onProtectedEditBlocked).toHaveBeenCalledWith('generation is read-only');

    await unmount();
  });

  it('computes protected decorations from the current editor document', async () => {
    const staleValue = [
      'metadata:',
      '  managedFields:',
      '    - manager: controller',
      '  uid: 696db572-efed-40ba-b6a2-3dff614374c0',
      '',
    ].join('\n');
    const currentDocument = ['metadata:', '  uid: 696db572-efed-40ba-b6a2-3dff614374c0', ''].join(
      '\n'
    );
    const managedFieldsStart = staleValue.indexOf('  managedFields:');
    const resolver = vi.fn((text: string) =>
      text.includes('managedFields')
        ? [
            {
              from: managedFieldsStart,
              to: staleValue.indexOf('\n  uid:'),
              tooltip: 'Kubernetes records field ownership in managedFields.',
            },
          ]
        : []
    );
    const { unmount } = await renderYamlEditor({
      value: staleValue,
      editable: true,
      protectedRangeResolver: resolver,
    });

    const computedDecorations = (
      codeMirrorState.props.extensions as Array<Record<string, unknown>>
    ).find((extension) => extension.type === 'computedDecorations') as
      | { compute: (state: { doc: { toString: () => string } }) => unknown }
      | undefined;
    expect(computedDecorations).toBeTruthy();

    codeMirrorState.decorationRanges = [];
    computedDecorations?.compute({ doc: { toString: () => currentDocument } });

    expect(resolver).toHaveBeenLastCalledWith(currentDocument);
    expect(codeMirrorState.decorationRanges).toEqual([]);

    await unmount();
  });
});
