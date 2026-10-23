/**
 * frontend/src/shared/components/yaml/YamlEditor.test.tsx
 *
 * The shared YAML editor with its real CodeMirror view: it reports edits only
 * while editable and enabled; a read-only editor can take focus so the Edit
 * menu reaches it; the Edit menu's copy, cut, select-all, and paste and the
 * editor's own context menu act on its selection through the Wails clipboard
 * (cut and paste only while editable); the search shortcut focuses its search
 * with the selected text only while the editor is active; and protected
 * ranges are marked on their visible text and refuse every edit that touches
 * them, while document syncs from the caller pass. Runs inside the production
 * shell (keyboard surfaces, Edit-menu routing, zoom) over a faked backend
 * (test-utils/appState); the clipboard is the Wails runtime's.
 */

import type { EditorView } from '@codemirror/view';
import { Clipboard } from '@wailsio/runtime';
import { act, type ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installAppStateHarness, type MountedApp } from '@/test-utils/appState/harness';
import { requireValue } from '@/test-utils/requireValue';
import { isMacPlatform } from '@/utils/platform';
import YamlEditor from './YamlEditor';

const app = installAppStateHarness();
const YAML = 'kind: ConfigMap\nmetadata:\n  name: demo\n';

let view: MountedApp;
let editor: EditorView | null = null;
let currentProps: Partial<ComponentProps<typeof YamlEditor>> = {};

const show = async (props: Partial<ComponentProps<typeof YamlEditor>> = {}) => {
  currentProps = props;
  await view.show(
    <YamlEditor
      value={YAML}
      ariaLabel="YAML editor"
      onCreateEditor={(created) => {
        editor = created;
      }}
      {...props}
    />
  );
};

const start = async (props: Partial<ComponentProps<typeof YamlEditor>> = {}) => {
  const dev = app.cluster({ name: 'dev', context: 'alpha' });
  app.namespaces(dev, ['default']);
  view = await app.render(null);
  await show(props);
};

const cm = () => requireValue(editor, 'expected the CodeMirror view');
const doc = () => cm().state.doc.toString();
const content = () =>
  requireValue(view.container.querySelector<HTMLElement>('.cm-content'), 'expected the editor');

/** Selects document text, as the user would by dragging over it. */
const select = async (from: number, to: number) => {
  await act(async () => {
    cm().dispatch({ selection: { anchor: from, head: to }, userEvent: 'select.pointer' });
  });
};

/** A change the user makes in the editor. */
const userEdit = async (from: number, to: number, insert: string) => {
  await act(async () => {
    cm().dispatch({ changes: { from, to, insert }, userEvent: 'input.type' });
  });
};

const focusEditor = async () => {
  await act(async () => content().focus());
};

/** An Edit-menu command, as the native menu sends it. */
const menu = async (name: string, data?: unknown) => {
  await act(async () => {
    app.events.emit(name, data);
  });
  await app.settle();
};

const openContextMenu = async () => {
  await act(async () => {
    content().dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 5, clientY: 5 })
    );
  });
  return Array.from(
    document.querySelectorAll<HTMLElement>('[role="menu"] .context-menu-item .context-menu-label')
  ).map((label) => label.textContent?.trim());
};

const clickContextItem = async (label: string) => {
  const item = requireValue(
    Array.from(document.querySelectorAll<HTMLElement>('[role="menu"] .context-menu-item')).find(
      (candidate) => candidate.querySelector('.context-menu-label')?.textContent === label
    ),
    `expected the ${label} item`
  );
  await act(async () => item.click());
  await app.settle();
};

const protectedText = () =>
  Array.from(view.container.querySelectorAll('.cm-yaml-protected-range')).map(
    (mark) => mark.textContent
  );

beforeEach(() => {
  editor = null;
  vi.mocked(Clipboard.SetText).mockReset().mockResolvedValue(undefined);
  vi.mocked(Clipboard.Text).mockReset().mockResolvedValue('');
});

describe('editing', () => {
  it.each([
    ['editable', { editable: true }, true],
    ['read-only', { editable: false }, false],
    ['editable but disabled', { editable: true, disabled: true }, false],
  ] as const)('reports a change only when %s', async (_case, props, reports) => {
    const onChange = vi.fn();
    await start({ ...props, onChange });

    await userEdit(0, 0, '# note\n');

    expect(content().getAttribute('contenteditable')).toBe(String(reports));
    expect(onChange).toHaveBeenCalledTimes(reports ? 1 : 0);
    if (reports) {
      expect(onChange).toHaveBeenCalledWith(`# note\n${YAML}`);
    }
  });
});

describe('the Edit menu', () => {
  it('copies the selection of a read-only editor, which can take focus', async () => {
    await start({ editable: false });
    await focusEditor();
    expect(document.activeElement).toBe(content());
    await select(0, 'kind'.length);

    await menu('menu:copy');

    expect(Clipboard.SetText).toHaveBeenCalledWith('kind');
  });

  it('selects the whole document', async () => {
    await start({ editable: false });
    await focusEditor();

    await menu('menu:selectAll');

    expect(cm().state.selection.main).toMatchObject({ from: 0, to: YAML.length });
  });

  it.each([
    ['editable', { editable: true }, true],
    ['read-only', { editable: false }, false],
    ['editable but disabled', { editable: true, disabled: true }, false],
  ] as const)('cuts and pastes only when %s', async (_case, props, changes) => {
    await start(props);
    await focusEditor();
    await select(0, 'kind'.length);

    await menu('menu:cut');
    await menu('menu:paste', 'type');

    expect(doc()).toBe(changes ? YAML.replace('kind', 'type') : YAML);
    expect(vi.mocked(Clipboard.SetText).mock.calls).toEqual(changes ? [['kind']] : []);
  });
});

describe('its context menu', () => {
  it('offers Cut and Paste only while editable', async () => {
    await start({ editable: false });
    expect(await openContextMenu()).toEqual(['Copy', 'Select All']);

    await show({ editable: true });

    expect(await openContextMenu()).toEqual(['Cut', 'Copy', 'Paste', 'Select All']);
  });

  it('copies the selection of a read-only editor to the Wails clipboard', async () => {
    await start({ editable: false });
    await select(0, 'kind'.length);
    await openContextMenu();

    // The WebView refuses browser clipboard writes that a click starts.
    await clickContextItem('Copy');

    expect(Clipboard.SetText).toHaveBeenCalledWith('kind');
  });

  it('cuts to and pastes from the Wails clipboard while editable', async () => {
    // The browser clipboard read is permission-gated inside the Wails WebView.
    vi.mocked(Clipboard.Text).mockResolvedValue('type');
    await start({ editable: true });
    await select(0, 'kind'.length);
    await openContextMenu();

    await clickContextItem('Cut');
    expect(Clipboard.SetText).toHaveBeenCalledWith('kind');
    expect(doc()).toBe(YAML.replace('kind', ''));

    await openContextMenu();
    await clickContextItem('Paste');
    expect(doc()).toBe(YAML.replace('kind', 'type'));
  });
});

describe('the search shortcut', () => {
  const press = async () => {
    const modifiers = isMacPlatform() ? { metaKey: true } : { ctrlKey: true };
    await act(async () => {
      (document.activeElement ?? document.body).dispatchEvent(
        new KeyboardEvent('keydown', { key: 'f', bubbles: true, cancelable: true, ...modifiers })
      );
    });
    await app.settle();
  };

  it('focuses its search with the selected text only while the editor is active', async () => {
    await start({ active: false });
    const search = requireValue(
      view.container.querySelector<HTMLInputElement>('.find-input'),
      'expected the find input'
    );
    await select(0, 'kind'.length);

    await press();
    expect(document.activeElement).not.toBe(search);
    expect(search.value).toBe('');

    await show({ active: true });
    await select(0, 'kind'.length);
    await press();

    expect(document.activeElement).toBe(search);
    expect(search.value).toBe('kind');
  });
});

describe('protected ranges', () => {
  it('marks the protected text and refuses every edit that touches it', async () => {
    const onProtectedEditBlocked = vi.fn();
    await start({
      editable: true,
      protectedRanges: [{ from: 0, to: 4, blockedMessage: 'kind is read-only' }],
      onProtectedEditBlocked,
    });
    expect(protectedText()).toEqual(['kind']);

    await userEdit(1, 2, 'X');
    await userEdit(0, YAML.length, 'replaced: true\n');
    await userEdit(0, 0, 'X');
    await userEdit(4, 4, 'X');

    expect(doc()).toBe(YAML);
    expect(onProtectedEditBlocked.mock.calls).toEqual(Array(4).fill(['kind is read-only']));

    await userEdit(12, 12, 'X');
    expect(doc()).toBe(`${YAML.slice(0, 12)}X${YAML.slice(12)}`);
  });

  it('takes a new document from the caller even where it changes protected text', async () => {
    const onProtectedEditBlocked = vi.fn();
    await start({
      editable: true,
      protectedRanges: [{ from: 0, to: 4 }],
      onProtectedEditBlocked,
    });

    await show({ ...currentProps, value: YAML.replace('kind', 'type') });

    expect(doc()).toBe(YAML.replace('kind', 'type'));
    expect(onProtectedEditBlocked).not.toHaveBeenCalled();
  });

  it('marks and protects ranges given out of document order', async () => {
    const onProtectedEditBlocked = vi.fn();
    await start({
      editable: true,
      protectedRanges: [
        { from: 16, to: 25, blockedMessage: 'metadata is read-only' },
        { from: 0, to: 4, blockedMessage: 'kind is read-only' },
      ],
      onProtectedEditBlocked,
    });

    expect(protectedText()).toEqual(['kind', 'metadata:']);
    await userEdit(17, 18, 'X');
    expect(doc()).toBe(YAML);
    expect(onProtectedEditBlocked).toHaveBeenCalledWith('metadata is read-only');
  });

  it('marks only a protected line’s visible text, yet refuses edits to its indentation', async () => {
    const value = 'metadata:\n  generation: 5\n  labels:\n    app: demo\n';
    const onProtectedEditBlocked = vi.fn();
    const from = value.indexOf('  generation:');
    await start({
      value,
      editable: true,
      protectedRanges: [
        { from, to: value.indexOf('\n  labels:'), blockedMessage: 'generation is read-only' },
      ],
      onProtectedEditBlocked,
    });

    expect(protectedText()).toEqual(['generation: 5']);
    await userEdit(from, from + 1, '');
    expect(doc()).toBe(value);
    expect(onProtectedEditBlocked).toHaveBeenCalledWith('generation is read-only');
  });

  it('marks the ranges its resolver finds in the current document', async () => {
    const managed = 'metadata:\n  managedFields:\n    - manager: controller\n  uid: abc\n';
    const current = 'metadata:\n  uid: abc\n';
    const resolver = vi.fn((text: string) =>
      text.includes('managedFields')
        ? [{ from: text.indexOf('  managedFields:'), to: text.indexOf('\n  uid:') }]
        : []
    );
    await start({ value: managed, editable: true, protectedRangeResolver: resolver });
    expect(protectedText()).toEqual(['managedFields:', '- manager: controller']);

    await show({ ...currentProps, value: current });

    expect(resolver).toHaveBeenLastCalledWith(current);
    expect(protectedText()).toEqual([]);
  });
});
