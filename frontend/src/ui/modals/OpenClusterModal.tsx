/**
 * frontend/src/ui/modals/OpenClusterModal.tsx
 *
 * Modal for opening cluster tabs from the "+" in the cluster tab bar (also ⌘O /
 * File → Open Cluster). Shows a directory → file → context tree of the kubeconfig
 * search paths; clicking a context opens (or switches to) that cluster tab.
 * Manages the search-path directories (Add Directory / remove), replacing the
 * Settings → Kubeconfigs section (see docs/plans/cluster-tabs.md).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useModalFocusTrap } from '@shared/components/modals/useModalFocusTrap';
import ModalSurface from '@shared/components/modals/ModalSurface';
import ModalHeader from '@shared/components/modals/ModalHeader';
import {
  ClusterResourcesIcon,
  CloseIcon,
  PlusIcon,
  WarningIcon,
} from '@shared/components/icons/SharedIcons';
import { ChevronDownIcon } from '@shared/components/icons/FavoriteIcons';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import { OpenKubeconfigSearchPathDialog, SetKubeconfigSearchPaths } from '@wailsjs/go/backend/App';
import { readKubeconfigSearchPaths, requestAppState } from '@/core/app-state-access';
import { errorHandler } from '@utils/errorHandler';
import './OpenClusterModal.css';

const COLLAPSE_KEY = 'openCluster.collapsed';

interface ContextNode {
  selection: string; // "path:context"
  context: string;
  invalid: boolean;
  invalidReason: string;
  isOpen: boolean;
}
interface FileNode {
  path: string;
  name: string;
  contexts: ContextNode[];
}
interface DirNode {
  dir: string;
  files: FileNode[];
}

const loadCollapsed = (): Set<string> => {
  try {
    const raw = window.localStorage.getItem(COLLAPSE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? new Set(parsed as string[]) : new Set();
  } catch {
    return new Set();
  }
};

interface OpenClusterModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const OpenClusterModalContent: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const modalRef = useRef<HTMLDivElement>(null);
  const { kubeconfigs, selectedKubeconfigs, openKubeconfig, setActiveKubeconfig, loadKubeconfigs } =
    useKubeconfig();
  const [searchPaths, setSearchPaths] = useState<string[]>([]);

  useModalFocusTrap({
    ref: modalRef,
    onEscape: () => {
      onClose();
      return true;
    },
  });

  const refreshSearchPaths = useCallback(async () => {
    try {
      const paths = await requestAppState({
        resource: 'kubeconfig-search-paths',
        read: () => readKubeconfigSearchPaths(),
      });
      setSearchPaths(paths || []);
    } catch (error) {
      errorHandler.handle(error, { action: 'openClusterLoadSearchPaths' });
    }
  }, []);

  // Refresh discovery + search paths each time the modal opens.
  useEffect(() => {
    void refreshSearchPaths();
    void loadKubeconfigs();
  }, [refreshSearchPaths, loadKubeconfigs]);

  const persistSearchPaths = useCallback(
    async (next: string[]) => {
      try {
        await SetKubeconfigSearchPaths(next);
        await refreshSearchPaths();
        await loadKubeconfigs();
      } catch (error) {
        errorHandler.handle(error, { action: 'openClusterSetSearchPaths' });
        await refreshSearchPaths();
      }
    },
    [refreshSearchPaths, loadKubeconfigs]
  );

  const handleAddDirectory = useCallback(async () => {
    try {
      const picked = (await OpenKubeconfigSearchPathDialog())?.trim();
      if (!picked) {
        return;
      }
      if (searchPaths.some((path) => path.trim() === picked)) {
        return;
      }
      await persistSearchPaths([...searchPaths, picked]);
    } catch (error) {
      errorHandler.handle(error, { action: 'openClusterAddDirectory' });
    }
  }, [searchPaths, persistSearchPaths]);

  const handleRemoveDirectory = useCallback(
    (path: string) => {
      void persistSearchPaths(searchPaths.filter((entry) => entry !== path));
    },
    [searchPaths, persistSearchPaths]
  );

  const [collapsed, setCollapsed] = useState<Set<string>>(loadCollapsed);
  const toggleCollapsed = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      try {
        window.localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...next]));
      } catch {
        // Non-fatal: collapse state simply won't persist.
      }
      return next;
    });
  }, []);

  const tree = useMemo<DirNode[]>(() => {
    const bySource = new Map<string, Map<string, FileNode>>();
    for (const config of kubeconfigs) {
      const source = config.sourcePath;
      const selection = `${config.path}:${config.context}`;
      let files = bySource.get(source);
      if (!files) {
        files = new Map();
        bySource.set(source, files);
      }
      let file = files.get(config.path);
      if (!file) {
        file = { path: config.path, name: config.name, contexts: [] };
        files.set(config.path, file);
      }
      file.contexts.push({
        selection,
        context: config.context,
        invalid: config.invalid,
        invalidReason: config.invalidReason,
        isOpen: selectedKubeconfigs.includes(selection),
      });
    }
    // Top level = configured search paths (so empty ones still show + are
    // removable) unioned with any source paths present in discovery.
    const dirs = new Set<string>([...searchPaths, ...bySource.keys()]);
    return [...dirs]
      .sort((a, b) => a.localeCompare(b))
      .map((dir) => ({
        dir,
        files: [...(bySource.get(dir)?.values() ?? [])]
          .map((file) => ({
            ...file,
            contexts: [...file.contexts].sort((a, b) => a.context.localeCompare(b.context)),
          }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      }));
  }, [kubeconfigs, selectedKubeconfigs, searchPaths]);

  const handleContextClick = useCallback(
    (node: ContextNode) => {
      if (node.invalid) {
        return;
      }
      if (node.isOpen) {
        setActiveKubeconfig(node.selection);
      } else {
        void openKubeconfig(node.selection);
      }
    },
    [openKubeconfig, setActiveKubeconfig]
  );

  return (
    <ModalSurface
      modalRef={modalRef}
      labelledBy="open-cluster-modal-title"
      onClose={onClose}
      containerClassName="open-cluster-modal"
      closeOnBackdrop
    >
      <ModalHeader
        title="Open Cluster"
        titleId="open-cluster-modal-title"
        icon={ClusterResourcesIcon}
        onClose={onClose}
      />
      <div className="open-cluster-modal__body open-cluster-tree">
        {tree.length === 0 ? (
          <p className="open-cluster-modal__placeholder">
            No kubeconfig search directories. Add one below.
          </p>
        ) : (
          tree.map((dir) => {
            const dirCollapsed = collapsed.has(dir.dir);
            return (
              <div className="open-cluster-dir" key={dir.dir}>
                <div className="open-cluster-dir__header">
                  <button
                    type="button"
                    className={`open-cluster-dir__toggle${dirCollapsed ? ' collapsed' : ''}`}
                    onClick={() => toggleCollapsed(dir.dir)}
                    aria-expanded={!dirCollapsed}
                  >
                    <ChevronDownIcon width={12} height={12} />
                    <span className="open-cluster-dir__path">{dir.dir}</span>
                  </button>
                  <button
                    type="button"
                    className="open-cluster-dir__remove"
                    onClick={() => handleRemoveDirectory(dir.dir)}
                    aria-label={`Remove ${dir.dir}`}
                    title="Remove directory"
                  >
                    <CloseIcon width={12} height={12} />
                  </button>
                </div>
                {!dirCollapsed &&
                  dir.files.map((file) => {
                    const fileCollapsed = collapsed.has(file.path);
                    return (
                      <div className="open-cluster-file" key={file.path}>
                        <button
                          type="button"
                          className={`open-cluster-file__toggle${fileCollapsed ? ' collapsed' : ''}`}
                          onClick={() => toggleCollapsed(file.path)}
                          aria-expanded={!fileCollapsed}
                        >
                          <ChevronDownIcon width={12} height={12} />
                          <span className="open-cluster-file__name">{file.name}</span>
                        </button>
                        {!fileCollapsed &&
                          file.contexts.map((node) => (
                            <button
                              key={node.selection}
                              type="button"
                              className={[
                                'open-cluster-context',
                                node.isOpen ? 'is-open' : '',
                                node.invalid ? 'is-invalid' : '',
                              ]
                                .filter(Boolean)
                                .join(' ')}
                              disabled={node.invalid}
                              title={node.invalid ? node.invalidReason : undefined}
                              onClick={() => handleContextClick(node)}
                            >
                              {node.invalid && (
                                <WarningIcon
                                  width={12}
                                  height={12}
                                  className="open-cluster-context__warn"
                                />
                              )}
                              <span className="open-cluster-context__name">{node.context}</span>
                              {node.isOpen && (
                                <span className="open-cluster-context__open" aria-label="Open">
                                  ●
                                </span>
                              )}
                            </button>
                          ))}
                      </div>
                    );
                  })}
              </div>
            );
          })
        )}
      </div>
      <div className="open-cluster-modal__footer">
        <button
          type="button"
          className="button generic open-cluster-add"
          onClick={() => void handleAddDirectory()}
        >
          <PlusIcon width={12} height={12} ariaHidden /> Add Directory
        </button>
        <button type="button" className="button cancel" onClick={onClose}>
          Cancel
        </button>
      </div>
    </ModalSurface>
  );
};

const OpenClusterModal: React.FC<OpenClusterModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) {
    return null;
  }
  return <OpenClusterModalContent onClose={onClose} />;
};

export default OpenClusterModal;
