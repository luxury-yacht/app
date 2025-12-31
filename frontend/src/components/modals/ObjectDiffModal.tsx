/**
 * frontend/src/components/modals/ObjectDiffModal.tsx
 *
 * UI component for ObjectDiffModal.
 * Provides a global, side-by-side YAML diff viewer for Kubernetes objects.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import './modals.css';
import './ObjectDiffModal.css';
import Dropdown from '@shared/components/dropdowns/Dropdown/Dropdown';
import type { DropdownOption } from '@shared/components/dropdowns/Dropdown/types';
import { useShortcut, useKeyboardContext } from '@ui/shortcuts';
import { KeyboardContextPriority, KeyboardScopePriority } from '@ui/shortcuts/priorities';
import { useModalFocusTrap } from './useModalFocusTrap';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import { buildClusterScope } from '@core/refresh/clusterScope';
import { refreshOrchestrator, useRefreshScopedDomain } from '@core/refresh';
import type { CatalogItem, CatalogSnapshotPayload } from '@core/refresh/types';
import {
  computeLineDiff,
  type DiffLine,
  type DiffResult,
  type DiffLineType,
} from '@modules/object-panel/components/ObjectPanel/Yaml/yamlDiff';
import {
  buildIgnoredMetadataLineSet,
  maskMutedMetadataLines,
  sanitizeYamlForDiff,
} from './objectDiffUtils';
import {
  CLUSTER_SCOPE,
  INACTIVE_SCOPE,
} from '@modules/object-panel/components/ObjectPanel/constants';
import { getDisplayKind } from '@/utils/kindAliasMap';
import { formatAge, formatFullDate } from '@/utils/ageFormatter';
import { useShortNames } from '@/hooks/useShortNames';

interface ObjectDiffModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface MatchRequest {
  namespace: string;
  kind: string;
  name: string;
}

const CATALOG_QUERY_LIMIT = 200;
const CLUSTER_SCOPE_LABEL = 'cluster-scoped';
const NAMESPACE_SEPARATOR_VALUE = '__namespace-separator__';

const buildCatalogScope = (params: { limit: number; namespace?: string; kind?: string }) => {
  const query = new URLSearchParams();
  query.set('limit', String(params.limit));

  const namespace = params.namespace?.trim();
  if (namespace) {
    query.append('namespace', namespace);
  }

  const kind = params.kind?.trim();
  if (kind) {
    query.append('kind', kind);
  }
  return query.toString();
};

const buildCatalogDiffScope = (params: {
  clusterId: string;
  namespace?: string;
  kind?: string;
}): string | null => {
  const trimmedCluster = params.clusterId.trim();
  if (!trimmedCluster) {
    return null;
  }

  const namespaceFilter =
    params.namespace?.trim() === CLUSTER_SCOPE ? 'cluster' : params.namespace?.trim();
  const query = buildCatalogScope({
    limit: CATALOG_QUERY_LIMIT,
    namespace: namespaceFilter,
    kind: params.kind,
  });
  return buildClusterScope(trimmedCluster, query);
};

const buildNamespaceLabel = (namespace?: string) => {
  const trimmed = namespace?.trim();
  return trimmed ? trimmed : 'cluster';
};

const buildNamespaceScope = (namespace?: string) => {
  const trimmed = namespace?.trim();
  return trimmed ? trimmed : CLUSTER_SCOPE;
};

const buildSelectionLabel = (item: CatalogItem | null, useShortNames: boolean): string => {
  if (!item) {
    return 'No object selected';
  }
  const namespaceLabel = buildNamespaceLabel(item.namespace);
  const clusterLabel = item.clusterName?.trim() || item.clusterId?.trim() || '';
  const scopePrefix = clusterLabel
    ? `${clusterLabel}/${namespaceLabel}/${item.name}`
    : `${namespaceLabel}/${item.name}`;
  const kindLabel = getDisplayKind(item.kind, useShortNames);
  return `${scopePrefix} (${kindLabel})`;
};

const isSnapshotLoading = (status: string) => status === 'loading' || status === 'initialising';

// Format a concise, user-friendly age label for change notifications.
const formatChangeAge = (timestamp: number): string => {
  const age = formatAge(timestamp);
  return age === 'now' ? 'just now' : `${age} ago`;
};

const normalizeMatchNamespace = (namespace?: string | null): string => {
  const trimmed = namespace?.trim();
  return trimmed ? trimmed : CLUSTER_SCOPE;
};

type DisplayDiffLine = DiffLine & {
  leftType: DiffLineType;
  rightType: DiffLineType;
};

// Merge adjacent remove/add blocks so modifications display on a single row.
const mergeDiffLines = (lines: DiffLine[]): DisplayDiffLine[] => {
  const merged: DisplayDiffLine[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.type === 'context') {
      merged.push({
        ...line,
        leftType: 'context',
        rightType: 'context',
      });
      continue;
    }

    const removed: DiffLine[] = [];
    const added: DiffLine[] = [];
    while (i < lines.length && lines[i].type !== 'context') {
      if (lines[i].type === 'removed') {
        removed.push(lines[i]);
      } else {
        added.push(lines[i]);
      }
      i += 1;
    }

    const maxCount = Math.max(removed.length, added.length);
    for (let idx = 0; idx < maxCount; idx += 1) {
      const removedLine = removed[idx];
      const addedLine = added[idx];
      if (removedLine && addedLine) {
        merged.push({
          type: 'context',
          value: '',
          leftLineNumber: removedLine.leftLineNumber,
          rightLineNumber: addedLine.rightLineNumber,
          leftType: 'removed',
          rightType: 'added',
        });
      } else if (removedLine) {
        merged.push({
          ...removedLine,
          leftType: 'removed',
          rightType: 'context',
        });
      } else if (addedLine) {
        merged.push({
          ...addedLine,
          leftType: 'context',
          rightType: 'added',
        });
      }
    }

    if (i < lines.length && lines[i].type === 'context') {
      i -= 1;
    }
  }

  return merged;
};

const buildObjectOptions = (items: CatalogItem[]): DropdownOption[] =>
  items.map((item) => ({
    value: item.uid,
    label: item.name,
    metadata: item,
  }));

const buildNamespaceOptions = (namespaces: string[]): DropdownOption[] => {
  const options = new Map<string, DropdownOption>();

  namespaces.forEach((namespace) => {
    const value = namespace.trim();
    if (!value) {
      return;
    }
    options.set(value.toLowerCase(), { value, label: value });
  });

  const sorted = Array.from(options.values()).sort((a, b) => a.label.localeCompare(b.label));
  // Keep cluster-scoped at the top, then separate the namespaced entries.
  const clusterOption: DropdownOption = { value: CLUSTER_SCOPE, label: CLUSTER_SCOPE_LABEL };
  if (sorted.length === 0) {
    return [clusterOption];
  }

  return [
    clusterOption,
    { value: NAMESPACE_SEPARATOR_VALUE, label: '', group: 'header' },
    ...sorted,
  ];
};

// Fall back to payload items when the namespace list is unavailable.
const resolveNamespaceList = (payload: CatalogSnapshotPayload | null): string[] => {
  const namespaces = payload?.namespaces ?? [];
  if (namespaces.length > 0) {
    return namespaces;
  }
  const items = payload?.items ?? [];
  const fromItems = new Set<string>();
  items.forEach((item) => {
    if (item.namespace) {
      fromItems.add(item.namespace);
    }
  });
  return Array.from(fromItems);
};

const buildKindOptions = (kinds: string[], useShortNames: boolean): DropdownOption[] => {
  const options = new Map<string, DropdownOption>();
  kinds.forEach((kind) => {
    const value = kind.trim();
    if (!value) {
      return;
    }
    options.set(value.toLowerCase(), { value, label: getDisplayKind(value, useShortNames) });
  });
  return Array.from(options.values()).sort((a, b) => a.label.localeCompare(b.label));
};

const useCatalogDiffSnapshot = (
  clusterId: string,
  namespace: string | undefined,
  kind: string | undefined,
  enabled: boolean
) => {
  const scope = useMemo(() => {
    if (!enabled) {
      return null;
    }
    return buildCatalogDiffScope({ clusterId, namespace, kind });
  }, [clusterId, enabled, kind, namespace]);
  const effectiveScope = scope ?? INACTIVE_SCOPE;
  const state = useRefreshScopedDomain('catalog-diff', effectiveScope);

  useEffect(() => {
    if (!scope || !enabled) {
      return;
    }

    refreshOrchestrator.setScopedDomainEnabled('catalog-diff', scope, true);
    void refreshOrchestrator.fetchScopedDomain('catalog-diff', scope, { isManual: true });

    return () => {
      // Clean up the previous scope to prevent background refreshes.
      refreshOrchestrator.setScopedDomainEnabled('catalog-diff', scope, false);
      refreshOrchestrator.resetScopedDomain('catalog-diff', scope);
    };
  }, [enabled, scope]);

  return { scope, state };
};

const useObjectYamlSnapshot = (selection: CatalogItem | null, enabled: boolean) => {
  const scope = useMemo(() => {
    if (!enabled || !selection?.clusterId || !selection.kind || !selection.name) {
      return null;
    }

    // Use the cluster-scope token when the object has no namespace.
    const namespaceSegment = buildNamespaceScope(selection.namespace);
    const kindSegment = selection.kind.toLowerCase();
    const rawScope = `${namespaceSegment}:${kindSegment}:${selection.name}`;
    return buildClusterScope(selection.clusterId, rawScope);
  }, [enabled, selection]);

  const effectiveScope = scope ?? INACTIVE_SCOPE;
  const state = useRefreshScopedDomain('object-yaml', effectiveScope);

  useEffect(() => {
    if (!scope || !enabled) {
      return;
    }

    refreshOrchestrator.setScopedDomainEnabled('object-yaml', scope, true);
    void refreshOrchestrator.fetchScopedDomain('object-yaml', scope, { isManual: true });

    return () => {
      refreshOrchestrator.setScopedDomainEnabled('object-yaml', scope, false);
      refreshOrchestrator.resetScopedDomain('object-yaml', scope);
    };
  }, [enabled, scope]);

  return { scope, state };
};

const ObjectDiffModal: React.FC<ObjectDiffModalProps> = ({ isOpen, onClose }) => {
  const { selectedKubeconfigs, getClusterMeta } = useKubeconfig();
  const [isClosing, setIsClosing] = useState(false);
  const [shouldRender, setShouldRender] = useState(false);
  const [leftClusterId, setLeftClusterId] = useState('');
  const [rightClusterId, setRightClusterId] = useState('');
  const [leftNamespace, setLeftNamespace] = useState('');
  const [rightNamespace, setRightNamespace] = useState('');
  const [leftKind, setLeftKind] = useState('');
  const [rightKind, setRightKind] = useState('');
  const [leftObjectUid, setLeftObjectUid] = useState('');
  const [rightObjectUid, setRightObjectUid] = useState('');
  const [leftChangedAt, setLeftChangedAt] = useState<number | null>(null);
  const [rightChangedAt, setRightChangedAt] = useState<number | null>(null);
  const [leftYamlStable, setLeftYamlStable] = useState('');
  const [rightYamlStable, setRightYamlStable] = useState('');
  const [showDiffOnly, setShowDiffOnly] = useState(false);
  const [selectionSide, setSelectionSide] = useState<'left' | 'right'>('left');
  const [leftNoMatch, setLeftNoMatch] = useState(false);
  const [rightNoMatch, setRightNoMatch] = useState(false);
  const [pendingLeftMatch, setPendingLeftMatch] = useState<MatchRequest | null>(null);
  const [pendingRightMatch, setPendingRightMatch] = useState<MatchRequest | null>(null);
  const { pushContext, popContext } = useKeyboardContext();
  const contextPushedRef = useRef(false);
  const leftChecksumRef = useRef<string | null>(null);
  const rightChecksumRef = useRef<string | null>(null);
  const leftNoMatchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rightNoMatchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const diffTableRef = useRef<HTMLDivElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const useShortNamesSetting = useShortNames();

  const clusterOptions = useMemo<DropdownOption[]>(() => {
    const seen = new Map<string, string>();
    selectedKubeconfigs.forEach((selection) => {
      const meta = getClusterMeta(selection);
      if (!meta.id) {
        return;
      }
      const label = meta.name?.trim() || meta.id;
      if (!seen.has(meta.id)) {
        seen.set(meta.id, label);
      }
    });

    return Array.from(seen.entries()).map(([value, label]) => ({ value, label }));
  }, [getClusterMeta, selectedKubeconfigs]);

  useEffect(() => {
    if (isOpen) {
      setShouldRender(true);
      setIsClosing(false);
    } else if (shouldRender) {
      setIsClosing(true);
      const timer = setTimeout(() => {
        setShouldRender(false);
        setIsClosing(false);
      }, 200);
      return () => clearTimeout(timer);
    }
  }, [isOpen, shouldRender]);

  useEffect(() => {
    if (!isOpen) {
      if (contextPushedRef.current) {
        popContext();
        contextPushedRef.current = false;
      }
      document.body.style.overflow = '';
      return;
    }

    pushContext({ priority: KeyboardContextPriority.OBJECT_DIFF_MODAL });
    contextPushedRef.current = true;
    document.body.style.overflow = 'hidden';

    return () => {
      if (contextPushedRef.current) {
        popContext();
        contextPushedRef.current = false;
      }
      document.body.style.overflow = '';
    };
  }, [isOpen, popContext, pushContext]);

  useEffect(
    () => () => {
      if (leftNoMatchTimerRef.current) {
        clearTimeout(leftNoMatchTimerRef.current);
      }
      if (rightNoMatchTimerRef.current) {
        clearTimeout(rightNoMatchTimerRef.current);
      }
    },
    []
  );

  useShortcut({
    key: 'Escape',
    handler: () => {
      if (!isOpen) return false;
      onClose();
      return true;
    },
    description: 'Close object diff modal',
    category: 'Modals',
    enabled: isOpen,
    view: 'global',
    priority: KeyboardContextPriority.OBJECT_DIFF_MODAL,
  });

  useModalFocusTrap({
    ref: modalRef,
    focusableSelector: '.dropdown-trigger, button, input',
    priority: KeyboardScopePriority.OBJECT_DIFF_MODAL,
    disabled: !isOpen,
  });

  // Use scoped catalog snapshots so namespace options remain global while kinds/objects cascade.
  const leftBaseEnabled = isOpen && Boolean(leftClusterId);
  const rightBaseEnabled = isOpen && Boolean(rightClusterId);
  const leftNamespaceEnabled = leftBaseEnabled && Boolean(leftNamespace);
  const rightNamespaceEnabled = rightBaseEnabled && Boolean(rightNamespace);
  const leftObjectEnabled = leftNamespaceEnabled && Boolean(leftKind);
  const rightObjectEnabled = rightNamespaceEnabled && Boolean(rightKind);

  const leftBaseCatalog = useCatalogDiffSnapshot(
    leftClusterId,
    undefined,
    undefined,
    leftBaseEnabled
  );
  const rightBaseCatalog = useCatalogDiffSnapshot(
    rightClusterId,
    undefined,
    undefined,
    rightBaseEnabled
  );
  const leftNamespaceCatalog = useCatalogDiffSnapshot(
    leftClusterId,
    leftNamespace || undefined,
    undefined,
    leftNamespaceEnabled
  );
  const rightNamespaceCatalog = useCatalogDiffSnapshot(
    rightClusterId,
    rightNamespace || undefined,
    undefined,
    rightNamespaceEnabled
  );
  const leftObjectCatalog = useCatalogDiffSnapshot(
    leftClusterId,
    leftNamespace || undefined,
    leftKind || undefined,
    leftObjectEnabled
  );
  const rightObjectCatalog = useCatalogDiffSnapshot(
    rightClusterId,
    rightNamespace || undefined,
    rightKind || undefined,
    rightObjectEnabled
  );

  const leftBasePayload = leftBaseCatalog.state.data as CatalogSnapshotPayload | null;
  const rightBasePayload = rightBaseCatalog.state.data as CatalogSnapshotPayload | null;
  const leftNamespacePayload = leftNamespaceCatalog.state.data as CatalogSnapshotPayload | null;
  const rightNamespacePayload = rightNamespaceCatalog.state.data as CatalogSnapshotPayload | null;
  const leftObjectPayload = leftObjectCatalog.state.data as CatalogSnapshotPayload | null;
  const rightObjectPayload = rightObjectCatalog.state.data as CatalogSnapshotPayload | null;

  const leftNamespaceOptions = useMemo(
    () =>
      buildNamespaceOptions(resolveNamespaceList(leftBasePayload ?? leftNamespacePayload ?? null)),
    [leftBasePayload, leftNamespacePayload]
  );
  const rightNamespaceOptions = useMemo(
    () =>
      buildNamespaceOptions(
        resolveNamespaceList(rightBasePayload ?? rightNamespacePayload ?? null)
      ),
    [rightBasePayload, rightNamespacePayload]
  );
  const leftKindOptions = useMemo(() => {
    if (!leftNamespace) {
      return [];
    }
    return buildKindOptions(leftNamespacePayload?.kinds ?? [], useShortNamesSetting);
  }, [leftNamespace, leftNamespacePayload?.kinds, useShortNamesSetting]);
  const rightKindOptions = useMemo(() => {
    if (!rightNamespace) {
      return [];
    }
    return buildKindOptions(rightNamespacePayload?.kinds ?? [], useShortNamesSetting);
  }, [rightNamespace, rightNamespacePayload?.kinds, useShortNamesSetting]);
  const leftObjectOptions = useMemo(() => {
    if (!leftObjectEnabled) {
      return [];
    }
    return buildObjectOptions(leftObjectPayload?.items ?? []);
  }, [leftObjectEnabled, leftObjectPayload?.items]);
  const rightObjectOptions = useMemo(() => {
    if (!rightObjectEnabled) {
      return [];
    }
    return buildObjectOptions(rightObjectPayload?.items ?? []);
  }, [rightObjectEnabled, rightObjectPayload?.items]);
  const leftObjectMap = useMemo(
    () => new Map((leftObjectPayload?.items ?? []).map((item) => [item.uid, item])),
    [leftObjectPayload?.items]
  );
  const rightObjectMap = useMemo(
    () => new Map((rightObjectPayload?.items ?? []).map((item) => [item.uid, item])),
    [rightObjectPayload?.items]
  );
  const leftSelection = leftObjectUid ? (leftObjectMap.get(leftObjectUid) ?? null) : null;
  const rightSelection = rightObjectUid ? (rightObjectMap.get(rightObjectUid) ?? null) : null;

  const leftNamespaceLoading = leftBaseEnabled && isSnapshotLoading(leftBaseCatalog.state.status);
  const rightNamespaceLoading =
    rightBaseEnabled && isSnapshotLoading(rightBaseCatalog.state.status);
  const leftKindLoading =
    leftNamespaceEnabled && isSnapshotLoading(leftNamespaceCatalog.state.status);
  const rightKindLoading =
    rightNamespaceEnabled && isSnapshotLoading(rightNamespaceCatalog.state.status);
  const leftObjectLoading = leftObjectEnabled && isSnapshotLoading(leftObjectCatalog.state.status);
  const rightObjectLoading =
    rightObjectEnabled && isSnapshotLoading(rightObjectCatalog.state.status);
  const leftNamespaceError = leftBaseCatalog.state.error ?? null;
  const rightNamespaceError = rightBaseCatalog.state.error ?? null;
  const leftKindError = leftNamespaceCatalog.state.error ?? null;
  const rightKindError = rightNamespaceCatalog.state.error ?? null;
  const leftObjectError = leftObjectCatalog.state.error ?? null;
  const rightObjectError = rightObjectCatalog.state.error ?? null;
  const leftCatalogError = leftObjectError ?? leftKindError ?? leftNamespaceError;
  const rightCatalogError = rightObjectError ?? rightKindError ?? rightNamespaceError;

  const showNoMatch = (side: 'left' | 'right') => {
    const setMessage = side === 'left' ? setLeftNoMatch : setRightNoMatch;
    const timerRef = side === 'left' ? leftNoMatchTimerRef : rightNoMatchTimerRef;
    setMessage(true);
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(() => {
      setMessage(false);
    }, 2000);
  };

  const leftYaml = useObjectYamlSnapshot(leftSelection, isOpen);
  const rightYaml = useObjectYamlSnapshot(rightSelection, isOpen);
  const leftYamlPayload = leftYaml.state.data;
  const rightYamlPayload = rightYaml.state.data;
  const leftYamlRaw = leftYamlPayload?.yaml ?? '';
  const rightYamlRaw = rightYamlPayload?.yaml ?? '';
  const leftYamlReady = leftYaml.state.status === 'ready';
  const rightYamlReady = rightYaml.state.status === 'ready';
  const leftYamlStableSource = leftYamlStable || leftYamlRaw;
  const rightYamlStableSource = rightYamlStable || rightYamlRaw;
  const leftYamlNormalized = useMemo(
    () => (leftYamlStableSource ? sanitizeYamlForDiff(leftYamlStableSource) : ''),
    [leftYamlStableSource]
  );
  const rightYamlNormalized = useMemo(
    () => (rightYamlStableSource ? sanitizeYamlForDiff(rightYamlStableSource) : ''),
    [rightYamlStableSource]
  );
  const leftMutedLines = useMemo(
    () => buildIgnoredMetadataLineSet(leftYamlNormalized),
    [leftYamlNormalized]
  );
  const rightMutedLines = useMemo(
    () => buildIgnoredMetadataLineSet(rightYamlNormalized),
    [rightYamlNormalized]
  );
  const leftMaskedYaml = useMemo(
    () => maskMutedMetadataLines(leftYamlNormalized, leftMutedLines),
    [leftMutedLines, leftYamlNormalized]
  );
  const rightMaskedYaml = useMemo(
    () => maskMutedMetadataLines(rightYamlNormalized, rightMutedLines),
    [rightMutedLines, rightYamlNormalized]
  );
  const leftDisplayLines = useMemo(() => leftYamlNormalized.split(/\r?\n/), [leftYamlNormalized]);
  const rightDisplayLines = useMemo(
    () => rightYamlNormalized.split(/\r?\n/),
    [rightYamlNormalized]
  );

  const diffResult = useMemo<DiffResult | null>(() => {
    if (!leftMaskedYaml || !rightMaskedYaml) {
      return null;
    }
    return computeLineDiff(leftMaskedYaml, rightMaskedYaml);
  }, [leftMaskedYaml, rightMaskedYaml]);

  const diffLines = diffResult?.lines ?? [];
  const displayDiffLines = useMemo(() => mergeDiffLines(diffLines), [diffLines]);
  const visibleDiffLines = useMemo(() => {
    if (!showDiffOnly) {
      return displayDiffLines;
    }
    return displayDiffLines.filter(
      (line) => line.leftType !== 'context' || line.rightType !== 'context'
    );
  }, [displayDiffLines, showDiffOnly]);
  const diffTruncated = diffResult?.truncated ?? false;
  const leftYamlError = leftYaml.state.error ?? null;
  const rightYamlError = rightYaml.state.error ?? null;
  const leftYamlInitialLoading =
    leftYaml.state.status === 'loading' || leftYaml.state.status === 'initialising';
  const rightYamlInitialLoading =
    rightYaml.state.status === 'loading' || rightYaml.state.status === 'initialising';

  // Reset change tracking when the user swaps objects.
  useEffect(() => {
    leftChecksumRef.current = null;
    setLeftChangedAt(null);
    setLeftYamlStable('');
  }, [leftObjectUid]);

  useEffect(() => {
    rightChecksumRef.current = null;
    setRightChangedAt(null);
    setRightYamlStable('');
  }, [rightObjectUid]);

  useEffect(() => {
    if (leftYamlRaw.trim()) {
      setLeftYamlStable(leftYamlRaw);
      return;
    }
    if (leftYamlReady && !leftYamlRaw.trim()) {
      setLeftYamlStable('');
    }
  }, [leftYamlRaw, leftYamlReady]);

  useEffect(() => {
    if (rightYamlRaw.trim()) {
      setRightYamlStable(rightYamlRaw);
      return;
    }
    if (rightYamlReady && !rightYamlRaw.trim()) {
      setRightYamlStable('');
    }
  }, [rightYamlRaw, rightYamlReady]);

  // Resolve pending match requests after the opposite side loads its object list.
  useEffect(() => {
    if (!pendingRightMatch || !rightObjectEnabled) {
      return;
    }
    if (rightNamespace !== pendingRightMatch.namespace || rightKind !== pendingRightMatch.kind) {
      return;
    }
    if (rightObjectCatalog.state.status === 'error') {
      showNoMatch('right');
      setPendingRightMatch(null);
      return;
    }
    if (rightObjectCatalog.state.status !== 'ready') {
      return;
    }

    const match = (rightObjectPayload?.items ?? []).find((item) => {
      const namespaceMatch =
        pendingRightMatch.namespace === CLUSTER_SCOPE
          ? !item.namespace
          : item.namespace?.toLowerCase() === pendingRightMatch.namespace.toLowerCase();
      return (
        namespaceMatch &&
        item.kind === pendingRightMatch.kind &&
        item.name === pendingRightMatch.name
      );
    });

    if (match) {
      setRightObjectUid(match.uid);
    } else {
      showNoMatch('right');
    }
    setPendingRightMatch(null);
  }, [
    pendingRightMatch,
    rightKind,
    rightNamespace,
    rightObjectCatalog.state.status,
    rightObjectEnabled,
    rightObjectPayload?.items,
  ]);

  // Resolve pending match requests after the opposite side loads its object list.
  useEffect(() => {
    if (!pendingLeftMatch || !leftObjectEnabled) {
      return;
    }
    if (leftNamespace !== pendingLeftMatch.namespace || leftKind !== pendingLeftMatch.kind) {
      return;
    }
    if (leftObjectCatalog.state.status === 'error') {
      showNoMatch('left');
      setPendingLeftMatch(null);
      return;
    }
    if (leftObjectCatalog.state.status !== 'ready') {
      return;
    }

    const match = (leftObjectPayload?.items ?? []).find((item) => {
      const namespaceMatch =
        pendingLeftMatch.namespace === CLUSTER_SCOPE
          ? !item.namespace
          : item.namespace?.toLowerCase() === pendingLeftMatch.namespace.toLowerCase();
      return (
        namespaceMatch && item.kind === pendingLeftMatch.kind && item.name === pendingLeftMatch.name
      );
    });

    if (match) {
      setLeftObjectUid(match.uid);
    } else {
      showNoMatch('left');
    }
    setPendingLeftMatch(null);
  }, [
    leftKind,
    leftNamespace,
    leftObjectCatalog.state.status,
    leftObjectEnabled,
    leftObjectPayload?.items,
    pendingLeftMatch,
  ]);

  // Surface change events without clearing the existing diff view.
  useEffect(() => {
    const checksum = leftYaml.state.checksum ?? null;
    if (!checksum) {
      return;
    }
    if (leftChecksumRef.current && leftChecksumRef.current !== checksum) {
      setLeftChangedAt(Date.now());
    }
    leftChecksumRef.current = checksum;
  }, [leftYaml.state.checksum]);

  useEffect(() => {
    const checksum = rightYaml.state.checksum ?? null;
    if (!checksum) {
      return;
    }
    if (rightChecksumRef.current && rightChecksumRef.current !== checksum) {
      setRightChangedAt(Date.now());
    }
    rightChecksumRef.current = checksum;
  }, [rightYaml.state.checksum]);

  const handleLeftClusterChange = (value: string | string[]) => {
    if (typeof value !== 'string') {
      return;
    }
    setLeftClusterId(value);
    setLeftNamespace('');
    setLeftKind('');
    setLeftObjectUid('');
  };

  const handleRightClusterChange = (value: string | string[]) => {
    if (typeof value !== 'string') {
      return;
    }
    setRightClusterId(value);
    setRightNamespace('');
    setRightKind('');
    setRightObjectUid('');
  };

  const handleLeftNamespaceChange = (value: string | string[]) => {
    if (typeof value !== 'string' || !value) {
      setLeftNamespace('');
      setLeftKind('');
      setLeftObjectUid('');
      return;
    }
    setLeftNamespace(value);
    setLeftKind('');
    setLeftObjectUid('');
  };

  const handleRightNamespaceChange = (value: string | string[]) => {
    if (typeof value !== 'string' || !value) {
      setRightNamespace('');
      setRightKind('');
      setRightObjectUid('');
      return;
    }
    setRightNamespace(value);
    setRightKind('');
    setRightObjectUid('');
  };

  const handleLeftKindChange = (value: string | string[]) => {
    if (typeof value !== 'string' || !value) {
      setLeftKind('');
      setLeftObjectUid('');
      return;
    }
    setLeftKind(value);
    setLeftObjectUid('');
  };

  const handleRightKindChange = (value: string | string[]) => {
    if (typeof value !== 'string' || !value) {
      setRightKind('');
      setRightObjectUid('');
      return;
    }
    setRightKind(value);
    setRightObjectUid('');
  };

  const handleLeftSelectionChange = (value: string | string[]) => {
    if (typeof value !== 'string' || !value) {
      setLeftObjectUid('');
      return;
    }
    setLeftObjectUid(value);
  };

  const handleRightSelectionChange = (value: string | string[]) => {
    if (typeof value !== 'string' || !value) {
      setRightObjectUid('');
      return;
    }
    setRightObjectUid(value);
  };

  const handleLeftMatch = () => {
    if (!leftSelection || !leftClusterId || !rightClusterId) {
      return;
    }
    const namespace = normalizeMatchNamespace(leftSelection.namespace);
    setRightNamespace(namespace);
    setRightKind(leftSelection.kind);
    setRightObjectUid('');
    setRightNoMatch(false);
    setPendingRightMatch({
      namespace,
      kind: leftSelection.kind,
      name: leftSelection.name,
    });
  };

  const handleRightMatch = () => {
    if (!rightSelection || !leftClusterId || !rightClusterId) {
      return;
    }
    const namespace = normalizeMatchNamespace(rightSelection.namespace);
    setLeftNamespace(namespace);
    setLeftKind(rightSelection.kind);
    setLeftObjectUid('');
    setLeftNoMatch(false);
    setPendingLeftMatch({
      namespace,
      kind: rightSelection.kind,
      name: rightSelection.name,
    });
  };

  const getLineText = (lines: string[], lineNumber?: number | null): string => {
    if (!lineNumber || lineNumber < 1) {
      return '';
    }
    return lines[lineNumber - 1] ?? '';
  };

  const selectSideText = (side: 'left' | 'right') => {
    const table = diffTableRef.current;
    if (!table) {
      return;
    }
    const selector =
      side === 'left'
        ? '.object-diff-cell-left .object-diff-line-text'
        : '.object-diff-cell-right .object-diff-line-text';
    const nodes = Array.from(table.querySelectorAll<HTMLElement>(selector));
    if (nodes.length === 0) {
      return;
    }
    const selection = window.getSelection();
    if (!selection) {
      return;
    }
    const firstNode = nodes[0].firstChild ?? nodes[0];
    const lastNode = nodes[nodes.length - 1].firstChild ?? nodes[nodes.length - 1];
    const range = document.createRange();
    range.setStart(firstNode, 0);
    if (lastNode.nodeType === Node.TEXT_NODE) {
      range.setEnd(lastNode, lastNode.textContent?.length ?? 0);
    } else {
      range.setEnd(lastNode, lastNode.childNodes.length);
    }
    selection.removeAllRanges();
    selection.addRange(range);
  };

  const renderDiffRow = (line: DisplayDiffLine, index: number) => {
    const leftText = getLineText(leftDisplayLines, line.leftLineNumber);
    const rightText = getLineText(rightDisplayLines, line.rightLineNumber);
    const leftNumber =
      line.leftLineNumber !== null && line.leftLineNumber !== undefined ? line.leftLineNumber : '';
    const rightNumber =
      line.rightLineNumber !== null && line.rightLineNumber !== undefined
        ? line.rightLineNumber
        : '';
    const leftType = line.leftType;
    const rightType = line.rightType;
    const leftTitle = leftText || undefined;
    const rightTitle = rightText || undefined;

    const leftMuted =
      line.leftLineNumber !== null &&
      line.leftLineNumber !== undefined &&
      leftMutedLines.has(line.leftLineNumber);
    const rightMuted =
      line.rightLineNumber !== null &&
      line.rightLineNumber !== undefined &&
      rightMutedLines.has(line.rightLineNumber);

    return (
      <div key={`diff-${index}`} className={`object-diff-row object-diff-row-${line.type}`}>
        <div
          className={[
            'object-diff-cell',
            'object-diff-cell-left',
            `object-diff-cell-${leftType}`,
            leftMuted ? 'object-diff-cell-muted' : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          <span className="object-diff-line-number">{leftNumber}</span>
          <span className="object-diff-line-text" title={leftTitle}>
            {leftText}
          </span>
        </div>
        <div
          className={[
            'object-diff-cell',
            'object-diff-cell-right',
            `object-diff-cell-${rightType}`,
            rightMuted ? 'object-diff-cell-muted' : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          <span className="object-diff-line-number">{rightNumber}</span>
          <span className="object-diff-line-text" title={rightTitle}>
            {rightText}
          </span>
        </div>
      </div>
    );
  };

  const renderDiffContent = () => {
    if (!leftSelection || !rightSelection) {
      return <div className="object-diff-empty">Select objects on both sides to compare.</div>;
    }
    if (
      (leftYamlInitialLoading && !leftYamlNormalized) ||
      (rightYamlInitialLoading && !rightYamlNormalized)
    ) {
      return <div className="object-diff-empty">Loading YAML...</div>;
    }
    if (leftYamlError || rightYamlError) {
      return (
        <div className="object-diff-empty object-diff-error">
          {leftYamlError && <div>Left YAML error: {leftYamlError}</div>}
          {rightYamlError && <div>Right YAML error: {rightYamlError}</div>}
        </div>
      );
    }
    if (!leftYamlNormalized || !rightYamlNormalized) {
      return <div className="object-diff-empty">YAML is not available for both objects.</div>;
    }
    if (diffTruncated) {
      return (
        <div className="object-diff-empty object-diff-warning">
          Diff too large to display. Refine the selections to reduce output.
        </div>
      );
    }

    return (
      <div
        className={`object-diff-table selection-${selectionSide}`}
        ref={diffTableRef}
        onMouseDown={(event) => {
          const target = event.target as HTMLElement | null;
          if (target?.closest('.object-diff-cell-left')) {
            flushSync(() => setSelectionSide('left'));
            return;
          }
          if (target?.closest('.object-diff-cell-right')) {
            flushSync(() => setSelectionSide('right'));
          }
        }}
        onClick={(event) => {
          if (event.detail !== 3) {
            return;
          }
          const target = event.target as HTMLElement | null;
          const side = target?.closest('.object-diff-cell-left')
            ? 'left'
            : target?.closest('.object-diff-cell-right')
              ? 'right'
              : null;
          if (!side) {
            return;
          }
          event.preventDefault();
          flushSync(() => setSelectionSide(side));
          selectSideText(side);
        }}
      >
        {visibleDiffLines.map(renderDiffRow)}
      </div>
    );
  };

  if (!shouldRender) return null;

  return (
    <div
      className={`modal-overlay object-diff-modal-overlay ${isClosing ? 'closing' : ''}`}
      onClick={onClose}
    >
      <div
        className={`modal-container object-diff-modal ${isClosing ? 'closing' : ''}`}
        onClick={(event) => event.stopPropagation()}
        ref={modalRef}
      >
        <div className="modal-header object-diff-modal-header">
          <h2>Diff Objects</h2>
          <button
            className="modal-close object-diff-modal-close"
            onClick={onClose}
            aria-label="Close object diff"
          >
            ×
          </button>
        </div>
        <div className="modal-content object-diff-modal-content">
          <div className="object-diff-selector-grid">
            <div className="object-diff-selector">
              <div className="object-diff-selector-header">
                <span className="object-diff-selector-title">Left</span>
                <div className="object-diff-selector-actions">
                  <button
                    type="button"
                    className="button generic object-diff-match"
                    onClick={handleLeftMatch}
                    disabled={!leftSelection || !leftClusterId || !rightClusterId}
                  >
                    Match
                  </button>
                  <button
                    type="button"
                    className="button generic object-diff-clear"
                    onClick={() => setLeftObjectUid('')}
                    disabled={!leftSelection}
                  >
                    Clear
                  </button>
                </div>
              </div>
              {leftNoMatch && <div className="object-diff-match-message">No match found</div>}
              <div className="object-diff-field">
                <label className="object-diff-label" htmlFor="object-diff-left-cluster">
                  Cluster
                </label>
                <Dropdown
                  id="object-diff-left-cluster"
                  options={clusterOptions}
                  value={leftClusterId}
                  onChange={handleLeftClusterChange}
                  placeholder="Select cluster"
                  disabled={clusterOptions.length <= 1}
                  ariaLabel="Left cluster"
                />
              </div>
              <div className="object-diff-field">
                <label className="object-diff-label" htmlFor="object-diff-left-namespace">
                  Namespace
                </label>
                <Dropdown
                  id="object-diff-left-namespace"
                  options={leftNamespaceOptions}
                  value={leftNamespace}
                  onChange={handleLeftNamespaceChange}
                  placeholder="Select namespace"
                  loading={leftNamespaceLoading}
                  disabled={!leftClusterId}
                  error={Boolean(leftNamespaceError)}
                  ariaLabel="Left namespace"
                />
              </div>
              <div className="object-diff-field">
                <label className="object-diff-label" htmlFor="object-diff-left-kind">
                  Kind
                </label>
                <Dropdown
                  id="object-diff-left-kind"
                  options={leftKindOptions}
                  value={leftKind}
                  onChange={handleLeftKindChange}
                  placeholder="Select kind"
                  loading={leftKindLoading}
                  disabled={!leftClusterId || !leftNamespace}
                  error={Boolean(leftKindError)}
                  ariaLabel="Left kind"
                />
              </div>
              <div className="object-diff-field">
                <label className="object-diff-label" htmlFor="object-diff-left-object">
                  Object
                </label>
                <Dropdown
                  id="object-diff-left-object"
                  options={leftObjectOptions}
                  value={leftObjectUid}
                  onChange={handleLeftSelectionChange}
                  placeholder="Select object"
                  loading={leftObjectLoading}
                  disabled={!leftClusterId || !leftNamespace || !leftKind}
                  error={Boolean(leftObjectError)}
                  ariaLabel="Left object"
                />
              </div>
              {leftCatalogError && (
                <div className="object-diff-error-message">Catalog error: {leftCatalogError}</div>
              )}
            </div>

            <div className="object-diff-selector">
              <div className="object-diff-selector-header">
                <span className="object-diff-selector-title">Right</span>
                <div className="object-diff-selector-actions">
                  <button
                    type="button"
                    className="button generic object-diff-match"
                    onClick={handleRightMatch}
                    disabled={!rightSelection || !leftClusterId || !rightClusterId}
                  >
                    Match
                  </button>
                  <button
                    type="button"
                    className="button generic object-diff-clear"
                    onClick={() => setRightObjectUid('')}
                    disabled={!rightSelection}
                  >
                    Clear
                  </button>
                </div>
              </div>
              {rightNoMatch && <div className="object-diff-match-message">No match found</div>}
              <div className="object-diff-field">
                <label className="object-diff-label" htmlFor="object-diff-right-cluster">
                  Cluster
                </label>
                <Dropdown
                  id="object-diff-right-cluster"
                  options={clusterOptions}
                  value={rightClusterId}
                  onChange={handleRightClusterChange}
                  placeholder="Select cluster"
                  disabled={clusterOptions.length <= 1}
                  ariaLabel="Right cluster"
                />
              </div>
              <div className="object-diff-field">
                <label className="object-diff-label" htmlFor="object-diff-right-namespace">
                  Namespace
                </label>
                <Dropdown
                  id="object-diff-right-namespace"
                  options={rightNamespaceOptions}
                  value={rightNamespace}
                  onChange={handleRightNamespaceChange}
                  placeholder="Select namespace"
                  loading={rightNamespaceLoading}
                  disabled={!rightClusterId}
                  error={Boolean(rightNamespaceError)}
                  ariaLabel="Right namespace"
                />
              </div>
              <div className="object-diff-field">
                <label className="object-diff-label" htmlFor="object-diff-right-kind">
                  Kind
                </label>
                <Dropdown
                  id="object-diff-right-kind"
                  options={rightKindOptions}
                  value={rightKind}
                  onChange={handleRightKindChange}
                  placeholder="Select kind"
                  loading={rightKindLoading}
                  disabled={!rightClusterId || !rightNamespace}
                  error={Boolean(rightKindError)}
                  ariaLabel="Right kind"
                />
              </div>
              <div className="object-diff-field">
                <label className="object-diff-label" htmlFor="object-diff-right-object">
                  Object
                </label>
                <Dropdown
                  id="object-diff-right-object"
                  options={rightObjectOptions}
                  value={rightObjectUid}
                  onChange={handleRightSelectionChange}
                  placeholder="Select object"
                  loading={rightObjectLoading}
                  disabled={!rightClusterId || !rightNamespace || !rightKind}
                  error={Boolean(rightObjectError)}
                  ariaLabel="Right object"
                />
              </div>
              {rightCatalogError && (
                <div className="object-diff-error-message">Catalog error: {rightCatalogError}</div>
              )}
            </div>
          </div>

          <div className="object-diff-viewer">
            <div className="object-diff-viewer-header">
              <div className="object-diff-viewer-header-row">
                <div className="object-diff-viewer-title-group">
                  <div className="object-diff-viewer-title">Diff Viewer</div>
                  <span
                    className="object-diff-info-indicator"
                    title="Ignored fields: metadata.managedFields. Muted fields: metadata.resourceVersion, metadata.creationTimestamp, metadata.uid."
                    aria-label="Diff metadata field info"
                  >
                    i
                  </span>
                </div>
                <button
                  type="button"
                  className="button generic object-diff-toggle"
                  onClick={() => setShowDiffOnly((value) => !value)}
                  disabled={!leftSelection || !rightSelection}
                >
                  {showDiffOnly ? 'Show All' : 'Show Diffs'}
                </button>
              </div>
              {(leftChangedAt || rightChangedAt) && (
                <div className="object-diff-change-indicator">
                  {leftChangedAt && (
                    <span
                      className="object-diff-change-item"
                      title={`Left changed ${formatFullDate(leftChangedAt)}`}
                    >
                      Left changed {formatChangeAge(leftChangedAt)}
                    </span>
                  )}
                  {rightChangedAt && (
                    <span
                      className="object-diff-change-item"
                      title={`Right changed ${formatFullDate(rightChangedAt)}`}
                    >
                      Right changed {formatChangeAge(rightChangedAt)}
                    </span>
                  )}
                </div>
              )}
            </div>
            <div className="object-diff-column-headers">
              <div className="object-diff-column-title">
                {buildSelectionLabel(leftSelection, useShortNamesSetting)}
              </div>
              <div className="object-diff-column-title">
                {buildSelectionLabel(rightSelection, useShortNamesSetting)}
              </div>
            </div>
            {renderDiffContent()}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ObjectDiffModal;
