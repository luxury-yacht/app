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

  const selection = window.getSelection();
  const content = view.contentDOM;

  if (!selection || !content) {
    return false;
  }

  selection.removeAllRanges();
  const range = document.createRange();
  range.selectNodeContents(content);
  selection.addRange(range);
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
