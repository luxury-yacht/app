import { applySelectAll, deriveCopyText } from '@ui/shortcuts/context';

const nodeWithinRoot = (node: Node | null, root: HTMLElement): boolean => {
  if (!node) {
    return false;
  }
  if (node instanceof Element) {
    return root.contains(node);
  }
  return node.parentElement ? root.contains(node.parentElement) : false;
};

const selectionBelongsToRoot = (selection: Selection | null, root: HTMLElement | null): boolean => {
  if (!selection || selection.isCollapsed || !root) {
    return false;
  }

  if (selection.rangeCount > 0) {
    const ancestor = selection.getRangeAt(0).commonAncestorContainer;
    if (!nodeWithinRoot(ancestor, root)) {
      return false;
    }
  }

  return nodeWithinRoot(selection.anchorNode, root) || nodeWithinRoot(selection.focusNode, root);
};

export const getSelectedTextWithinRoot = (
  selection: Selection | null,
  root: HTMLElement | null
): string | null => {
  if (!selectionBelongsToRoot(selection, root)) {
    return null;
  }

  return deriveCopyText(selection);
};

export const selectAllTextWithinRoot = (selection: Selection | null, root: HTMLElement | null) => {
  if (!selection || !root) {
    return false;
  }

  applySelectAll(selection, root);
  return true;
};
