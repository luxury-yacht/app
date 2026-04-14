import type { EditorView } from '@codemirror/view';

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
