/**
 * frontend/src/ui/shortcuts/components/TextContextMenu.test.tsx
 *
 * Test suite for TextContextMenu.
 * Verifies that the global text context menu appears only on text-relevant
 * elements and provides the correct items based on editability.
 */

import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TextContextMenu from './TextContextMenu';

// --- Mocks ---

let capturedMenuProps: {
  items: Array<{ label?: string; onClick?: () => void; disabled?: boolean; divider?: boolean }>;
  position: { x: number; y: number };
  onClose: () => void;
} | null = null;

vi.mock('@shared/components/ContextMenu', () => ({
  default: (props: any) => {
    capturedMenuProps = props;
    return null;
  },
}));

vi.mock('@wailsjs/runtime/runtime', () => ({
  EventsOn: vi.fn(),
  EventsOff: vi.fn(),
}));

vi.mock('../context', async () => {
  const actual = await vi.importActual<typeof import('../context')>('../context');
  return {
    ...actual,
    useKeyboardContext: () => ({
      pushContext: vi.fn(),
      popContext: vi.fn(),
      setContext: vi.fn(),
      registerShortcut: vi.fn(() => 'id'),
      unregisterShortcut: vi.fn(),
      getAvailableShortcuts: vi.fn(() => []),
      isShortcutAvailable: vi.fn(() => false),
      setEnabled: vi.fn(),
      isEnabled: true,
      currentContext: { view: 'global', priority: 0 },
      registerSurface: vi.fn(),
      unregisterSurface: vi.fn(),
      updateSurface: vi.fn(),
      dispatchNativeAction: vi.fn(() => false),
    }),
  };
});

vi.mock('@core/contexts/ZoomContext', () => ({
  useZoom: () => ({ zoomLevel: 100 }),
}));

// --- Helpers ---

function fireContextMenu(target: Element, x = 100, y = 200): void {
  const event = new MouseEvent('contextmenu', {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
  });
  target.dispatchEvent(event);
}

function stubSelection(text: string): void {
  vi.spyOn(window, 'getSelection').mockReturnValue({
    toString: () => text,
    isCollapsed: text.length === 0,
    anchorNode: document.body,
    focusNode: document.body,
    anchorOffset: 0,
    focusOffset: 0,
    rangeCount: text ? 1 : 0,
    removeAllRanges: vi.fn(),
    addRange: vi.fn(),
  } as unknown as Selection);
}

function clearSelection(): void {
  vi.spyOn(window, 'getSelection').mockReturnValue({
    toString: () => '',
    isCollapsed: true,
    anchorNode: null,
    focusNode: null,
    anchorOffset: 0,
    focusOffset: 0,
    rangeCount: 0,
    removeAllRanges: vi.fn(),
    addRange: vi.fn(),
  } as unknown as Selection);
}

function itemLabels(): string[] {
  return capturedMenuProps!.items.filter((i) => !i.divider).map((i) => i.label!);
}

// --- Tests ---

describe('TextContextMenu', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    capturedMenuProps = null;

    root = ReactDOM.createRoot(container);
    act(() => {
      root.render(<TextContextMenu />);
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.restoreAllMocks();
  });

  it('does not render when nothing is right-clicked', () => {
    expect(capturedMenuProps).toBeNull();
  });

  it('does not show on a plain div with no selection', () => {
    clearSelection();
    const div = document.createElement('div');
    document.body.appendChild(div);
    act(() => fireContextMenu(div));
    expect(capturedMenuProps).toBeNull();
    div.remove();
  });

  it('shows Copy and Select All when text is selected on a plain element', () => {
    const span = document.createElement('span');
    span.textContent = 'hello';
    document.body.appendChild(span);

    stubSelection('hello');
    act(() => fireContextMenu(span));
    expect(itemLabels()).toEqual(['Copy', 'Select All']);
    span.remove();
  });

  it('shows Cut, Copy, Paste, Select All on editable textarea', () => {
    const ta = document.createElement('textarea');
    ta.value = 'editable';
    document.body.appendChild(ta);

    stubSelection('editable');
    act(() => fireContextMenu(ta));
    expect(itemLabels()).toEqual(['Cut', 'Copy', 'Paste', 'Select All']);
    ta.remove();
  });

  it('shows Cut, Copy, Paste, Select All on editable text input', () => {
    const input = document.createElement('input');
    input.type = 'text';
    input.value = 'test';
    document.body.appendChild(input);

    stubSelection('test');
    act(() => fireContextMenu(input));
    expect(itemLabels()).toEqual(['Cut', 'Copy', 'Paste', 'Select All']);
    input.remove();
  });

  it('treats read-only textarea as non-editable', () => {
    const ta = document.createElement('textarea');
    ta.readOnly = true;
    ta.value = 'locked';
    document.body.appendChild(ta);

    stubSelection('locked');
    act(() => fireContextMenu(ta));
    expect(itemLabels()).toEqual(['Copy', 'Select All']);
    ta.remove();
  });

  it('does not show on checkbox inputs', () => {
    clearSelection();
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    document.body.appendChild(cb);

    act(() => fireContextMenu(cb));
    expect(capturedMenuProps).toBeNull();
    cb.remove();
  });

  it('skips elements inside .cm-editor', () => {
    const cmEditor = document.createElement('div');
    cmEditor.className = 'cm-editor';
    const cmContent = document.createElement('div');
    cmContent.className = 'cm-content';
    cmEditor.appendChild(cmContent);
    document.body.appendChild(cmEditor);

    stubSelection('yaml content');
    act(() => fireContextMenu(cmContent));
    expect(capturedMenuProps).toBeNull();
    cmEditor.remove();
  });

  it('skips events already handled by another context menu', () => {
    const div = document.createElement('div');
    document.body.appendChild(div);
    div.addEventListener('contextmenu', (e) => e.preventDefault());

    stubSelection('text');
    act(() => fireContextMenu(div));
    expect(capturedMenuProps).toBeNull();
    div.remove();
  });

  it('Copy writes selected text to clipboard', () => {
    const writeTextSpy = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText: writeTextSpy, readText: vi.fn() },
    });

    const span = document.createElement('span');
    document.body.appendChild(span);

    stubSelection('copied');
    act(() => fireContextMenu(span));

    const copyItem = capturedMenuProps!.items.find((i) => i.label === 'Copy');
    act(() => copyItem!.onClick!());
    expect(writeTextSpy).toHaveBeenCalledWith('copied');
    span.remove();
  });

  it('Select All calls input.select() for input elements', () => {
    const input = document.createElement('input');
    input.type = 'text';
    input.value = 'hello world';
    document.body.appendChild(input);
    const selectSpy = vi.spyOn(input, 'select');

    stubSelection('hello');
    act(() => fireContextMenu(input));

    const selectAllItem = capturedMenuProps!.items.find((i) => i.label === 'Select All');
    act(() => selectAllItem!.onClick!());
    expect(selectSpy).toHaveBeenCalled();
    input.remove();
  });

  it('shows editable items for contenteditable elements', () => {
    const div = document.createElement('div');
    div.setAttribute('contenteditable', 'true');
    div.textContent = 'editable div';
    document.body.appendChild(div);

    stubSelection('editable div');
    act(() => fireContextMenu(div));
    expect(itemLabels()).toEqual(['Cut', 'Copy', 'Paste', 'Select All']);
    div.remove();
  });
});
