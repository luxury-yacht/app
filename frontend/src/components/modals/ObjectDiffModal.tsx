/**
 * frontend/src/components/modals/ObjectDiffModal.tsx
 *
 * UI component for ObjectDiffModal.
 * Provides a global, side-by-side YAML diff viewer for Kubernetes objects.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
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
} from '@modules/object-panel/components/ObjectPanel/Yaml/yamlDiff';
import { sanitizeYamlForDiff } from './objectDiffUtils';
import { CLUSTER_SCOPE, INACTIVE_SCOPE } from '@modules/object-panel/components/ObjectPanel/constants';
import { getDisplayKind } from '@/utils/kindAliasMap';
import { formatAge, formatFullDate } from '@/utils/ageFormatter';
import { useShortNames } from '@/hooks/useShortNames';

interface ObjectDiffModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const CATALOG_QUERY_LIMIT = 200;
const CLUSTER_SCOPE_LABEL = 'cluster-scoped';

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

const buildCatalogLabel = (item: CatalogItem, useShortNames: boolean): string => {
  const kindLabel = getDisplayKind(item.kind, useShortNames);
  const namespaceLabel = buildNamespaceLabel(item.namespace);
  return `${kindLabel} ${namespaceLabel}/${item.name}`;
};

const buildSelectionLabel = (item: CatalogItem | null, useShortNames: boolean): string => {
  if (!item) {
    return 'No object selected';
  }
  const namespaceLabel = buildNamespaceLabel(item.namespace);
  const clusterLabel = item.clusterName?.trim() || item.clusterId?.trim() || '';
  const clusterSuffix = clusterLabel ? ` (${clusterLabel})` : '';
  return `${getDisplayKind(item.kind, useShortNames)} ${namespaceLabel}/${item.name}${clusterSuffix}`;
};

const isSnapshotLoading = (status: string) =>
  status === 'loading' || status === 'initialising' || status === 'updating';

// Format a concise, user-friendly age label for change notifications.
const formatChangeAge = (timestamp: number): string => {
  const age = formatAge(timestamp);
  return age === 'now' ? 'just now' : `${age} ago`;
};

const buildCatalogOptions = (items: CatalogItem[], useShortNames: boolean): DropdownOption[] =>
  items.map((item) => ({
    value: item.uid,
    label: buildCatalogLabel(item, useShortNames),
    metadata: item,
  }));

const buildNamespaceOptions = (namespaces: string[]): DropdownOption[] => {
  const options = new Map<string, DropdownOption>();
  options.set(CLUSTER_SCOPE, { value: CLUSTER_SCOPE, label: CLUSTER_SCOPE_LABEL });

  namespaces.forEach((namespace) => {
    const value = namespace.trim();
    if (!value) {
      return;
    }
    options.set(value.toLowerCase(), { value, label: value });
  });

  return Array.from(options.values()).sort((a, b) => a.label.localeCompare(b.label));
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
  const { selectedClusterId, selectedKubeconfigs, getClusterMeta } = useKubeconfig();
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
  const { pushContext, popContext } = useKeyboardContext();
  const contextPushedRef = useRef(false);
  const leftChecksumRef = useRef<string | null>(null);
  const rightChecksumRef = useRef<string | null>(null);
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

  useEffect(() => {
    if (!isOpen || !selectedClusterId) {
      return;
    }
    if (!leftClusterId) {
      setLeftClusterId(selectedClusterId);
    }
    if (!rightClusterId) {
      setRightClusterId(selectedClusterId);
    }
  }, [isOpen, leftClusterId, rightClusterId, selectedClusterId]);

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

  const leftBaseCatalog = useCatalogDiffSnapshot(leftClusterId, undefined, undefined, leftBaseEnabled);
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
    () => buildNamespaceOptions(leftBasePayload?.namespaces ?? leftNamespacePayload?.namespaces ?? []),
    [leftBasePayload?.namespaces, leftNamespacePayload?.namespaces]
  );
  const rightNamespaceOptions = useMemo(
    () => buildNamespaceOptions(rightBasePayload?.namespaces ?? rightNamespacePayload?.namespaces ?? []),
    [rightBasePayload?.namespaces, rightNamespacePayload?.namespaces]
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
    return buildCatalogOptions(leftObjectPayload?.items ?? [], useShortNamesSetting);
  }, [leftObjectEnabled, leftObjectPayload?.items, useShortNamesSetting]);
  const rightObjectOptions = useMemo(() => {
    if (!rightObjectEnabled) {
      return [];
    }
    return buildCatalogOptions(rightObjectPayload?.items ?? [], useShortNamesSetting);
  }, [rightObjectEnabled, rightObjectPayload?.items, useShortNamesSetting]);
  const leftObjectMap = useMemo(
    () => new Map((leftObjectPayload?.items ?? []).map((item) => [item.uid, item])),
    [leftObjectPayload?.items]
  );
  const rightObjectMap = useMemo(
    () => new Map((rightObjectPayload?.items ?? []).map((item) => [item.uid, item])),
    [rightObjectPayload?.items]
  );
  const leftSelection = leftObjectUid ? leftObjectMap.get(leftObjectUid) ?? null : null;
  const rightSelection = rightObjectUid ? rightObjectMap.get(rightObjectUid) ?? null : null;

  const leftNamespaceLoading =
    leftBaseEnabled && isSnapshotLoading(leftBaseCatalog.state.status);
  const rightNamespaceLoading =
    rightBaseEnabled && isSnapshotLoading(rightBaseCatalog.state.status);
  const leftKindLoading =
    leftNamespaceEnabled && isSnapshotLoading(leftNamespaceCatalog.state.status);
  const rightKindLoading =
    rightNamespaceEnabled && isSnapshotLoading(rightNamespaceCatalog.state.status);
  const leftObjectLoading =
    leftObjectEnabled && isSnapshotLoading(leftObjectCatalog.state.status);
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

  const leftYaml = useObjectYamlSnapshot(leftSelection, isOpen);
  const rightYaml = useObjectYamlSnapshot(rightSelection, isOpen);
  const leftYamlPayload = leftYaml.state.data;
  const rightYamlPayload = rightYaml.state.data;
  const leftYamlRaw = leftYamlPayload?.yaml ?? '';
  const rightYamlRaw = rightYamlPayload?.yaml ?? '';
  const leftYamlNormalized = useMemo(
    () => (leftYamlRaw ? sanitizeYamlForDiff(leftYamlRaw) : ''),
    [leftYamlRaw]
  );
  const rightYamlNormalized = useMemo(
    () => (rightYamlRaw ? sanitizeYamlForDiff(rightYamlRaw) : ''),
    [rightYamlRaw]
  );

  const diffResult = useMemo<DiffResult | null>(() => {
    if (!leftYamlNormalized || !rightYamlNormalized) {
      return null;
    }
    return computeLineDiff(leftYamlNormalized, rightYamlNormalized);
  }, [leftYamlNormalized, rightYamlNormalized]);

  const diffLines = diffResult?.lines ?? [];
  const diffTruncated = diffResult?.truncated ?? false;
  const leftYamlError = leftYaml.state.error ?? null;
  const rightYamlError = rightYaml.state.error ?? null;
  const leftYamlInitialLoading =
    leftYaml.state.status === 'loading' || leftYaml.state.status === 'initialising';
  const rightYamlInitialLoading =
    rightYaml.state.status === 'loading' || rightYaml.state.status === 'initialising';
  const isYamlRefreshing =
    leftYaml.state.status === 'updating' || rightYaml.state.status === 'updating';

  // Reset change tracking when the user swaps objects.
  useEffect(() => {
    leftChecksumRef.current = null;
    setLeftChangedAt(null);
  }, [leftObjectUid]);

  useEffect(() => {
    rightChecksumRef.current = null;
    setRightChangedAt(null);
  }, [rightObjectUid]);

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

  const renderDiffRow = (line: DiffLine, index: number) => {
    const leftText = line.type === 'added' ? '' : line.value;
    const rightText = line.type === 'removed' ? '' : line.value;
    const leftNumber =
      line.leftLineNumber !== null && line.leftLineNumber !== undefined ? line.leftLineNumber : '';
    const rightNumber =
      line.rightLineNumber !== null && line.rightLineNumber !== undefined ? line.rightLineNumber : '';
    const leftType = line.type === 'added' ? 'context' : line.type;
    const rightType = line.type === 'removed' ? 'context' : line.type;

    return (
      <div key={`diff-${index}`} className={`object-diff-row object-diff-row-${line.type}`}>
        <div className={`object-diff-cell object-diff-cell-left object-diff-cell-${leftType}`}>
          <span className="object-diff-line-number">{leftNumber}</span>
          <span className="object-diff-line-text">{leftText}</span>
        </div>
        <div className={`object-diff-cell object-diff-cell-right object-diff-cell-${rightType}`}>
          <span className="object-diff-line-number">{rightNumber}</span>
          <span className="object-diff-line-text">{rightText}</span>
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

    return <div className="object-diff-table">{diffLines.map(renderDiffRow)}</div>;
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
            x
          </button>
        </div>
        <div className="modal-content object-diff-modal-content">
          <div className="object-diff-selector-grid">
            <div className="object-diff-selector">
              <div className="object-diff-selector-header">
                <span className="object-diff-selector-title">Left</span>
                <button
                  type="button"
                  className="button generic object-diff-clear"
                  onClick={() => setLeftObjectUid('')}
                  disabled={!leftSelection}
                >
                  Clear
                </button>
              </div>
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
                <button
                  type="button"
                  className="button generic object-diff-clear"
                  onClick={() => setRightObjectUid('')}
                  disabled={!rightSelection}
                >
                  Clear
                </button>
              </div>
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
                <div className="object-diff-error-message">
                  Catalog error: {rightCatalogError}
                </div>
              )}
            </div>
          </div>

          <div className="object-diff-viewer">
            <div className="object-diff-viewer-header">
              <div className="object-diff-viewer-title-row">
                <div className="object-diff-viewer-title">YAML Diff</div>
                <div
                  className={`object-diff-refresh-indicator ${
                    isYamlRefreshing ? 'active' : ''
                  }`}
                  aria-live="polite"
                >
                  Refreshing...
                </div>
              </div>
              <div className="object-diff-viewer-subtitle">
                Fields removed: metadata.managedFields, metadata.resourceVersion
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
