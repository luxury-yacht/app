import type { types } from '@core/backend-api/models';
import {
  getClusterTabOrder,
  getNextClusterTabSelectionAfterClose,
} from '@core/persistence/clusterTabOrder';

const hasWindowsDrivePrefix = (value: string): boolean => {
  if (!value || value.length < 2) {
    return false;
  }
  const first = value[0];
  const isAlpha = (first >= 'a' && first <= 'z') || (first >= 'A' && first <= 'Z');
  if (!isAlpha || value[1] !== ':') {
    return false;
  }
  if (value.length === 2) {
    return true;
  }
  return value[2] !== ':';
};

const splitSelectionComponents = (selection: string): { path: string; context: string } => {
  const trimmed = selection.trim();
  if (!trimmed) {
    return { path: '', context: '' };
  }
  const startIndex = hasWindowsDrivePrefix(trimmed) ? 2 : 0;
  const delimiterIndex = trimmed.indexOf(':', startIndex);
  if (delimiterIndex === -1) {
    return { path: trimmed, context: '' };
  }
  return {
    path: trimmed.slice(0, delimiterIndex),
    context: trimmed.slice(delimiterIndex + 1),
  };
};

export const resolveClusterMeta = (selection: string, configs: types.KubeconfigInfo[]) => {
  const trimmed = selection.trim();
  if (!trimmed) {
    return { id: '', name: '' };
  }

  const { path, context } = splitSelectionComponents(trimmed);

  const match = configs.find((config) => config.path === path && config.context === context);
  if (match) {
    return { id: `${match.name}:${match.context}`, name: match.context };
  }

  const pathParts = path.split(/[/\\]/);
  const filename = pathParts[pathParts.length - 1] ?? '';
  if (!filename && !context) {
    return { id: '', name: '' };
  }
  if (!context) {
    return { id: filename, name: '' };
  }
  if (!filename) {
    return { id: context, name: context };
  }
  return { id: `${filename}:${context}`, name: context };
};

// Selection identity includes the full path and context; equal context names
// from different kubeconfig files remain separate selections.
export const normalizeSelections = (selections: string[]): string[] => {
  const trimmed = selections.map((selection) => selection.trim()).filter(Boolean);
  return [...new Set(trimmed)];
};

export const selectedClusterIdsFor = (
  selections: string[],
  configs: types.KubeconfigInfo[]
): string[] => {
  const ids = selections.map((selection) => resolveClusterMeta(selection, configs).id);
  return [...new Set(ids.filter(Boolean))];
};

export function retainedActiveSelection(selections: string[], current: string): string {
  return selections.includes(current) ? current : selections[0] || '';
}

const resolveActiveAfterClose = (
  previousSelections: string[],
  previousActive: string,
  normalizedSelections: string[]
): string => {
  const removedSelections = previousSelections.filter(
    (selection) => !normalizedSelections.includes(selection)
  );
  if (removedSelections.length !== 1) {
    return normalizedSelections[0] || '';
  }
  const nextAfterClose = getNextClusterTabSelectionAfterClose(
    previousSelections,
    removedSelections[0],
    previousActive,
    getClusterTabOrder()
  );
  return nextAfterClose && normalizedSelections.includes(nextAfterClose)
    ? nextAfterClose
    : normalizedSelections[0] || '';
};

export const resolveNextActiveSelection = (
  previousSelections: string[],
  previousActive: string,
  normalizedSelections: string[],
  activeSelection?: string
): string => {
  if (activeSelection !== undefined) {
    return normalizedSelections.includes(activeSelection) ? activeSelection : '';
  }
  const addedSelections = normalizedSelections.filter(
    (selection) => !previousSelections.includes(selection)
  );
  if (addedSelections.length > 0) {
    return addedSelections[addedSelections.length - 1];
  }
  if (previousActive && !normalizedSelections.includes(previousActive)) {
    return resolveActiveAfterClose(previousSelections, previousActive, normalizedSelections);
  }
  return previousActive && normalizedSelections.includes(previousActive)
    ? previousActive
    : normalizedSelections[0] || '';
};

export interface SelectionTransitionPlan {
  normalizedSelections: string[];
  nextActive: string;
  nextClusterId: string;
  shouldEmitChanging: boolean;
  shouldEmitChanged: boolean;
  shouldEmitSelectionChanged: boolean;
}

const selectionsAreEqual = (left: string[], right: string[]): boolean =>
  left.length === right.length && left.every((selection, index) => selection === right[index]);

export const buildSelectionTransitionPlan = (
  previousSelections: string[],
  previousActive: string,
  normalizedSelections: string[],
  activeSelection: string | undefined,
  configs: types.KubeconfigInfo[]
): SelectionTransitionPlan => {
  const nextActive = resolveNextActiveSelection(
    previousSelections,
    previousActive,
    normalizedSelections,
    activeSelection
  );
  const wasEmpty = previousSelections.length === 0;
  const willBeEmpty = normalizedSelections.length === 0;
  const selectionChanged = !selectionsAreEqual(previousSelections, normalizedSelections);
  return {
    normalizedSelections,
    nextActive,
    nextClusterId: resolveClusterMeta(nextActive, configs).id,
    shouldEmitChanging: selectionChanged && willBeEmpty,
    shouldEmitChanged: !willBeEmpty && wasEmpty,
    shouldEmitSelectionChanged: selectionChanged && !willBeEmpty,
  };
};
