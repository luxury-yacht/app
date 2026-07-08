/**
 * frontend/src/ui/settings/sections/KubeconfigsSection.tsx
 *
 * Kubeconfigs tab content: directories scanned for kubeconfig files.
 */

import { useState, useEffect } from 'react';
import { OpenKubeconfigSearchPathDialog, SetKubeconfigSearchPaths } from '@wailsjs/go/backend/App';
import { errorHandler } from '@utils/errorHandler';
import { readKubeconfigSearchPaths, requestAppState } from '@/core/app-state-access';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import { CloseIcon, PlusIcon } from '@shared/components/icons/SharedIcons';
import { KubeconfigFolderIcon } from '@shared/components/icons/SettingsIcons';

function KubeconfigsSection() {
  const { loadKubeconfigs } = useKubeconfig();
  const [kubeconfigPaths, setKubeconfigPaths] = useState<string[]>([]);
  const [kubeconfigPathsLoading, setKubeconfigPathsLoading] = useState(false);
  const [kubeconfigPathsSaving, setKubeconfigPathsSaving] = useState(false);
  const [kubeconfigPathsSelecting, setKubeconfigPathsSelecting] = useState(false);

  useEffect(() => {
    loadKubeconfigPaths();
  }, []);

  const loadKubeconfigPaths = async () => {
    setKubeconfigPathsLoading(true);
    try {
      const paths = await requestAppState({
        resource: 'kubeconfig-search-paths',
        read: () => readKubeconfigSearchPaths(),
      });
      setKubeconfigPaths(paths || []);
    } catch (error) {
      errorHandler.handle(error, { action: 'loadKubeconfigPaths' });
    } finally {
      setKubeconfigPathsLoading(false);
    }
  };

  const persistKubeconfigPaths = async (nextPaths: string[], action: string) => {
    setKubeconfigPaths(nextPaths);
    setKubeconfigPathsSaving(true);
    try {
      await SetKubeconfigSearchPaths(nextPaths);
      await loadKubeconfigPaths();
      await loadKubeconfigs();
    } catch (error) {
      errorHandler.handle(error, { action });
      await loadKubeconfigPaths();
    } finally {
      setKubeconfigPathsSaving(false);
    }
  };

  const handleAddKubeconfigPath = async () => {
    setKubeconfigPathsSelecting(true);
    try {
      const selected = await OpenKubeconfigSearchPathDialog();
      const trimmed = selected?.trim();
      if (!trimmed) return;
      if (kubeconfigPaths.some((path) => path.trim() === trimmed)) return;
      await persistKubeconfigPaths([...kubeconfigPaths, trimmed], 'addKubeconfigPath');
    } catch (error) {
      errorHandler.handle(error, { action: 'addKubeconfigPath' });
    } finally {
      setKubeconfigPathsSelecting(false);
    }
  };

  const handleRemoveKubeconfigPath = async (index: number) => {
    if (kubeconfigPaths.length <= 1) return;
    const nextPaths = kubeconfigPaths.filter((_, currentIndex) => currentIndex !== index);
    await persistKubeconfigPaths(nextPaths, 'removeKubeconfigPath');
  };

  return (
    <div className="settings-panel">
      <h2 className="settings-panel-title">Kubeconfigs</h2>

      <div className="settings-subgroup-label">Search paths</div>
      <hr className="settings-subgroup-divider" />

      <div className="settings-row">
        <div className="settings-row-label">
          <div className="settings-row-label-title">Directories</div>
          <div className="settings-row-label-help">
            The list of directories that the app will scan for kubeconfig files. If you store
            kubeconfigs in a custom location, add it here.
          </div>
        </div>
        <div className="settings-row-control">
          <div className="settings-items kubeconfig-path-list">
            {kubeconfigPathsLoading ? (
              <div className="setting-item kubeconfig-path-status">Loading kubeconfig paths...</div>
            ) : (
              <>
                {kubeconfigPaths.length === 0 && (
                  <div className="setting-item kubeconfig-path-empty">No kubeconfig paths set.</div>
                )}
                {kubeconfigPaths.map((path, index) => {
                  const canRemove = kubeconfigPaths.length > 1;
                  return (
                    <div
                      className="setting-item setting-item-surface kubeconfig-path-row"
                      key={`kubeconfig-path-${index}`}
                    >
                      <span className="kubeconfig-path-icon" aria-hidden="true">
                        <KubeconfigFolderIcon width={16} height={16} />
                      </span>
                      <span className="kubeconfig-path-value">{path}</span>
                      {canRemove && (
                        <button
                          type="button"
                          className="kubeconfig-path-remove-button"
                          onClick={() => handleRemoveKubeconfigPath(index)}
                          disabled={kubeconfigPathsSaving}
                          aria-label={`Remove kubeconfig path ${index + 1}`}
                          title="Remove path"
                        >
                          <CloseIcon width={14} height={14} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </>
            )}
            <button
              type="button"
              className="button generic settings-add-button kubeconfig-path-add"
              onClick={handleAddKubeconfigPath}
              disabled={kubeconfigPathsSaving || kubeconfigPathsLoading || kubeconfigPathsSelecting}
            >
              <PlusIcon width={12} height={12} ariaHidden />
              Add path
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default KubeconfigsSection;
