/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Yaml/YamlTab.shortcuts.test.tsx
 *
 * The YAML tab's keyboard and Edit-menu behavior through the app's real
 * KeyboardProvider: `m` toggles managedFields only while reading, Cmd/Ctrl+S
 * saves and Escape cancels only while editing, the search shortcut takes the
 * editor's selection only while the tab is active, and Edit-menu Copy/Paste
 * reach the editor that holds focus. Runs in provider mode inside the real app
 * shell (see YamlTab.test.tsx for why); only the backend boundary is faked
 * (test-utils/appState). The CodeMirror editor is stubbed with a focusable
 * element and a view that applies the changes dispatched to it.
 */

import { Clipboard } from '@wailsio/runtime';
import React, { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  installAppStateHarness,
  type MountedApp,
  type TestCluster,
} from '@/test-utils/appState/harness';
import { requireValue } from '@/test-utils/requireValue';
import { isMacPlatform } from '@/utils/platform';
import YamlTab from './YamlTab';

interface CapturedCodeMirrorProps {
  value: string;
  onChange: (value: string) => void;
  onCreateEditor?: (view: unknown) => void;
  ref?: React.Ref<unknown>;
}

type Range = { from: number; to: number };

const editor = vi.hoisted(() => {
  const state = {
    props: { value: '', onChange: (_value: string) => undefined } as {
      value: string;
      onChange: (value: string) => void;
    },
    element: null as HTMLElement | null,
    selection: { from: 0, to: 0 } as { from: number; to: number },
  };
  // CodeMirror's view, as the editor helpers use it: its document and
  // selection, transactions that change the document, and focus.
  const view = {
    get state() {
      const doc = state.props.value;
      return {
        doc: { length: doc.length, toString: () => doc },
        selection: { main: state.selection, ranges: [state.selection] },
        sliceDoc: (from = 0, to = doc.length) => doc.slice(from, to),
      };
    },
    dispatch(transaction: { changes?: { from: number; to: number; insert: string } }) {
      const change = transaction.changes;
      if (change) {
        const doc = state.props.value;
        state.props.onChange(doc.slice(0, change.from) + change.insert + doc.slice(change.to));
      }
    },
    focus() {
      state.element?.focus();
    },
  };
  return { state, view };
});

vi.mock('@uiw/react-codemirror', () => {
  const CodeMirrorMock = ({ ref, ...props }: CapturedCodeMirrorProps) => {
    const { onCreateEditor } = props;
    editor.state.props = props;
    if (ref && typeof ref === 'object') {
      (ref as React.RefObject<unknown>).current = { view: editor.view };
    }
    React.useEffect(() => {
      onCreateEditor?.(editor.view);
    }, [onCreateEditor]);
    return (
      <div
        data-testid="code-mirror"
        ref={(element) => {
          // CodeMirror's content element; the editor makes it focusable
          // (contentAttributes tabindex) so it can take focus in read mode.
          element?.setAttribute('tabindex', '0');
          editor.state.element = element;
        }}
      >
        {props.value}
      </div>
    );
  };
  return { __esModule: true, default: CodeMirrorMock, ExternalChange: {} };
});

vi.mock('@codemirror/lang-yaml', () => ({ yaml: () => 'yaml-extension' }));

vi.mock('@codemirror/view', () => ({
  Decoration: { mark: () => ({ range: () => ({}) }), set: (ranges: unknown[]) => ranges },
  EditorView: Object.assign(class EditorViewMock {}, {
    decorations: { of: (value: unknown) => value, compute: () => ({}) },
    contentAttributes: { of: (attrs: unknown) => attrs },
    domEventHandlers: (handlers: unknown) => handlers,
    lineWrapping: 'lineWrapping',
  }),
  keymap: { of: (bindings: unknown) => bindings },
}));

vi.mock('@codemirror/state', () => ({
  EditorSelection: { cursor: (position: number) => ({ anchor: position }) },
  EditorState: { transactionFilter: { of: (filter: unknown) => filter } },
}));

vi.mock('@codemirror/search', () => ({
  SearchQuery: class SearchQuery {},
  findNext: () => true,
  findPrevious: () => true,
  getSearchQuery: () => ({ search: '', wholeWord: false, replace: '' }),
  setSearchQuery: { of: (query: unknown) => query },
}));

vi.mock('@/core/codemirror/theme', () => ({
  buildCodeTheme: () => ({ theme: 'dark', highlight: 'highlight-ext' }),
}));

vi.mock('@/core/codemirror/search', () => ({
  createSearchExtensions: () => [],
  closeSearchPanel: () => undefined,
}));

const YAML =
  'apiVersion: v1\nkind: Pod\nmetadata:\n  name: demo\n  namespace: default\n  resourceVersion: "123"\n  managedFields:\n    - manager: kubelet\nspec:\n  containers:\n    - name: demo\n      image: demo:v1\n';

const app = installAppStateHarness();
const pod = { group: '', version: 'v1', kind: 'Pod', namespace: 'default', name: 'demo' };

let dev: TestCluster;
let view: MountedApp;
let scope: string;

const tab = (isActive = true) => (
  <YamlTab scope={scope} isActive={isActive} canEdit clusterId={dev.clusterId} />
);

const renderYamlTab = async () => {
  view = await app.render(null);
  await view.show(tab());
  await nextFrame();
};

// The tab focuses its editor on the next animation frame.
const nextFrame = () =>
  act(async () => {
    await new Promise((resolve) => window.requestAnimationFrame(resolve));
  });

/**
 * Holds animation frames until `flush` runs them, as a busy render delays the
 * frame the tab focuses its editor on past the user's next input.
 */
const holdFrames = () => {
  const frames = new Map<number, FrameRequestCallback>();
  let nextId = 0;
  const request = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    nextId += 1;
    frames.set(nextId, callback);
    return nextId;
  });
  const cancel = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
    frames.delete(id);
  });
  return {
    flush: () =>
      act(async () => {
        request.mockRestore();
        cancel.mockRestore();
        const held = [...frames.values()];
        frames.clear();
        for (const callback of held) {
          callback(performance.now());
        }
      }),
  };
};

const press = async (key: string, modifiers: KeyboardEventInit = {}) => {
  const target = document.activeElement ?? document.body;
  await act(async () => {
    target.dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...modifiers })
    );
  });
  await app.settle();
};

const button = (label: string) =>
  view.container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);

const click = async (label: string) => {
  const target = requireValue(button(label), `expected the ${label} button`);
  await act(async () => target.click());
  await app.settle();
};

const isEditing = () => button('Save YAML') !== null;

const searchModifiers = (): KeyboardEventInit =>
  isMacPlatform() ? { metaKey: true } : { ctrlKey: true };

const menu = async (name: string, data?: unknown) => {
  await act(async () => {
    app.events.emit(name, data);
  });
  await app.settle();
};

beforeEach(() => {
  dev = app.cluster({ name: 'dev', context: 'alpha' });
  app.namespaces(dev, ['default']);
  scope = requireValue(app.object(dev, pod).scopes.detailScope, 'expected the pod scope');
  // backend/refresh/snapshot/object_content.go: the object's YAML snapshot.
  app.snapshots.serve('object-yaml', scope, {
    clusterId: dev.clusterId,
    clusterName: dev.clusterName,
    yaml: YAML,
  });
  editor.state.selection = { from: 0, to: 0 } satisfies Range;
  vi.mocked(Clipboard.SetText).mockClear();
});

describe('YamlTab shortcuts', () => {
  it('toggles managedFields with m while reading, but not while editing', async () => {
    await renderYamlTab();
    expect(editor.state.props.value).not.toContain('managedFields');

    await press('m');
    expect(editor.state.props.value).toContain('managedFields');
    await press('m');
    expect(editor.state.props.value).not.toContain('managedFields');

    await click('Edit YAML');
    await press('m');
    expect(editor.state.props.value).not.toContain('managedFields');
  });

  it('saves with Cmd+S or Ctrl+S only while editing', async () => {
    // backend/object_yaml_ownership.go and object_yaml_mutation.go: an
    // uncontested save; backend/object_yaml_by_gvk.go: the stored object.
    app.backend.answer('CheckObjectYamlOwnership', () => ({ conflicts: [] }));
    app.backend.answer('ApplyObjectYaml', () => ({ resourceVersion: '456' }));
    app.backend.answer('GetObjectYAMLByGVK', () => YAML.replace('demo:v1', 'demo:v2'));
    await renderYamlTab();

    await press('s', { metaKey: true });
    await press('s', { ctrlKey: true });
    expect(app.backend.calls('ApplyObjectYaml')).toEqual([]);

    await click('Edit YAML');
    await act(async () => editor.state.props.onChange(YAML.replace('demo:v1', 'demo:v2')));
    await press('s', { ctrlKey: true });

    expect(app.backend.calls('ApplyObjectYaml')).toHaveLength(1);
    expect(app.backend.calls('ApplyObjectYaml')[0]?.[1].yaml).toContain('image: demo:v2');
    expect(isEditing()).toBe(false);
  });

  it('cancels the edit with Escape in the editor', async () => {
    await renderYamlTab();
    await click('Edit YAML');
    await act(async () => editor.state.props.onChange(YAML.replace('demo:v1', 'demo:v2')));
    editor.state.element?.focus();

    await press('Escape');

    expect(isEditing()).toBe(false);
    expect(editor.state.props.value).toContain('image: demo:v1');
  });

  it('focuses the YAML search with the editor selection only while the tab is active', async () => {
    await renderYamlTab();
    editor.state.selection = { from: 0, to: 'apiVersion'.length };
    const search = requireValue(
      view.container.querySelector<HTMLInputElement>('.find-input'),
      'expected the find input'
    );
    // The user switches to another panel tab; the YAML tab stays mounted, inactive.
    await view.show(tab(false));

    await press('f', searchModifiers());
    expect(document.activeElement).not.toBe(search);
    expect(search.value).toBe('');

    await view.show(tab(true));
    await press('f', searchModifiers());

    expect(document.activeElement).toBe(search);
    expect(search.value).toBe('apiVersion');
  });

  it('keeps focus in the search when the tab’s editor focus lands after the shortcut', async () => {
    await renderYamlTab();
    const search = requireValue(
      view.container.querySelector<HTMLInputElement>('.find-input'),
      'expected the find input'
    );
    await view.show(tab(false));
    const frames = holdFrames();

    await view.show(tab(true));
    await press('f', searchModifiers());
    await frames.flush();

    expect(document.activeElement).toBe(search);
  });

  it('does not focus the editor of a tab the user left before its focus landed', async () => {
    await renderYamlTab();
    await view.show(tab(false));
    const elsewhere = document.body.appendChild(document.createElement('button'));
    elsewhere.focus();
    const frames = holdFrames();

    await view.show(tab(true));
    // The user moves on to another panel tab within the same frame.
    await view.show(tab(false));
    await frames.flush();

    expect(document.activeElement).toBe(elsewhere);
    elsewhere.remove();
  });

  it('copies the read-only editor selection from the Edit menu', async () => {
    await renderYamlTab();
    editor.state.selection = { from: 0, to: 'apiVersion'.length };

    await menu('menu:copy');

    expect(Clipboard.SetText).toHaveBeenCalledWith('apiVersion');
  });

  it('pastes from the Edit menu into the draft only while editing', async () => {
    await renderYamlTab();

    await menu('menu:paste', '# pasted\n');
    expect(editor.state.props.value).not.toContain('# pasted');

    await click('Edit YAML');
    await nextFrame();
    await menu('menu:paste', '# pasted\n');

    expect(isEditing()).toBe(true);
    expect(editor.state.props.value.startsWith('# pasted\n')).toBe(true);
  });
});
