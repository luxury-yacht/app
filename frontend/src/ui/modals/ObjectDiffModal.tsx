/**
 * frontend/src/ui/modals/ObjectDiffModal.tsx
 *
 * Global side-by-side YAML diff modal for comparing Kubernetes objects across
 * clusters, namespaces, kinds, and catalog matches.
 */

import type React from 'react';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import './ObjectDiffModal.css';
import { useRefreshScopedDomain } from '@core/refresh';
import { buildClusterScope } from '@core/refresh/clusterScope';
import type { DomainStatus } from '@core/refresh/store';
import type { CatalogItem, CatalogSnapshotPayload } from '@core/refresh/types';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import {
  CLUSTER_SCOPE,
  INACTIVE_SCOPE,
} from '@modules/object-panel/components/ObjectPanel/constants';
import DiffViewer from '@shared/components/diff/DiffViewer';
import { OBJECT_DIFF_BUDGETS } from '@shared/components/diff/diffBudgets';
import {
  countVisibleDiffRows,
  type DisplayDiffLine,
  getDiffTooLargeMessage,
  mergeDiffLines,
} from '@shared/components/diff/diffUtils';
import { computeBudgetedLineDiff, type LineDiffResult } from '@shared/components/diff/lineDiff';
import type {
  ObjectDiffOpenRequest,
  ObjectDiffSelectionSeed,
} from '@shared/components/diff/objectDiffSelection';
import Dropdown from '@shared/components/dropdowns/Dropdown/Dropdown';
import type { DropdownOption } from '@shared/components/dropdowns/Dropdown/types';
import { ErrorSurface } from '@shared/components/errors/ErrorSurface';
import { DiffIcon } from '@shared/components/icons/SharedIcons';
import ModalHeader from '@shared/components/modals/ModalHeader';
import ModalSurface from '@shared/components/modals/ModalSurface';
import { useModalFocusTrap } from '@shared/components/modals/useModalFocusTrap';
import { useModalPresence } from '@shared/components/modals/useModalPresence';

import {
  readCatalogObjectMatchForRef,
  requestData,
  requestRefreshDomain,
  resetRefreshDomain,
  setRefreshDomainEnabled,
} from '@/core/data-access';
import { useShortNames } from '@/hooks/useShortNames';
import { formatAge, formatFullDate } from '@/utils/ageFormatter';
import { getDisplayKind } from '@/utils/kindAliasMap';
import { useObjectDiffYaml } from './useObjectDiffYaml';

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
  return trimmed || 'cluster';
};

const buildSelectionParts = (
  item: CatalogItem | null,
  shortNamesEnabled: boolean,
  clusterName?: string
) => {
  if (!item) {
    return {
      hasSelection: false,
      clusterLabel: '',
      namespaceLabel: '',
      objectName: '',
      kindLabel: '',
    };
  }
  const namespaceLabel = buildNamespaceLabel(item.ref.namespace);
  const clusterLabel = clusterName?.trim() || item.ref.clusterId.trim();
  const kindLabel = getDisplayKind(item.ref.kind, shortNamesEnabled);
  return {
    hasSelection: true,
    clusterLabel,
    namespaceLabel,
    objectName: item.ref.name,
    kindLabel,
  };
};

const isSnapshotLoading = (status: DomainStatus) =>
  status === 'loading' || status === 'initialising';

// Format a concise, user-friendly age label for change notifications.
const formatChangeAge = (timestamp: number): string => {
  const age = formatAge(timestamp);
  return age === 'now' ? 'just now' : `${age} ago`;
};

const normalizeMatchNamespace = (namespace?: string | null): string => {
  const trimmed = namespace?.trim();
  return trimmed || CLUSTER_SCOPE;
};

const toCatalogItem = (value: unknown): CatalogItem | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const item = value as Partial<CatalogItem>;
  const ref = item.ref;
  if (
    !ref ||
    typeof ref.clusterId !== 'string' ||
    typeof ref.kind !== 'string' ||
    typeof ref.group !== 'string' ||
    typeof ref.version !== 'string' ||
    typeof ref.resource !== 'string' ||
    typeof ref.name !== 'string' ||
    typeof ref.uid !== 'string'
  ) {
    return null;
  }
  return item as CatalogItem;
};

const buildCatalogItemFromSelectionSeed = (
  selection: ObjectDiffSelectionSeed
): CatalogItem | null => {
  if (!selection.uid) {
    return null;
  }

  return {
    ref: {
      clusterId: selection.clusterId,
      group: selection.group,
      version: selection.version,
      kind: selection.kind,
      resource: selection.resource ?? '',
      namespace: selection.namespace,
      name: selection.name,
      uid: selection.uid,
    },
    resourceVersion: '',
    creationTimestamp: '',
    scope: selection.namespace ? 'Namespace' : 'Cluster',
  };
};

const buildObjectOptions = (items: CatalogItem[]): DropdownOption[] =>
  items.flatMap((item) =>
    item.ref.uid
      ? [
          {
            value: item.ref.uid,
            label: item.ref.name,
            metadata: item,
          },
        ]
      : []
  );

const mergeSelectedObject = (
  items: CatalogItem[],
  selection: CatalogItem | null
): CatalogItem[] => {
  if (!selection) {
    return items;
  }
  if (items.some((item) => item.ref.uid === selection.ref.uid)) {
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
    left.ref.uid === right.ref.uid &&
    left.ref.name === right.ref.name &&
    left.ref.namespace === right.ref.namespace &&
    left.ref.kind === right.ref.kind &&
    left.ref.group === right.ref.group &&
    left.ref.version === right.ref.version &&
    left.ref.clusterId === right.ref.clusterId
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
    if (item.ref.namespace) {
      fromItems.add(item.ref.namespace);
    }
  });
  return Array.from(fromItems);
};

const buildKindOptions = (kinds: string[], shortNamesEnabled: boolean): DropdownOption[] => {
  const options = new Map<string, DropdownOption>();
  kinds.forEach((kind) => {
    const value = kind.trim();
    if (!value) {
      return;
    }
    options.set(value.toLowerCase(), { value, label: getDisplayKind(value, shortNamesEnabled) });
  });
  return Array.from(options.values()).sort((a, b) => a.label.localeCompare(b.label));
};

type KubeconfigContextValue = ReturnType<typeof useKubeconfig>;

const buildClusterOptions = (
  selectedKubeconfigs: KubeconfigContextValue['selectedKubeconfigs'],
  getClusterMeta: KubeconfigContextValue['getClusterMeta']
): DropdownOption[] => {
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
};

const resolveSelectedObject = (
  uid: string,
  objectMap: Map<string | undefined, CatalogItem>,
  selectedObject: CatalogItem | null
) => {
  if (!uid) {
    return null;
  }
  if (objectMap.has(uid)) {
    return objectMap.get(uid) ?? null;
  }
  return selectedObject?.ref.uid === uid ? selectedObject : null;
};

const getKindOptions = (
  namespace: string,
  payload: CatalogSnapshotPayload | null,
  shortNamesEnabled: boolean
) => {
  if (!namespace) {
    return [];
  }
  return buildKindOptions(
    (payload?.kinds ?? []).map((kind) => kind.kind),
    shortNamesEnabled
  );
};

const getObjectOptions = (enabled: boolean, items: CatalogItem[]) =>
  enabled ? buildObjectOptions(items) : [];

interface CatalogStageState {
  status: DomainStatus;
  error?: string | null;
}

const buildCatalogSideStatus = (
  baseEnabled: boolean,
  namespaceEnabled: boolean,
  objectEnabled: boolean,
  baseState: CatalogStageState,
  namespaceState: CatalogStageState,
  objectState: CatalogStageState
) => ({
  namespaceLoading: baseEnabled && isSnapshotLoading(baseState.status),
  kindLoading: namespaceEnabled && isSnapshotLoading(namespaceState.status),
  objectLoading: objectEnabled && isSnapshotLoading(objectState.status),
  namespaceError: baseState.error ?? null,
  kindError: namespaceState.error ?? null,
  objectError: objectState.error ?? null,
  catalogError: objectState.error ?? namespaceState.error ?? baseState.error ?? null,
});

const requestCatalogObjectMatch = async (selection: ObjectDiffSelectionSeed) => {
  const result = await requestData({
    resource: 'catalog-object-match',
    reason: 'user',
    read: () =>
      readCatalogObjectMatchForRef({
        clusterId: selection.clusterId,
        namespace: selection.namespace,
        group: selection.group,
        version: selection.version,
        kind: selection.kind,
        name: selection.name,
      }),
  });
  return toCatalogItem(result.status === 'executed' ? result.data : null);
};

interface ObjectMatchRequest {
  requestId: number;
  targetClusterId: string;
  sourceUid?: string;
}

interface ObjectMatchController {
  requestRef: { current: number };
  targetClusterIdRef: { current: string };
  sourceObjectUidRef: { current: string };
  setMatching: (value: boolean) => void;
  setNoMatch: (value: boolean) => void;
  showNoMatch: () => void;
  applyMatch: (match: CatalogItem) => void;
}

const isCurrentObjectMatch = (request: ObjectMatchRequest, controller: ObjectMatchController) =>
  controller.requestRef.current === request.requestId &&
  controller.targetClusterIdRef.current === request.targetClusterId &&
  controller.sourceObjectUidRef.current === request.sourceUid;

const executeObjectMatch = async (
  selection: CatalogItem,
  targetClusterId: string,
  controller: ObjectMatchController
) => {
  const request = {
    requestId: controller.requestRef.current + 1,
    targetClusterId,
    sourceUid: selection.ref.uid,
  };
  controller.requestRef.current = request.requestId;
  controller.setMatching(true);
  controller.setNoMatch(false);

  try {
    const match = await requestCatalogObjectMatch({ ...selection.ref, clusterId: targetClusterId });
    if (!isCurrentObjectMatch(request, controller)) {
      return;
    }
    if (!match) {
      controller.showNoMatch();
      return;
    }
    controller.applyMatch(match);
  } catch {
    if (isCurrentObjectMatch(request, controller)) {
      controller.showNoMatch();
    }
  } finally {
    if (isCurrentObjectMatch(request, controller)) {
      controller.setMatching(false);
    }
  }
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

    setRefreshDomainEnabled({ domain: 'catalog-diff', scope, enabled: true });
    void requestRefreshDomain({
      domain: 'catalog-diff',
      scope,
      reason: 'user',
    });

    return () => {
      // Clean up the previous scope to prevent background refreshes.
      setRefreshDomainEnabled({ domain: 'catalog-diff', scope, enabled: false });
      resetRefreshDomain('catalog-diff', scope);
    };
  }, [enabled, scope]);

  return { scope, state };
};

const getCatalogEnablement = (
  isOpen: boolean,
  clusterId: string,
  namespace: string,
  kind: string
) => {
  const base = isOpen && Boolean(clusterId);
  const namespaceStage = base && Boolean(namespace);
  return {
    base,
    namespace: namespaceStage,
    object: namespaceStage && Boolean(kind),
  };
};

const optionalCatalogFilter = (value: string) => value || undefined;

const selectNamespacePayload = (
  basePayload: CatalogSnapshotPayload | null,
  namespacePayload: CatalogSnapshotPayload | null
) => basePayload ?? namespacePayload ?? null;

const getCatalogItems = (payload: CatalogSnapshotPayload | null) => payload?.items ?? [];

interface ObjectDiffCatalogSideParams {
  isOpen: boolean;
  clusterId: string;
  namespace: string;
  kind: string;
  objectSearch: string;
  selectedObject: CatalogItem | null;
  shortNamesEnabled: boolean;
}

const useObjectDiffCatalogSide = ({
  isOpen,
  clusterId,
  namespace,
  kind,
  objectSearch,
  selectedObject,
  shortNamesEnabled,
}: ObjectDiffCatalogSideParams) => {
  const enabled = getCatalogEnablement(isOpen, clusterId, namespace, kind);
  const baseCatalog = useCatalogDiffSnapshot(
    clusterId,
    undefined,
    undefined,
    undefined,
    enabled.base
  );
  const namespaceCatalog = useCatalogDiffSnapshot(
    clusterId,
    optionalCatalogFilter(namespace),
    undefined,
    undefined,
    enabled.namespace
  );
  const objectCatalog = useCatalogDiffSnapshot(
    clusterId,
    optionalCatalogFilter(namespace),
    optionalCatalogFilter(kind),
    optionalCatalogFilter(objectSearch),
    enabled.object
  );
  const basePayload = baseCatalog.state.data as CatalogSnapshotPayload | null;
  const namespacePayload = namespaceCatalog.state.data as CatalogSnapshotPayload | null;
  const objectPayload = objectCatalog.state.data as CatalogSnapshotPayload | null;
  const visibleItems = useMemo(
    () => mergeSelectedObject(getCatalogItems(objectPayload), selectedObject),
    [objectPayload, selectedObject]
  );
  const namespaceOptions = useMemo(
    () =>
      buildNamespaceOptions(
        resolveNamespaceList(selectNamespacePayload(basePayload, namespacePayload))
      ),
    [basePayload, namespacePayload]
  );
  const kindOptions = useMemo(
    () => getKindOptions(namespace, namespacePayload, shortNamesEnabled),
    [namespace, namespacePayload, shortNamesEnabled]
  );
  const objectOptions = useMemo(
    () => getObjectOptions(enabled.object, visibleItems),
    [enabled.object, visibleItems]
  );
  const objectMap = useMemo(
    () => new Map(visibleItems.map((item) => [item.ref.uid, item])),
    [visibleItems]
  );
  const status = buildCatalogSideStatus(
    enabled.base,
    enabled.namespace,
    enabled.object,
    baseCatalog.state,
    namespaceCatalog.state,
    objectCatalog.state
  );

  return { namespaceOptions, kindOptions, objectOptions, objectMap, status };
};

const resolveInitialCatalogSelection = async (
  selection: ObjectDiffSelectionSeed,
  isCurrent: () => boolean,
  applyMatch: (match: CatalogItem) => void,
  showNoMatch: () => void
) => {
  try {
    const match = await requestCatalogObjectMatch(selection);
    if (!isCurrent()) {
      return;
    }
    if (!match) {
      showNoMatch();
      return;
    }
    applyMatch(match);
  } catch {
    if (isCurrent()) {
      showNoMatch();
    }
  }
};

interface ObjectDiffSelectionLabelProps {
  selection: CatalogItem | null;
  clusterOptions: DropdownOption[];
  shortNamesEnabled: boolean;
}

const ObjectDiffSelectionLabel = ({
  selection,
  clusterOptions,
  shortNamesEnabled,
}: ObjectDiffSelectionLabelProps) => {
  const clusterLabel = selection
    ? clusterOptions.find((option) => option.value === selection.ref.clusterId)?.label
    : undefined;
  const parts = buildSelectionParts(selection, shortNamesEnabled, clusterLabel);
  if (!parts.hasSelection) {
    return <span className="object-diff-column-meta">No object selected</span>;
  }
  return (
    <>
      {parts.clusterLabel ? (
        <span className="object-diff-column-meta">{parts.clusterLabel}/</span>
      ) : null}
      <span className="object-diff-column-meta">{parts.namespaceLabel}/</span>
      <span className="object-diff-column-name">{parts.objectName}</span>
      <span className="object-diff-column-meta"> ({parts.kindLabel})</span>
    </>
  );
};

const ObjectDiffYamlErrors = ({
  leftError,
  rightError,
}: {
  leftError: string | null;
  rightError: string | null;
}) => (
  <div className="object-diff-empty object-diff-error">
    {leftError ? (
      <div>
        Left YAML error: <ErrorSurface kind="reported" message={leftError} />
      </div>
    ) : null}
    {rightError ? (
      <div>
        Right YAML error: <ErrorSurface kind="reported" message={rightError} />
      </div>
    ) : null}
  </div>
);

interface ObjectDiffContentProps {
  leftSelection: CatalogItem | null;
  rightSelection: CatalogItem | null;
  leftInitialLoading: boolean;
  rightInitialLoading: boolean;
  leftError: string | null;
  rightError: string | null;
  leftYaml: string;
  rightYaml: string;
  tooLarge: boolean;
  tooLargeMessage: string;
  lines: DisplayDiffLine[];
  leftMutedLines: Set<number>;
  rightMutedLines: Set<number>;
  showDiffOnly: boolean;
}

const isDiffLoading = (props: ObjectDiffContentProps) =>
  (props.leftInitialLoading && !props.leftYaml) || (props.rightInitialLoading && !props.rightYaml);

const hasVisibleDiff = (lines: DisplayDiffLine[]) =>
  lines.some((line) => line.leftType !== 'context' || line.rightType !== 'context');

const ObjectDiffContent = (props: ObjectDiffContentProps) => {
  if (!props.leftSelection || !props.rightSelection) {
    return (
      <div className="object-diff-empty object-diff-warning">
        Select objects on both sides to compare.
      </div>
    );
  }
  if (isDiffLoading(props)) {
    return <div className="object-diff-empty">Loading YAML...</div>;
  }
  if (props.leftError || props.rightError) {
    return <ObjectDiffYamlErrors leftError={props.leftError} rightError={props.rightError} />;
  }
  if (!props.leftYaml || !props.rightYaml) {
    return <div className="object-diff-empty">YAML is not available for both objects.</div>;
  }
  if (props.tooLarge) {
    return <div className="object-diff-empty object-diff-warning">{props.tooLargeMessage}</div>;
  }
  if (props.showDiffOnly && !hasVisibleDiff(props.lines)) {
    return (
      <div className="object-diff-empty object-diff-success">
        No diffs. Compared objects are identical.
      </div>
    );
  }
  return (
    <DiffViewer
      lines={props.lines}
      leftText={props.leftYaml}
      rightText={props.rightYaml}
      leftMutedLines={props.leftMutedLines}
      rightMutedLines={props.rightMutedLines}
      showDiffOnly={props.showDiffOnly}
    />
  );
};

interface ObjectDiffSelectorProps {
  side: 'Left' | 'Right';
  elementIdPrefix: string;
  selection: CatalogItem | null;
  noMatch: boolean;
  matchDisabled: boolean;
  clusterOptions: DropdownOption[];
  clusterId: string;
  namespaceOptions: DropdownOption[];
  namespace: string;
  namespaceLoading: boolean;
  namespaceError: string | null;
  kindOptions: DropdownOption[];
  kind: string;
  kindLoading: boolean;
  kindError: string | null;
  objectOptions: DropdownOption[];
  objectUid: string;
  objectSearch: string;
  objectLoading: boolean;
  objectError: string | null;
  catalogError: string | null;
  onMatch: () => void;
  onClear: () => void;
  onClusterChange: (value: string | string[]) => void;
  onNamespaceChange: (value: string | string[]) => void;
  onKindChange: (value: string | string[]) => void;
  onSelectionChange: (value: string | string[]) => void;
  onObjectSearchChange: (value: string) => void;
}

const ObjectDiffSelector = (props: ObjectDiffSelectorProps) => {
  const sideId = props.side.toLowerCase();
  const fieldId = (field: string) => `${props.elementIdPrefix}-object-diff-${sideId}-${field}`;
  return (
    <div className="object-diff-selector">
      <div className="object-diff-selector-header">
        <span className="object-diff-selector-title">{props.side}</span>
        <div className="object-diff-selector-actions">
          <button
            type="button"
            className="button generic object-diff-match"
            onClick={props.onMatch}
            disabled={props.matchDisabled}
          >
            Match
          </button>
          <button
            type="button"
            className="button generic object-diff-clear"
            onClick={props.onClear}
            disabled={!props.selection}
          >
            Clear
          </button>
        </div>
      </div>
      {props.noMatch ? <div className="object-diff-match-message">No match found</div> : null}
      <div className="object-diff-field">
        <label className="object-diff-label" htmlFor={fieldId('cluster')}>
          Cluster
        </label>
        <Dropdown
          id={fieldId('cluster')}
          options={props.clusterOptions}
          value={props.clusterId}
          onChange={props.onClusterChange}
          placeholder="Select cluster"
          disabled={props.clusterOptions.length === 0}
          ariaLabel={`${props.side} cluster`}
        />
      </div>
      <div className="object-diff-field">
        <label className="object-diff-label" htmlFor={fieldId('namespace')}>
          Namespace
        </label>
        <Dropdown
          id={fieldId('namespace')}
          options={props.namespaceOptions}
          value={props.namespace}
          onChange={props.onNamespaceChange}
          placeholder="Select namespace"
          loading={props.namespaceLoading}
          disabled={!props.clusterId}
          error={Boolean(props.namespaceError)}
          ariaLabel={`${props.side} namespace`}
        />
      </div>
      <div className="object-diff-field">
        <label className="object-diff-label" htmlFor={fieldId('kind')}>
          Kind
        </label>
        <Dropdown
          id={fieldId('kind')}
          options={props.kindOptions}
          value={props.kind}
          onChange={props.onKindChange}
          placeholder="Select kind"
          loading={props.kindLoading}
          disabled={!props.clusterId || !props.namespace}
          error={Boolean(props.kindError)}
          ariaLabel={`${props.side} kind`}
        />
      </div>
      <div className="object-diff-field">
        <label className="object-diff-label" htmlFor={fieldId('object')}>
          Object
        </label>
        <Dropdown
          id={fieldId('object')}
          options={props.objectOptions}
          value={props.objectUid}
          onChange={props.onSelectionChange}
          searchable
          searchMode="remote"
          searchValue={props.objectSearch}
          searchPlaceholder="Search objects"
          onSearchChange={props.onObjectSearchChange}
          placeholder="Select object"
          loading={props.objectLoading}
          disabled={!props.clusterId || !props.namespace || !props.kind}
          error={Boolean(props.objectError)}
          ariaLabel={`${props.side} object`}
        />
      </div>
      {props.catalogError ? (
        <div className="object-diff-error-message">
          Catalog error: <ErrorSurface kind="reported" message={props.catalogError} />
        </div>
      ) : null}
    </div>
  );
};

const ObjectDiffUpdateLabel = ({
  side,
  changedAt,
}: {
  side: 'Left' | 'Right';
  changedAt: number | null;
}) => {
  if (!changedAt) {
    return null;
  }
  return (
    <span
      className="object-diff-column-update"
      title={`${side} updated ${formatFullDate(changedAt)}`}
    >
      Updated {formatChangeAge(changedAt)}
    </span>
  );
};

interface ObjectDiffViewerPanelProps {
  leftSelection: CatalogItem | null;
  rightSelection: CatalogItem | null;
  clusterOptions: DropdownOption[];
  shortNamesEnabled: boolean;
  leftChangedAt: number | null;
  rightChangedAt: number | null;
  showDiffOnly: boolean;
  onToggleDiffOnly: () => void;
  children: React.ReactNode;
}

const ObjectDiffViewerPanel = (props: ObjectDiffViewerPanelProps) => (
  <div className="object-diff-viewer">
    <div className="object-diff-viewer-header">
      <div className="object-diff-viewer-header-row">
        <div className="object-diff-viewer-title-group">
          <div className="object-diff-viewer-title">Diff Viewer</div>
          <span
            className="object-diff-info-indicator"
            role="img"
            title="Ignored fields: metadata.managedFields. Muted fields: metadata.resourceVersion, metadata.creationTimestamp, metadata.uid."
            aria-label="Diff metadata field info"
          >
            i
          </span>
        </div>
        <button
          type="button"
          className="button generic object-diff-toggle"
          onClick={props.onToggleDiffOnly}
          disabled={!props.leftSelection || !props.rightSelection}
        >
          {props.showDiffOnly ? 'Show All' : 'Show Diffs'}
        </button>
      </div>
    </div>
    <div className="object-diff-column-headers">
      <div className="object-diff-column-title">
        <span className="object-diff-column-label">
          <ObjectDiffSelectionLabel
            selection={props.leftSelection}
            clusterOptions={props.clusterOptions}
            shortNamesEnabled={props.shortNamesEnabled}
          />
        </span>
        <ObjectDiffUpdateLabel side="Left" changedAt={props.leftChangedAt} />
      </div>
      <div className="object-diff-column-title">
        <span className="object-diff-column-label">
          <ObjectDiffSelectionLabel
            selection={props.rightSelection}
            clusterOptions={props.clusterOptions}
            shortNamesEnabled={props.shortNamesEnabled}
          />
        </span>
        <ObjectDiffUpdateLabel side="Right" changedAt={props.rightChangedAt} />
      </div>
    </div>
    {props.children}
  </div>
);

interface CatalogSelectionHandlersOptions {
  objectMap: Map<string | undefined, CatalogItem>;
  cancelPendingMatches: () => void;
  setClusterId: (value: string) => void;
  setNamespace: (value: string) => void;
  setKind: (value: string) => void;
  setObjectUid: (value: string) => void;
  setObjectSearch: (value: string) => void;
  setSelectedObject: (value: CatalogItem | null) => void;
}

const catalogSelectionHandlers = (options: CatalogSelectionHandlersOptions) => {
  const resetObjects = () => {
    options.setObjectUid('');
    options.setObjectSearch('');
    options.setSelectedObject(null);
  };
  return {
    onClusterChange: (value: string | string[]) => {
      if (typeof value !== 'string') {
        return;
      }
      options.cancelPendingMatches();
      options.setClusterId(value);
      options.setNamespace('');
      options.setKind('');
      resetObjects();
    },
    onNamespaceChange: (value: string | string[]) => {
      options.cancelPendingMatches();
      options.setNamespace(typeof value === 'string' ? value : '');
      options.setKind('');
      resetObjects();
    },
    onKindChange: (value: string | string[]) => {
      options.cancelPendingMatches();
      options.setKind(typeof value === 'string' ? value : '');
      resetObjects();
    },
    onSelectionChange: (value: string | string[]) => {
      options.cancelPendingMatches();
      const uid = typeof value === 'string' ? value : '';
      options.setObjectUid(uid);
      options.setSelectedObject(uid ? (options.objectMap.get(uid) ?? null) : null);
    },
  };
};

const isMatchDisabled = (
  selection: CatalogItem | null,
  leftClusterId: string,
  rightClusterId: string,
  targetMatching: boolean
) => !selection || !leftClusterId || !rightClusterId || targetMatching;

const ObjectDiffModal: React.FC<ObjectDiffModalProps> = ({
  isOpen,
  initialRequest = null,
  onClose,
}) => {
  const elementIdPrefix = useId();
  const { selectedKubeconfigs, getClusterMeta } = useKubeconfig();
  const { isClosing, shouldRender } = useModalPresence(isOpen);
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
  const [showDiffOnly, setShowDiffOnly] = useState(false);
  const [leftNoMatch, setLeftNoMatch] = useState(false);
  const [rightNoMatch, setRightNoMatch] = useState(false);
  const [leftMatching, setLeftMatching] = useState(false);
  const [rightMatching, setRightMatching] = useState(false);
  const leftNoMatchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rightNoMatchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leftClusterIdRef = useRef(leftClusterId);
  const rightClusterIdRef = useRef(rightClusterId);
  const leftObjectUidRef = useRef(leftObjectUid);
  const rightObjectUidRef = useRef(rightObjectUid);
  const leftMatchRequestRef = useRef(0);
  const rightMatchRequestRef = useRef(0);
  const appliedInitialRequestIdRef = useRef<number | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const useShortNamesSetting = useShortNames();

  const clusterOptions = useMemo(
    () => buildClusterOptions(selectedKubeconfigs, getClusterMeta),
    [getClusterMeta, selectedKubeconfigs]
  );

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
    disabled: !shouldRender,
    onEscape: () => {
      if (!isOpen) {
        return false;
      }
      onClose();
      return true;
    },
  });

  // Use scoped catalog snapshots so namespace options remain global while kinds/objects cascade.
  const leftCatalog = useObjectDiffCatalogSide({
    isOpen,
    clusterId: leftClusterId,
    namespace: leftNamespace,
    kind: leftKind,
    objectSearch: leftObjectSearch,
    selectedObject: leftSelectedObject,
    shortNamesEnabled: useShortNamesSetting,
  });
  const rightCatalog = useObjectDiffCatalogSide({
    isOpen,
    clusterId: rightClusterId,
    namespace: rightNamespace,
    kind: rightKind,
    objectSearch: rightObjectSearch,
    selectedObject: rightSelectedObject,
    shortNamesEnabled: useShortNamesSetting,
  });
  const leftSelection = resolveSelectedObject(
    leftObjectUid,
    leftCatalog.objectMap,
    leftSelectedObject
  );
  const rightSelection = resolveSelectedObject(
    rightObjectUid,
    rightCatalog.objectMap,
    rightSelectedObject
  );

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

  const invalidatePendingMatches = useCallback(() => {
    leftMatchRequestRef.current += 1;
    rightMatchRequestRef.current += 1;
  }, []);

  const cancelPendingMatches = useCallback(() => {
    invalidatePendingMatches();
    setLeftMatching(false);
    setRightMatching(false);
  }, [invalidatePendingMatches]);

  useEffect(() => {
    if (!isOpen) {
      cancelPendingMatches();
    }
    return invalidatePendingMatches;
  }, [isOpen, cancelPendingMatches, invalidatePendingMatches]);

  const applyInitialLeftSelection = useCallback(
    async (selection: ObjectDiffSelectionSeed) => {
      cancelPendingMatches();
      const requestId = leftMatchRequestRef.current;
      setLeftNoMatch(false);
      const seededSelection = buildCatalogItemFromSelectionSeed(selection);
      setLeftClusterId(selection.clusterId);
      setLeftNamespace(normalizeMatchNamespace(selection.namespace));
      setLeftKind(selection.kind);
      setLeftObjectSearch('');
      setLeftSelectedObject(seededSelection);
      setLeftObjectUid(selection.uid ?? '');

      if (seededSelection) {
        return;
      }
      await resolveInitialCatalogSelection(
        selection,
        () => leftMatchRequestRef.current === requestId,
        (match) => {
          setLeftNamespace(normalizeMatchNamespace(match.ref.namespace));
          setLeftKind(match.ref.kind);
          setLeftSelectedObject(match);
          setLeftObjectUid(match.ref.uid ?? '');
        },
        () => showNoMatch('left')
      );
    },
    [cancelPendingMatches, showNoMatch]
  );

  const leftYaml = useObjectDiffYaml(leftSelection, isOpen);
  const rightYaml = useObjectDiffYaml(rightSelection, isOpen);
  const diffResult = useMemo<LineDiffResult | null>(() => {
    if (!leftYaml.masked || !rightYaml.masked) {
      return null;
    }
    return computeBudgetedLineDiff(leftYaml.masked, rightYaml.masked, OBJECT_DIFF_BUDGETS);
  }, [leftYaml.masked, rightYaml.masked]);

  const displayDiffLines = useMemo(() => mergeDiffLines(diffResult?.lines ?? []), [diffResult]);
  const diffTooLarge = diffResult?.tooLarge ?? false;
  const renderableRowCount = useMemo(
    () => countVisibleDiffRows(displayDiffLines, showDiffOnly),
    [displayDiffLines, showDiffOnly]
  );
  const renderTooLarge = renderableRowCount > OBJECT_DIFF_BUDGETS.maxRenderableRows;
  const diffTooLargeMessage = useMemo(
    () =>
      getDiffTooLargeMessage(
        diffResult,
        renderableRowCount,
        OBJECT_DIFF_BUDGETS,
        OBJECT_DIFF_TOO_LARGE_MESSAGE
      ),
    [diffResult, renderableRowCount]
  );
  useEffect(() => {
    if (!leftObjectUid) {
      if (leftSelectedObject !== null) {
        setLeftSelectedObject(null);
      }
      return;
    }
    const refreshed = leftCatalog.objectMap.get(leftObjectUid);
    if (refreshed && !sameCatalogItem(refreshed, leftSelectedObject)) {
      setLeftSelectedObject(refreshed);
    }
  }, [leftCatalog.objectMap, leftObjectUid, leftSelectedObject]);

  useEffect(() => {
    if (!rightObjectUid) {
      if (rightSelectedObject !== null) {
        setRightSelectedObject(null);
      }
      return;
    }
    const refreshed = rightCatalog.objectMap.get(rightObjectUid);
    if (refreshed && !sameCatalogItem(refreshed, rightSelectedObject)) {
      setRightSelectedObject(refreshed);
    }
  }, [rightCatalog.objectMap, rightObjectUid, rightSelectedObject]);

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

  const leftSelectionHandlers = catalogSelectionHandlers({
    objectMap: leftCatalog.objectMap,
    cancelPendingMatches,
    setClusterId: setLeftClusterId,
    setNamespace: setLeftNamespace,
    setKind: setLeftKind,
    setObjectUid: setLeftObjectUid,
    setObjectSearch: setLeftObjectSearch,
    setSelectedObject: setLeftSelectedObject,
  });

  const rightSelectionHandlers = catalogSelectionHandlers({
    objectMap: rightCatalog.objectMap,
    cancelPendingMatches,
    setClusterId: setRightClusterId,
    setNamespace: setRightNamespace,
    setKind: setRightKind,
    setObjectUid: setRightObjectUid,
    setObjectSearch: setRightObjectSearch,
    setSelectedObject: setRightSelectedObject,
  });

  const handleLeftMatch = async () => {
    if (!leftSelection || !leftClusterId || !rightClusterId) {
      return;
    }
    await executeObjectMatch(leftSelection, rightClusterId, {
      requestRef: rightMatchRequestRef,
      targetClusterIdRef: rightClusterIdRef,
      sourceObjectUidRef: leftObjectUidRef,
      setMatching: setRightMatching,
      setNoMatch: setRightNoMatch,
      showNoMatch: () => showNoMatch('right'),
      applyMatch: (match) => {
        setRightNamespace(normalizeMatchNamespace(match.ref.namespace));
        setRightKind(match.ref.kind);
        setRightObjectSearch('');
        setRightSelectedObject(match);
        setRightObjectUid(match.ref.uid ?? '');
      },
    });
  };

  const handleRightMatch = async () => {
    if (!rightSelection || !leftClusterId || !rightClusterId) {
      return;
    }
    await executeObjectMatch(rightSelection, leftClusterId, {
      requestRef: leftMatchRequestRef,
      targetClusterIdRef: leftClusterIdRef,
      sourceObjectUidRef: rightObjectUidRef,
      setMatching: setLeftMatching,
      setNoMatch: setLeftNoMatch,
      showNoMatch: () => showNoMatch('left'),
      applyMatch: (match) => {
        setLeftNamespace(normalizeMatchNamespace(match.ref.namespace));
        setLeftKind(match.ref.kind);
        setLeftObjectSearch('');
        setLeftSelectedObject(match);
        setLeftObjectUid(match.ref.uid ?? '');
      },
    });
  };

  if (!shouldRender) {
    return null;
  }

  return (
    <ModalSurface
      modalRef={modalRef}
      labelledBy="object-diff-modal-title"
      onClose={onClose}
      overlayClassName="object-diff-modal-overlay"
      containerClassName="object-diff-modal"
      isClosing={isClosing}
    >
      <ModalHeader
        title="Diff Objects"
        titleId="object-diff-modal-title"
        icon={DiffIcon}
        onClose={onClose}
        closeLabel="Close object diff"
        closeClassName="object-diff-modal-close"
      />
      <div className="modal-content object-diff-modal-content">
        <div className="object-diff-selector-grid">
          <ObjectDiffSelector
            side="Left"
            elementIdPrefix={elementIdPrefix}
            selection={leftSelection}
            noMatch={leftNoMatch}
            matchDisabled={isMatchDisabled(
              leftSelection,
              leftClusterId,
              rightClusterId,
              rightMatching
            )}
            clusterOptions={clusterOptions}
            clusterId={leftClusterId}
            namespaceOptions={leftCatalog.namespaceOptions}
            namespace={leftNamespace}
            namespaceLoading={leftCatalog.status.namespaceLoading}
            namespaceError={leftCatalog.status.namespaceError}
            kindOptions={leftCatalog.kindOptions}
            kind={leftKind}
            kindLoading={leftCatalog.status.kindLoading}
            kindError={leftCatalog.status.kindError}
            objectOptions={leftCatalog.objectOptions}
            objectUid={leftObjectUid}
            objectSearch={leftObjectSearch}
            objectLoading={leftCatalog.status.objectLoading}
            objectError={leftCatalog.status.objectError}
            catalogError={leftCatalog.status.catalogError}
            onMatch={handleLeftMatch}
            onClear={() => {
              cancelPendingMatches();
              setLeftObjectUid('');
              setLeftSelectedObject(null);
            }}
            {...leftSelectionHandlers}
            onObjectSearchChange={setLeftObjectSearch}
          />
          <ObjectDiffSelector
            side="Right"
            elementIdPrefix={elementIdPrefix}
            selection={rightSelection}
            noMatch={rightNoMatch}
            matchDisabled={isMatchDisabled(
              rightSelection,
              leftClusterId,
              rightClusterId,
              leftMatching
            )}
            clusterOptions={clusterOptions}
            clusterId={rightClusterId}
            namespaceOptions={rightCatalog.namespaceOptions}
            namespace={rightNamespace}
            namespaceLoading={rightCatalog.status.namespaceLoading}
            namespaceError={rightCatalog.status.namespaceError}
            kindOptions={rightCatalog.kindOptions}
            kind={rightKind}
            kindLoading={rightCatalog.status.kindLoading}
            kindError={rightCatalog.status.kindError}
            objectOptions={rightCatalog.objectOptions}
            objectUid={rightObjectUid}
            objectSearch={rightObjectSearch}
            objectLoading={rightCatalog.status.objectLoading}
            objectError={rightCatalog.status.objectError}
            catalogError={rightCatalog.status.catalogError}
            onMatch={handleRightMatch}
            onClear={() => {
              cancelPendingMatches();
              setRightObjectUid('');
              setRightSelectedObject(null);
            }}
            {...rightSelectionHandlers}
            onObjectSearchChange={setRightObjectSearch}
          />
        </div>
        <ObjectDiffViewerPanel
          leftSelection={leftSelection}
          rightSelection={rightSelection}
          clusterOptions={clusterOptions}
          shortNamesEnabled={useShortNamesSetting}
          leftChangedAt={leftYaml.changedAt}
          rightChangedAt={rightYaml.changedAt}
          showDiffOnly={showDiffOnly}
          onToggleDiffOnly={() => setShowDiffOnly((value) => !value)}
        >
          <ObjectDiffContent
            leftSelection={leftSelection}
            rightSelection={rightSelection}
            leftInitialLoading={leftYaml.initialLoading}
            rightInitialLoading={rightYaml.initialLoading}
            leftError={leftYaml.error}
            rightError={rightYaml.error}
            leftYaml={leftYaml.normalized}
            rightYaml={rightYaml.normalized}
            tooLarge={diffTooLarge || renderTooLarge}
            tooLargeMessage={diffTooLargeMessage}
            lines={displayDiffLines}
            leftMutedLines={leftYaml.mutedLines}
            rightMutedLines={rightYaml.mutedLines}
            showDiffOnly={showDiffOnly}
          />
        </ObjectDiffViewerPanel>
      </div>
    </ModalSurface>
  );
};

export default ObjectDiffModal;
