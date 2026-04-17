/**
 * frontend/src/components/modals/ObjectDiffModal.tsx
 *
 * UI component for ObjectDiffModal.
 * Provides a global, side-by-side YAML diff viewer for Kubernetes objects.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './modals.css';
import './ObjectDiffModal.css';
import Dropdown from '@shared/components/dropdowns/Dropdown/Dropdown';
import { CloseIcon } from '@shared/components/icons/MenuIcons';
import type { DropdownOption } from '@shared/components/dropdowns/Dropdown/types';
import { useModalFocusTrap } from '@shared/components/modals/useModalFocusTrap';
import ModalSurface from '@shared/components/modals/ModalSurface';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import { buildClusterScope, buildObjectScope } from '@core/refresh/clusterScope';
import { refreshOrchestrator, useRefreshScopedDomain } from '@core/refresh';
import type { CatalogItem, CatalogSnapshotPayload } from '@core/refresh/types';
import { computeBudgetedLineDiff, type LineDiffResult } from '@shared/components/diff/lineDiff';
import { OBJECT_DIFF_BUDGETS } from '@shared/components/diff/diffBudgets';
import {
  countVisibleDiffRows,
  formatTooLargeDiffMessage,
  mergeDiffLines,
} from '@shared/components/diff/diffUtils';
import DiffViewer from '@shared/components/diff/DiffViewer';
import {
  buildIgnoredMetadataLineSet,
  maskMutedMetadataLines,
  sanitizeYamlForDiff,
} from './objectDiffUtils';
import { FindCatalogObjectMatch } from '@wailsjs/go/backend/App';
import {
  CLUSTER_SCOPE,
  INACTIVE_SCOPE,
} from '@modules/object-panel/components/ObjectPanel/constants';
import { getDisplayKind } from '@/utils/kindAliasMap';
import { formatAge, formatFullDate } from '@/utils/ageFormatter';
import { useShortNames } from '@/hooks/useShortNames';
import type {
  ObjectDiffOpenRequest,
  ObjectDiffSelectionSeed,
} from '@shared/components/diff/objectDiffSelection';

interface ObjectDiffModalProps {
  isOpen: boolean;
  initialRequest?: ObjectDiffOpenRequest | null;
  onClose: () => void;
}

const CATALOG_QUERY_LIMIT = 200;
const CLUSTER_SCOPE_LABEL = 'cluster-scoped';
const NAMESPACE_SEPARATOR_VALUE = '__namespace-separator__';
const OBJECT_DIFF_TOO_LARGE_MESSAGE = 'This diff is too large to display in the current view.';

const buildCatalogScope = (params: {
  limit: number;
  namespace?: string;
  kind?: string;
  search?: string;
}) => {
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
  const search = params.search?.trim();
  if (search) {
    query.append('search', search);
  }
  return query.toString();
};

const buildCatalogDiffScope = (params: {
  clusterId: string;
  namespace?: string;
  kind?: string;
  search?: string;
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
    search: params.search,
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

const buildSelectionParts = (item: CatalogItem | null, useShortNames: boolean) => {
  if (!item) {
    return {
      hasSelection: false,
      clusterLabel: '',
      namespaceLabel: '',
      objectName: '',
      kindLabel: '',
    };
  }
  const namespaceLabel = buildNamespaceLabel(item.namespace);
  const clusterLabel = item.clusterName?.trim() || item.clusterId?.trim() || '';
  const kindLabel = getDisplayKind(item.kind, useShortNames);
  return {
    hasSelection: true,
    clusterLabel,
    namespaceLabel,
    objectName: item.name,
    kindLabel,
  };
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

const toCatalogItem = (value: unknown): CatalogItem | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const item = value as Partial<CatalogItem>;
  if (
    typeof item.clusterId !== 'string' ||
    typeof item.kind !== 'string' ||
    typeof item.group !== 'string' ||
    typeof item.version !== 'string' ||
    typeof item.name !== 'string' ||
    typeof item.uid !== 'string'
  ) {
    return null;
  }
  return item as CatalogItem;
};

const buildObjectOptions = (items: CatalogItem[]): DropdownOption[] =>
  items.map((item) => ({
    value: item.uid,
    label: item.name,
    metadata: item,
  }));

const mergeSelectedObject = (
  items: CatalogItem[],
  selection: CatalogItem | null
): CatalogItem[] => {
  if (!selection) {
    return items;
  }
  if (items.some((item) => item.uid === selection.uid)) {
    return items;
  }
  return [selection, ...items];
};

const sameCatalogItem = (left: CatalogItem | null, right: CatalogItem | null) => {
  if (left === right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }
  return (
    left.uid === right.uid &&
    left.name === right.name &&
    left.namespace === right.namespace &&
    left.kind === right.kind &&
    left.group === right.group &&
    left.version === right.version &&
    left.clusterId === right.clusterId &&
    left.clusterName === right.clusterName
  );
};

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
  search: string | undefined,
  enabled: boolean
) => {
  const scope = useMemo(() => {
    if (!enabled) {
      return null;
    }
    return buildCatalogDiffScope({ clusterId, namespace, kind, search });
  }, [clusterId, enabled, kind, namespace, search]);
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
    // CatalogItem already carries group/version from the backend catalog,
    // so the diff modal can always emit the GVK scope form. The backend
    // object-yaml provider will resolve the GVR strictly and avoid the
    // first-match-wins ambiguity that affects bare-kind scopes.
    const rawScope = buildObjectScope({
      namespace: namespaceSegment,
      group: selection.group,
      version: selection.version,
      kind: selection.kind.toLowerCase(),
      name: selection.name,
    });
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

const ObjectDiffModal: React.FC<ObjectDiffModalProps> = ({
  isOpen,
  initialRequest = null,
  onClose,
}) => {
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
  const [leftObjectSearch, setLeftObjectSearch] = useState('');
  const [rightObjectSearch, setRightObjectSearch] = useState('');
  const [leftSelectedObject, setLeftSelectedObject] = useState<CatalogItem | null>(null);
  const [rightSelectedObject, setRightSelectedObject] = useState<CatalogItem | null>(null);
  const [leftChangedAt, setLeftChangedAt] = useState<number | null>(null);
  const [rightChangedAt, setRightChangedAt] = useState<number | null>(null);
  const [leftYamlStable, setLeftYamlStable] = useState('');
  const [rightYamlStable, setRightYamlStable] = useState('');
  const [showDiffOnly, setShowDiffOnly] = useState(false);
  const [leftNoMatch, setLeftNoMatch] = useState(false);
  const [rightNoMatch, setRightNoMatch] = useState(false);
  const [leftMatching, setLeftMatching] = useState(false);
  const [rightMatching, setRightMatching] = useState(false);
  const leftChecksumRef = useRef<string | null>(null);
  const rightChecksumRef = useRef<string | null>(null);
  const leftNoMatchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rightNoMatchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leftClusterIdRef = useRef(leftClusterId);
  const rightClusterIdRef = useRef(rightClusterId);
  const leftObjectUidRef = useRef(leftObjectUid);
  const rightObjectUidRef = useRef(rightObjectUid);
  const leftMatchRequestRef = useRef(0);
  const rightMatchRequestRef = useRef(0);
  const appliedInitialRequestIdRef = useRef<number | null>(null);
  const leftInitialSelectionRequestRef = useRef(0);
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
    document.body.style.overflow = isOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  useEffect(() => {
    leftClusterIdRef.current = leftClusterId;
  }, [leftClusterId]);

  useEffect(() => {
    rightClusterIdRef.current = rightClusterId;
  }, [rightClusterId]);

  useEffect(() => {
    leftObjectUidRef.current = leftObjectUid;
  }, [leftObjectUid]);

  useEffect(() => {
    rightObjectUidRef.current = rightObjectUid;
  }, [rightObjectUid]);

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

  useModalFocusTrap({
    ref: modalRef,
    focusableSelector: '.dropdown-trigger, button, input',
    disabled: !shouldRender,
    onEscape: () => {
      if (!isOpen) return false;
      onClose();
      return true;
    },
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
    undefined,
    leftBaseEnabled
  );
  const rightBaseCatalog = useCatalogDiffSnapshot(
    rightClusterId,
    undefined,
    undefined,
    undefined,
    rightBaseEnabled
  );
  const leftNamespaceCatalog = useCatalogDiffSnapshot(
    leftClusterId,
    leftNamespace || undefined,
    undefined,
    undefined,
    leftNamespaceEnabled
  );
  const rightNamespaceCatalog = useCatalogDiffSnapshot(
    rightClusterId,
    rightNamespace || undefined,
    undefined,
    undefined,
    rightNamespaceEnabled
  );
  const leftObjectCatalog = useCatalogDiffSnapshot(
    leftClusterId,
    leftNamespace || undefined,
    leftKind || undefined,
    leftObjectSearch || undefined,
    leftObjectEnabled
  );
  const rightObjectCatalog = useCatalogDiffSnapshot(
    rightClusterId,
    rightNamespace || undefined,
    rightKind || undefined,
    rightObjectSearch || undefined,
    rightObjectEnabled
  );

  const leftBasePayload = leftBaseCatalog.state.data as CatalogSnapshotPayload | null;
  const rightBasePayload = rightBaseCatalog.state.data as CatalogSnapshotPayload | null;
  const leftNamespacePayload = leftNamespaceCatalog.state.data as CatalogSnapshotPayload | null;
  const rightNamespacePayload = rightNamespaceCatalog.state.data as CatalogSnapshotPayload | null;
  const leftObjectPayload = leftObjectCatalog.state.data as CatalogSnapshotPayload | null;
  const rightObjectPayload = rightObjectCatalog.state.data as CatalogSnapshotPayload | null;
  const leftVisibleItems = useMemo(
    () => mergeSelectedObject(leftObjectPayload?.items ?? [], leftSelectedObject),
    [leftObjectPayload?.items, leftSelectedObject]
  );
  const rightVisibleItems = useMemo(
    () => mergeSelectedObject(rightObjectPayload?.items ?? [], rightSelectedObject),
    [rightObjectPayload?.items, rightSelectedObject]
  );

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
    const kindNames = (leftNamespacePayload?.kinds ?? []).map((k) => k.kind);
    return buildKindOptions(kindNames, useShortNamesSetting);
  }, [leftNamespace, leftNamespacePayload?.kinds, useShortNamesSetting]);
  const rightKindOptions = useMemo(() => {
    if (!rightNamespace) {
      return [];
    }
    const kindNames = (rightNamespacePayload?.kinds ?? []).map((k) => k.kind);
    return buildKindOptions(kindNames, useShortNamesSetting);
  }, [rightNamespace, rightNamespacePayload?.kinds, useShortNamesSetting]);
  const leftObjectOptions = useMemo(() => {
    if (!leftObjectEnabled) {
      return [];
    }
    return buildObjectOptions(leftVisibleItems);
  }, [leftObjectEnabled, leftVisibleItems]);
  const rightObjectOptions = useMemo(() => {
    if (!rightObjectEnabled) {
      return [];
    }
    return buildObjectOptions(rightVisibleItems);
  }, [rightObjectEnabled, rightVisibleItems]);
  const leftObjectMap = useMemo(
    () => new Map(leftVisibleItems.map((item) => [item.uid, item])),
    [leftVisibleItems]
  );
  const rightObjectMap = useMemo(
    () => new Map(rightVisibleItems.map((item) => [item.uid, item])),
    [rightVisibleItems]
  );
  const leftSelection = leftObjectUid
    ? (leftObjectMap.get(leftObjectUid) ??
      (leftSelectedObject?.uid === leftObjectUid ? leftSelectedObject : null))
    : null;
  const rightSelection = rightObjectUid
    ? (rightObjectMap.get(rightObjectUid) ??
      (rightSelectedObject?.uid === rightObjectUid ? rightSelectedObject : null))
    : null;

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

  const showNoMatch = useCallback((side: 'left' | 'right') => {
    const setMessage = side === 'left' ? setLeftNoMatch : setRightNoMatch;
    const timerRef = side === 'left' ? leftNoMatchTimerRef : rightNoMatchTimerRef;
    setMessage(true);
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(() => {
      setMessage(false);
    }, 2000);
  }, []);

  const cancelPendingMatches = useCallback(() => {
    leftMatchRequestRef.current += 1;
    rightMatchRequestRef.current += 1;
    setLeftMatching(false);
    setRightMatching(false);
  }, []);

  const applyInitialLeftSelection = useCallback(
    async (selection: ObjectDiffSelectionSeed) => {
      const requestId = leftInitialSelectionRequestRef.current + 1;
      leftInitialSelectionRequestRef.current = requestId;
      cancelPendingMatches();
      setLeftNoMatch(false);
      setLeftClusterId(selection.clusterId);
      setLeftNamespace(normalizeMatchNamespace(selection.namespace));
      setLeftKind(selection.kind);
      setLeftObjectSearch('');
      setLeftSelectedObject(null);
      setLeftObjectUid('');

      try {
        const match = toCatalogItem(
          await FindCatalogObjectMatch(
            selection.clusterId,
            selection.namespace ?? '',
            selection.group,
            selection.version,
            selection.kind,
            selection.name
          )
        );
        if (leftInitialSelectionRequestRef.current !== requestId) {
          return;
        }
        if (!match) {
          showNoMatch('left');
          return;
        }
        setLeftNamespace(normalizeMatchNamespace(match.namespace));
        setLeftKind(match.kind);
        setLeftSelectedObject(match);
        setLeftObjectUid(match.uid);
      } catch {
        if (leftInitialSelectionRequestRef.current === requestId) {
          showNoMatch('left');
        }
      }
    },
    [cancelPendingMatches, showNoMatch]
  );

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
  const diffResult = useMemo<LineDiffResult | null>(() => {
    if (!leftMaskedYaml || !rightMaskedYaml) {
      return null;
    }
    return computeBudgetedLineDiff(leftMaskedYaml, rightMaskedYaml, OBJECT_DIFF_BUDGETS);
  }, [leftMaskedYaml, rightMaskedYaml]);

  const displayDiffLines = useMemo(() => mergeDiffLines(diffResult?.lines ?? []), [diffResult]);
  const diffTooLarge = diffResult?.tooLarge ?? false;
  const renderableRowCount = useMemo(
    () => countVisibleDiffRows(displayDiffLines, showDiffOnly),
    [displayDiffLines, showDiffOnly]
  );
  const renderTooLarge = renderableRowCount > OBJECT_DIFF_BUDGETS.maxRenderableRows;
  const diffTooLargeMessage = useMemo(() => {
    if (renderTooLarge) {
      return formatTooLargeDiffMessage(renderableRowCount, OBJECT_DIFF_BUDGETS.maxRenderableRows);
    }
    if (diffResult?.tooLargeReason === 'input') {
      return formatTooLargeDiffMessage(
        Math.max(diffResult.leftLineCount, diffResult.rightLineCount),
        OBJECT_DIFF_BUDGETS.maxLinesPerSide
      );
    }
    return OBJECT_DIFF_TOO_LARGE_MESSAGE;
  }, [diffResult, renderTooLarge, renderableRowCount]);
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
    if (!leftObjectUid) {
      if (leftSelectedObject !== null) {
        setLeftSelectedObject(null);
      }
      return;
    }
    const refreshed = leftObjectMap.get(leftObjectUid);
    if (refreshed && !sameCatalogItem(refreshed, leftSelectedObject)) {
      setLeftSelectedObject(refreshed);
    }
  }, [leftObjectMap, leftObjectUid, leftSelectedObject]);

  useEffect(() => {
    if (!rightObjectUid) {
      if (rightSelectedObject !== null) {
        setRightSelectedObject(null);
      }
      return;
    }
    const refreshed = rightObjectMap.get(rightObjectUid);
    if (refreshed && !sameCatalogItem(refreshed, rightSelectedObject)) {
      setRightSelectedObject(refreshed);
    }
  }, [rightObjectMap, rightObjectUid, rightSelectedObject]);

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

  useEffect(() => {
    if (!isOpen || !initialRequest) {
      return;
    }
    if (appliedInitialRequestIdRef.current === initialRequest.requestId) {
      return;
    }
    appliedInitialRequestIdRef.current = initialRequest.requestId;
    if (!initialRequest.left) {
      return;
    }
    void applyInitialLeftSelection(initialRequest.left);
  }, [applyInitialLeftSelection, initialRequest, isOpen]);

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
    cancelPendingMatches();
    setLeftClusterId(value);
    setLeftNamespace('');
    setLeftKind('');
    setLeftObjectUid('');
    setLeftObjectSearch('');
    setLeftSelectedObject(null);
  };

  const handleRightClusterChange = (value: string | string[]) => {
    if (typeof value !== 'string') {
      return;
    }
    cancelPendingMatches();
    setRightClusterId(value);
    setRightNamespace('');
    setRightKind('');
    setRightObjectUid('');
    setRightObjectSearch('');
    setRightSelectedObject(null);
  };

  const handleLeftNamespaceChange = (value: string | string[]) => {
    cancelPendingMatches();
    if (typeof value !== 'string' || !value) {
      setLeftNamespace('');
      setLeftKind('');
      setLeftObjectUid('');
      setLeftObjectSearch('');
      setLeftSelectedObject(null);
      return;
    }
    setLeftNamespace(value);
    setLeftKind('');
    setLeftObjectUid('');
    setLeftObjectSearch('');
    setLeftSelectedObject(null);
  };

  const handleRightNamespaceChange = (value: string | string[]) => {
    cancelPendingMatches();
    if (typeof value !== 'string' || !value) {
      setRightNamespace('');
      setRightKind('');
      setRightObjectUid('');
      setRightObjectSearch('');
      setRightSelectedObject(null);
      return;
    }
    setRightNamespace(value);
    setRightKind('');
    setRightObjectUid('');
    setRightObjectSearch('');
    setRightSelectedObject(null);
  };

  const handleLeftKindChange = (value: string | string[]) => {
    cancelPendingMatches();
    if (typeof value !== 'string' || !value) {
      setLeftKind('');
      setLeftObjectUid('');
      setLeftObjectSearch('');
      setLeftSelectedObject(null);
      return;
    }
    setLeftKind(value);
    setLeftObjectUid('');
    setLeftObjectSearch('');
    setLeftSelectedObject(null);
  };

  const handleRightKindChange = (value: string | string[]) => {
    cancelPendingMatches();
    if (typeof value !== 'string' || !value) {
      setRightKind('');
      setRightObjectUid('');
      setRightObjectSearch('');
      setRightSelectedObject(null);
      return;
    }
    setRightKind(value);
    setRightObjectUid('');
    setRightObjectSearch('');
    setRightSelectedObject(null);
  };

  const handleLeftSelectionChange = (value: string | string[]) => {
    cancelPendingMatches();
    if (typeof value !== 'string' || !value) {
      setLeftObjectUid('');
      setLeftSelectedObject(null);
      return;
    }
    setLeftObjectUid(value);
    setLeftSelectedObject(leftObjectMap.get(value) ?? null);
  };

  const handleRightSelectionChange = (value: string | string[]) => {
    cancelPendingMatches();
    if (typeof value !== 'string' || !value) {
      setRightObjectUid('');
      setRightSelectedObject(null);
      return;
    }
    setRightObjectUid(value);
    setRightSelectedObject(rightObjectMap.get(value) ?? null);
  };

  const handleLeftMatch = async () => {
    if (!leftSelection || !leftClusterId || !rightClusterId) {
      return;
    }
    const targetClusterId = rightClusterId;
    const sourceUid = leftSelection.uid;
    const requestId = rightMatchRequestRef.current + 1;
    rightMatchRequestRef.current = requestId;
    setRightMatching(true);
    setRightNoMatch(false);

    try {
      const match = toCatalogItem(
        await FindCatalogObjectMatch(
          targetClusterId,
          leftSelection.namespace ?? '',
          leftSelection.group,
          leftSelection.version,
          leftSelection.kind,
          leftSelection.name
        )
      );
      if (
        rightMatchRequestRef.current !== requestId ||
        rightClusterIdRef.current !== targetClusterId ||
        leftObjectUidRef.current !== sourceUid
      ) {
        return;
      }
      if (!match) {
        showNoMatch('right');
        return;
      }

      setRightNamespace(normalizeMatchNamespace(match.namespace));
      setRightKind(match.kind);
      setRightObjectSearch('');
      setRightSelectedObject(match);
      setRightObjectUid(match.uid);
    } catch {
      if (
        rightMatchRequestRef.current === requestId &&
        rightClusterIdRef.current === targetClusterId &&
        leftObjectUidRef.current === sourceUid
      ) {
        showNoMatch('right');
      }
    } finally {
      if (
        rightMatchRequestRef.current === requestId &&
        rightClusterIdRef.current === targetClusterId &&
        leftObjectUidRef.current === sourceUid
      ) {
        setRightMatching(false);
      }
    }
  };

  const handleRightMatch = async () => {
    if (!rightSelection || !leftClusterId || !rightClusterId) {
      return;
    }
    const targetClusterId = leftClusterId;
    const sourceUid = rightSelection.uid;
    const requestId = leftMatchRequestRef.current + 1;
    leftMatchRequestRef.current = requestId;
    setLeftMatching(true);
    setLeftNoMatch(false);

    try {
      const match = toCatalogItem(
        await FindCatalogObjectMatch(
          targetClusterId,
          rightSelection.namespace ?? '',
          rightSelection.group,
          rightSelection.version,
          rightSelection.kind,
          rightSelection.name
        )
      );
      if (
        leftMatchRequestRef.current !== requestId ||
        leftClusterIdRef.current !== targetClusterId ||
        rightObjectUidRef.current !== sourceUid
      ) {
        return;
      }
      if (!match) {
        showNoMatch('left');
        return;
      }

      setLeftNamespace(normalizeMatchNamespace(match.namespace));
      setLeftKind(match.kind);
      setLeftObjectSearch('');
      setLeftSelectedObject(match);
      setLeftObjectUid(match.uid);
    } catch {
      if (
        leftMatchRequestRef.current === requestId &&
        leftClusterIdRef.current === targetClusterId &&
        rightObjectUidRef.current === sourceUid
      ) {
        showNoMatch('left');
      }
    } finally {
      if (
        leftMatchRequestRef.current === requestId &&
        leftClusterIdRef.current === targetClusterId &&
        rightObjectUidRef.current === sourceUid
      ) {
        setLeftMatching(false);
      }
    }
  };

  // Render a selection label with object name emphasized and metadata muted.
  const renderSelectionLabel = (selection: CatalogItem | null) => {
    const parts = buildSelectionParts(selection, useShortNamesSetting);
    if (!parts.hasSelection) {
      return <span className="object-diff-column-meta">No object selected</span>;
    }
    return (
      <>
        {parts.clusterLabel && (
          <span className="object-diff-column-meta">{parts.clusterLabel}/</span>
        )}
        <span className="object-diff-column-meta">{parts.namespaceLabel}/</span>
        <span className="object-diff-column-name">{parts.objectName}</span>
        <span className="object-diff-column-meta"> ({parts.kindLabel})</span>
      </>
    );
  };

  const renderDiffContent = () => {
    if (!leftSelection || !rightSelection) {
      return (
        <div className="object-diff-empty object-diff-warning">
          Select objects on both sides to compare.
        </div>
      );
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
    if (diffTooLarge || renderTooLarge) {
      return <div className="object-diff-empty object-diff-warning">{diffTooLargeMessage}</div>;
    }
    if (
      showDiffOnly &&
      displayDiffLines.every((line) => line.leftType === 'context' && line.rightType === 'context')
    ) {
      return (
        <div className="object-diff-empty object-diff-success">
          No diffs. Compared objects are identical.
        </div>
      );
    }

    return (
      <DiffViewer
        lines={displayDiffLines}
        leftText={leftYamlNormalized}
        rightText={rightYamlNormalized}
        leftMutedLines={leftMutedLines}
        rightMutedLines={rightMutedLines}
        showDiffOnly={showDiffOnly}
      />
    );
  };

  if (!shouldRender) return null;

  return (
    <ModalSurface
      modalRef={modalRef}
      labelledBy="object-diff-modal-title"
      onClose={onClose}
      overlayClassName="object-diff-modal-overlay"
      containerClassName="object-diff-modal"
      isClosing={isClosing}
      closeOnBackdrop={false}
    >
      <div className="modal-header object-diff-modal-header">
        <h2 id="object-diff-modal-title">Diff Objects</h2>
        <button
          className="modal-close object-diff-modal-close"
          onClick={onClose}
          aria-label="Close object diff"
        >
          <CloseIcon />
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
                  disabled={!leftSelection || !leftClusterId || !rightClusterId || rightMatching}
                >
                  Match
                </button>
                <button
                  type="button"
                  className="button generic object-diff-clear"
                  onClick={() => {
                    cancelPendingMatches();
                    setLeftObjectUid('');
                    setLeftSelectedObject(null);
                  }}
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
                disabled={clusterOptions.length === 0}
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
                searchable
                searchMode="remote"
                searchValue={leftObjectSearch}
                searchPlaceholder="Search objects"
                onSearchChange={setLeftObjectSearch}
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
                  disabled={!rightSelection || !leftClusterId || !rightClusterId || leftMatching}
                >
                  Match
                </button>
                <button
                  type="button"
                  className="button generic object-diff-clear"
                  onClick={() => {
                    cancelPendingMatches();
                    setRightObjectUid('');
                    setRightSelectedObject(null);
                  }}
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
                disabled={clusterOptions.length === 0}
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
                searchable
                searchMode="remote"
                searchValue={rightObjectSearch}
                searchPlaceholder="Search objects"
                onSearchChange={setRightObjectSearch}
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
          </div>
          <div className="object-diff-column-headers">
            <div className="object-diff-column-title">
              <span className="object-diff-column-label">
                {renderSelectionLabel(leftSelection)}
              </span>
              {/* Show per-side update indicators alongside each selection label. */}
              {leftChangedAt && (
                <span
                  className="object-diff-column-update"
                  title={`Left updated ${formatFullDate(leftChangedAt)}`}
                >
                  Updated {formatChangeAge(leftChangedAt)}
                </span>
              )}
            </div>
            <div className="object-diff-column-title">
              <span className="object-diff-column-label">
                {renderSelectionLabel(rightSelection)}
              </span>
              {rightChangedAt && (
                <span
                  className="object-diff-column-update"
                  title={`Right updated ${formatFullDate(rightChangedAt)}`}
                >
                  Updated {formatChangeAge(rightChangedAt)}
                </span>
              )}
            </div>
          </div>
          {renderDiffContent()}
        </div>
      </div>
    </ModalSurface>
  );
};

export default ObjectDiffModal;
