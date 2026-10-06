/**
 * frontend/src/ui/shortcuts/components/TextContextMenu.test.tsx
 *
 * Test suite for TextContextMenu.
 * Verifies that the global text context menu appears only on text-relevant
 * elements and provides the correct items based on editability.
 */

import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { requireValue } from '@/test-utils/requireValue';
import TextContextMenu from './TextContextMenu';

// --- Mocks ---

let capturedMenuProps: {
  items: Array<{ label?: string; onClick?: () => void; disabled?: boolean; divider?: boolean }>;
  position: { x: number; y: number };
  onClose: () => void;
} | null = null;

vi.mock('@shared/components/ContextMenu', () => ({
  default: (props: NonNullable<typeof capturedMenuProps>) => {
    capturedMenuProps = props;
    return null;
  },
}));

const clipboardMocks = vi.hoisted(() => ({
  readClipboardText: vi.fn<() => Promise<string>>(() => Promise.resolve('')),
  writeClipboardText: vi.fn<(text: string) => Promise<void>>(() => Promise.resolve()),
}));

vi.mock('@core/desktop-runtime', () => ({
  desktopRuntimeAvailable: () => false,
  onEvent: vi.fn(() => () => undefined),
  readClipboardText: clipboardMocks.readClipboardText,
  writeClipboardText: clipboardMocks.writeClipboardText,
}));

vi.mock('../context', async () => {
  const actual = await vi.importActual<typeof import('../context')>('../context');
  return {
    ...actual,
    useKeyboardContext: () => ({
      registerShortcut: vi.fn(() => 'id'),
      unregisterShortcut: vi.fn(),
      getAvailableShortcuts: vi.fn(() => []),
      isShortcutAvailable: vi.fn(() => false),
      setEnabled: vi.fn(),
      isEnabled: true,
      registerSurface: vi.fn(),
      unregisterSurface: vi.fn(),
      dispatchNativeAction: vi.fn(() => false),
      hasActiveBlockingSurface: vi.fn(() => false),
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

function stubSelection(text: string, anchorNode: Node | null = document.body): void {
  vi.spyOn(window, 'getSelection').mockReturnValue({
    toString: () => text,
    isCollapsed: text.length === 0,
    anchorNode,
    focusNode: anchorNode,
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
  return requireValue(capturedMenuProps, 'expected test value in TextContextMenu.test.tsx')
    .items.filter((i) => !i.divider)
    .map((i) => requireValue(i.label, 'expected test value in TextContextMenu.test.tsx'));
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

    stubSelection('hello', span);
    act(() => fireContextMenu(span));
    expect(itemLabels()).toEqual(['Copy', 'Select All']);
    span.remove();
  });

  it('shows Copy and Select All for selected log text', () => {
    const logs = document.createElement('div');
    logs.className = 'logs-viewer-content';
    logs.tabIndex = -1;
    const line = document.createElement('div');
    line.className = 'log-viewer-line';
    line.textContent = 'selected log text';
    logs.appendChild(line);
    document.body.appendChild(logs);

    stubSelection('selected log text', line);
    act(() => fireContextMenu(line));
    expect(itemLabels()).toEqual(['Copy', 'Select All']);
    logs.remove();
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
    const writeTextSpy = clipboardMocks.writeClipboardText;
    writeTextSpy.mockClear();

    const span = document.createElement('span');
    document.body.appendChild(span);

    stubSelection('copied');
    act(() => fireContextMenu(span));

    const copyItem = requireValue(
      capturedMenuProps,
      'expected test value in TextContextMenu.test.tsx'
    ).items.find((i) => i.label === 'Copy');
    act(() =>
      requireValue(
        requireValue(copyItem, 'expected test value in TextContextMenu.test.tsx').onClick,
        'expected test value in TextContextMenu.test.tsx'
      )()
    );
    expect(writeTextSpy).toHaveBeenCalledWith('copied');
    span.remove();
  });

  it('Paste inserts native clipboard text into the editable target', async () => {
    clipboardMocks.readClipboardText.mockResolvedValueOnce('pasted');
    const browserReadText = vi.fn(() => Promise.resolve('browser'));
    const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { readText: browserReadText },
    });
    // jsdom has no editing commands; record what the menu asks the editor to insert.
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand });
    onTestFinished(() => {
      Reflect.deleteProperty(document, 'execCommand');
      if (originalClipboard) {
        Object.defineProperty(navigator, 'clipboard', originalClipboard);
      } else {
        Reflect.deleteProperty(navigator, 'clipboard');
      }
    });

    const input = document.createElement('input');
    input.type = 'text';
    document.body.appendChild(input);

    clearSelection();
    act(() => fireContextMenu(input));

    const pasteItem = requireValue(
      capturedMenuProps,
      'expected test value in TextContextMenu.test.tsx'
    ).items.find((i) => i.label === 'Paste');
    await act(async () => {
      requireValue(
        requireValue(pasteItem, 'expected test value in TextContextMenu.test.tsx').onClick,
        'expected test value in TextContextMenu.test.tsx'
      )();
      await Promise.resolve();
    });

    // The WebView gates navigator.clipboard.readText behind a "Paste" callout the
    // user must click; menu paste must read through the native clipboard.
    expect(browserReadText).not.toHaveBeenCalled();
    expect(execCommand).toHaveBeenCalledWith('insertText', false, 'pasted');
    expect(document.activeElement).toBe(input);
    input.remove();
  });

  it('Select All calls input.select() for input elements', () => {
    const input = document.createElement('input');
    input.type = 'text';
    input.value = 'hello world';
    document.body.appendChild(input);
    const selectSpy = vi.spyOn(input, 'select');

    stubSelection('hello');
    act(() => fireContextMenu(input));

    const selectAllItem = requireValue(
      capturedMenuProps,
      'expected test value in TextContextMenu.test.tsx'
    ).items.find((i) => i.label === 'Select All');
    act(() =>
      requireValue(
        requireValue(selectAllItem, 'expected test value in TextContextMenu.test.tsx').onClick,
        'expected test value in TextContextMenu.test.tsx'
      )()
    );
    expect(selectSpy).toHaveBeenCalled();
    input.remove();
  });

  it('Select All scopes to the log viewer when right-clicking selected log text', () => {
    const logs = document.createElement('div');
    logs.className = 'logs-viewer-content';
    logs.tabIndex = -1;
    const line = document.createElement('div');
    line.className = 'log-viewer-line';
    line.textContent = 'selected log text';
    logs.appendChild(line);
    document.body.appendChild(logs);

    const focusSpy = vi.spyOn(logs, 'focus');
    const removeAllRanges = vi.fn();
    const addRange = vi.fn();
    vi.spyOn(window, 'getSelection').mockReturnValue({
      toString: () => 'selected log text',
      isCollapsed: false,
      anchorNode: line,
      focusNode: line,
      anchorOffset: 0,
      focusOffset: 0,
      rangeCount: 1,
      removeAllRanges,
      addRange,
    } as unknown as Selection);

    act(() => fireContextMenu(line));

    const selectAllItem = requireValue(
      capturedMenuProps,
      'expected test value in TextContextMenu.test.tsx'
    ).items.find((item) => item.label === 'Select All');
    act(() =>
      requireValue(
        requireValue(selectAllItem, 'expected test value in TextContextMenu.test.tsx').onClick,
        'expected test value in TextContextMenu.test.tsx'
      )()
    );

    expect(focusSpy).toHaveBeenCalled();
    expect(removeAllRanges).toHaveBeenCalled();
    expect(addRange).toHaveBeenCalledTimes(1);
    logs.remove();
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
