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
            Add directories to scan for kubeconfig files.
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
                      className="setting-item kubeconfig-path-row"
                      key={`kubeconfig-path-${index}`}
                    >
                      <span className="kubeconfig-path-icon" aria-hidden="true">
                        <svg viewBox="0 0 16 16" width="14" height="14" fill="none">
                          <path
                            d="M1.75 3.5h4.19c.27 0 .53.1.72.3l1.27 1.27c.19.19.45.3.72.3h5.6c.55 0 1 .45 1 1v6.88c0 .55-.45 1-1 1H1.75c-.55 0-1-.45-1-1V4.5c0-.55.45-1 1-1Z"
                            stroke="currentColor"
                            strokeWidth="1.25"
                          />
                        </svg>
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
                          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                            <path
                              d="M4 4l8 8M12 4l-8 8"
                              stroke="currentColor"
                              strokeWidth="1.5"
                              strokeLinecap="round"
                            />
                          </svg>
                        </button>
                      )}
                    </div>
                  );
                })}
              </>
            )}
            <button
              type="button"
              className="button generic kubeconfig-path-add"
              onClick={handleAddKubeconfigPath}
              disabled={kubeconfigPathsSaving || kubeconfigPathsLoading || kubeconfigPathsSelecting}
            >
              <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
                <path
                  d="M8 3v10M3 8h10"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
              Add path
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default KubeconfigsSection;
