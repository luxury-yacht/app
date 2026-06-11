import type { EditorView } from '@codemirror/view';

export function getCodeMirrorSelectedText(view: EditorView | null): string {
  if (!view) {
    return '';
  }

  const ranges = view.state.selection.ranges ?? [view.state.selection.main];
  return ranges
    .filter((range) => range.from !== range.to)
    .map((range) => view.state.sliceDoc(range.from, range.to))
    .join('\n');
}

export function selectCodeMirrorContent(view: EditorView | null): boolean {
  if (!view) {
    return false;
  }

  // Select through editor state, not a DOM range: CodeMirror virtualizes
  // long documents, so the DOM only contains the rendered viewport.
  view.dispatch({
    selection: { anchor: 0, head: view.state.doc.length },
    userEvent: 'select',
  });
  view.focus();
  return true;
}

export function cutCodeMirrorSelection(view: EditorView | null): boolean {
  if (!view || typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
    return false;
  }

  const text = getCodeMirrorSelectedText(view);
  if (!text) {
    return false;
  }

  void navigator.clipboard.writeText(text);
  view.dispatch({
    changes: view.state.selection.ranges
      .filter((range) => range.from !== range.to)
      .map((range) => ({ from: range.from, to: range.to, insert: '' })),
    userEvent: 'delete.cut',
  });
  view.focus();
  return true;
}

export function copyCodeMirrorSelection(view: EditorView | null): boolean {
  if (!view || typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
    return false;
  }

  const text = getCodeMirrorSelectedText(view);
  if (!text) {
    return false;
  }

  void navigator.clipboard.writeText(text);
  return true;
}
