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
import { useShortNames } from '@/hooks/useShortNames';

interface ObjectDiffModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const CATALOG_QUERY_LIMIT = 200;
const CLUSTER_SCOPE_LABEL = 'cluster-scoped';

const buildCatalogScope = (limit: number) => {
  const query = new URLSearchParams();
  query.set('limit', String(limit));
  return query.toString();
};

const buildCatalogDiffScope = (clusterId: string): string | null => {
  const trimmedCluster = clusterId.trim();
  if (!trimmedCluster) {
    return null;
  }

  const query = buildCatalogScope(CATALOG_QUERY_LIMIT);
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

const buildCatalogOptions = (items: CatalogItem[], useShortNames: boolean): DropdownOption[] =>
  items.map((item) => ({
    value: item.uid,
    label: buildCatalogLabel(item, useShortNames),
    metadata: item,
  }));

const matchesNamespaceSelection = (item: CatalogItem, namespace: string): boolean => {
  if (!namespace) {
    return false;
  }

  // Treat the synthetic cluster-scope value as "no namespace" for catalog entries.
  if (namespace === CLUSTER_SCOPE) {
    return !item.namespace;
  }

  return item.namespace?.toLowerCase() === namespace.toLowerCase();
};

const collectKindsForNamespace = (items: CatalogItem[], namespace: string): string[] => {
  const kinds = new Set<string>();
  items.forEach((item) => {
    if (matchesNamespaceSelection(item, namespace)) {
      kinds.add(item.kind);
    }
  });
  return Array.from(kinds);
};

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

const useCatalogDiffSnapshot = (clusterId: string, enabled: boolean) => {
  const scope = useMemo(() => {
    if (!enabled) {
      return null;
    }
    return buildCatalogDiffScope(clusterId);
  }, [clusterId, enabled]);
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
  const { pushContext, popContext } = useKeyboardContext();
  const contextPushedRef = useRef(false);
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

  const leftCatalog = useCatalogDiffSnapshot(leftClusterId, isOpen);
  const rightCatalog = useCatalogDiffSnapshot(rightClusterId, isOpen);

  const leftCatalogPayload = leftCatalog.state.data as CatalogSnapshotPayload | null;
  const rightCatalogPayload = rightCatalog.state.data as CatalogSnapshotPayload | null;
  const leftCatalogItems = leftCatalogPayload?.items ?? [];
  const rightCatalogItems = rightCatalogPayload?.items ?? [];
  const leftNamespaceOptions = useMemo(
    () => buildNamespaceOptions(leftCatalogPayload?.namespaces ?? []),
    [leftCatalogPayload?.namespaces]
  );
  const rightNamespaceOptions = useMemo(
    () => buildNamespaceOptions(rightCatalogPayload?.namespaces ?? []),
    [rightCatalogPayload?.namespaces]
  );
  // Limit kind dropdown choices to the selected namespace so the selectors cascade.
  const leftKindOptions = useMemo(() => {
    if (!leftNamespace) {
      return [];
    }
    const kinds = collectKindsForNamespace(leftCatalogItems, leftNamespace);
    return buildKindOptions(kinds, useShortNamesSetting);
  }, [leftCatalogItems, leftNamespace, useShortNamesSetting]);
  const rightKindOptions = useMemo(() => {
    if (!rightNamespace) {
      return [];
    }
    const kinds = collectKindsForNamespace(rightCatalogItems, rightNamespace);
    return buildKindOptions(kinds, useShortNamesSetting);
  }, [rightCatalogItems, rightNamespace, useShortNamesSetting]);
  const leftObjectOptions = useMemo(() => {
    if (!leftNamespace || !leftKind) {
      return [];
    }
    const filtered = leftCatalogItems.filter(
      (item) =>
        matchesNamespaceSelection(item, leftNamespace) &&
        item.kind.toLowerCase() === leftKind.toLowerCase()
    );
    return buildCatalogOptions(filtered, useShortNamesSetting);
  }, [leftCatalogItems, leftKind, leftNamespace, useShortNamesSetting]);
  const rightObjectOptions = useMemo(() => {
    if (!rightNamespace || !rightKind) {
      return [];
    }
    const filtered = rightCatalogItems.filter(
      (item) =>
        matchesNamespaceSelection(item, rightNamespace) &&
        item.kind.toLowerCase() === rightKind.toLowerCase()
    );
    return buildCatalogOptions(filtered, useShortNamesSetting);
  }, [rightCatalogItems, rightKind, rightNamespace, useShortNamesSetting]);
  const leftObjectMap = useMemo(
    () => new Map(leftCatalogItems.map((item) => [item.uid, item])),
    [leftCatalogItems]
  );
  const rightObjectMap = useMemo(
    () => new Map(rightCatalogItems.map((item) => [item.uid, item])),
    [rightCatalogItems]
  );
  const leftSelection = leftObjectUid ? leftObjectMap.get(leftObjectUid) ?? null : null;
  const rightSelection = rightObjectUid ? rightObjectMap.get(rightObjectUid) ?? null : null;

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
  const leftYamlLoading = isSnapshotLoading(leftYaml.state.status);
  const rightYamlLoading = isSnapshotLoading(rightYaml.state.status);
  const leftYamlError = leftYaml.state.error ?? null;
  const rightYamlError = rightYaml.state.error ?? null;

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
    if (leftYamlLoading || rightYamlLoading) {
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
                  loading={isSnapshotLoading(leftCatalog.state.status)}
                  disabled={!leftClusterId}
                  error={Boolean(leftCatalog.state.error)}
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
                  loading={isSnapshotLoading(leftCatalog.state.status)}
                  disabled={!leftClusterId || !leftNamespace}
                  error={Boolean(leftCatalog.state.error)}
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
                  loading={isSnapshotLoading(leftCatalog.state.status)}
                  disabled={!leftClusterId || !leftNamespace || !leftKind}
                  error={Boolean(leftCatalog.state.error)}
                  ariaLabel="Left object"
                />
              </div>
              {leftCatalog.state.error && (
                <div className="object-diff-error-message">Catalog error: {leftCatalog.state.error}</div>
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
                  loading={isSnapshotLoading(rightCatalog.state.status)}
                  disabled={!rightClusterId}
                  error={Boolean(rightCatalog.state.error)}
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
                  loading={isSnapshotLoading(rightCatalog.state.status)}
                  disabled={!rightClusterId || !rightNamespace}
                  error={Boolean(rightCatalog.state.error)}
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
                  loading={isSnapshotLoading(rightCatalog.state.status)}
                  disabled={!rightClusterId || !rightNamespace || !rightKind}
                  error={Boolean(rightCatalog.state.error)}
                  ariaLabel="Right object"
                />
              </div>
              {rightCatalog.state.error && (
                <div className="object-diff-error-message">
                  Catalog error: {rightCatalog.state.error}
                </div>
              )}
            </div>
          </div>

          <div className="object-diff-viewer">
            <div className="object-diff-viewer-header">
              <div className="object-diff-viewer-title">YAML Diff</div>
              <div className="object-diff-viewer-subtitle">
                Fields removed: metadata.managedFields, metadata.resourceVersion
              </div>
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
