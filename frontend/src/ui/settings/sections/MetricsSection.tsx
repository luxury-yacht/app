/**
 * frontend/src/ui/settings/sections/MetricsSection.tsx
 *
 * Settings → Metrics: named sources (list + editor) and each cluster's source choice
 * (docs/plans/metrics-history.md, layout S-B). Rules and persistence are backend-owned.
 */

import type { backend } from '@core/backend-api/models';
import {
  type MetricCluster,
  type MetricSourceState,
  metricClusters,
} from '@core/settings/metricSourceModel';
import {
  deleteMetricSource,
  loadMetricSourceSettings,
  setClusterMetricAssignment,
} from '@core/settings/metricSources';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import { ErrorSurface } from '@shared/components/errors/ErrorSurface';
import { PlusIcon } from '@shared/components/icons/SharedIcons';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { MetricAssignments } from './metrics/MetricAssignments';
import { MetricSourceEditor } from './metrics/MetricSourceEditor';
import './metrics/MetricsSection.css';

type Selection = { kind: 'source'; id: string } | { kind: 'new' };

const EMPTY: MetricSourceState = { sources: [], assignments: {} };

const sourceTarget = (source: backend.MetricSource) =>
  source.inCluster
    ? `${source.inCluster.namespace}/${source.inCluster.service}:${source.inCluster.port}`
    : '';

// Without an explicit choice, show the first source, or a new-source form when there is none.
function selectedSource(selection: Selection | null, sources: backend.MetricSource[]) {
  if (selection?.kind === 'new') {
    return null;
  }
  if (selection?.kind === 'source') {
    return sources.find((source) => source.id === selection.id) ?? null;
  }
  return sources[0] ?? null;
}

function usedByNames(
  sourceId: string,
  state: MetricSourceState,
  clusters: MetricCluster[]
): string[] {
  return Object.entries(state.assignments)
    .filter(([, assignment]) => assignment.kind === 'source' && assignment.sourceId === sourceId)
    .map(([clusterId]) => clusters.find((cluster) => cluster.id === clusterId)?.name ?? clusterId);
}

function SourceList({
  sources,
  loaded,
  selectedId,
  onSelect,
}: Readonly<{
  sources: backend.MetricSource[];
  loaded: boolean;
  selectedId: string | undefined;
  onSelect: (selection: Selection) => void;
}>) {
  return (
    <div className="metrics-settings-sources__list" role="listbox" aria-label="Metrics sources">
      {sources.map((source) => (
        <button
          key={source.id}
          type="button"
          role="option"
          aria-selected={source.id === selectedId}
          className={`metrics-settings-sources__item${source.id === selectedId ? ' metrics-settings-sources__item--active' : ''}`}
          onClick={() => onSelect({ kind: 'source', id: source.id })}
        >
          <span className="metrics-settings-sources__name">{source.name}</span>
          <span className="metrics-settings-sources__target">{sourceTarget(source)}</span>
        </button>
      ))}
      {sources.length === 0 && loaded ? (
        <span className="metrics-settings-hint">No sources yet.</span>
      ) : null}
      <button
        type="button"
        className="button generic settings-add-button"
        onClick={() => onSelect({ kind: 'new' })}
      >
        <PlusIcon width={12} height={12} /> Add source
      </button>
    </div>
  );
}

function MetricsSection() {
  const { kubeconfigs, managedClusterIds } = useKubeconfig();
  const [settings, setSettings] = useState<MetricSourceState | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [mutationError, setMutationError] = useState<{ error: unknown; action: string } | null>(
    null
  );
  const [selection, setSelection] = useState<Selection | null>(null);

  const reload = useCallback(async () => {
    try {
      setSettings(await loadMetricSourceSettings());
      setLoadError(null);
    } catch (error) {
      setLoadError(error);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const current = settings ?? EMPTY;
  const clusters = useMemo(
    () => metricClusters(kubeconfigs, current.assignments),
    [kubeconfigs, current.assignments]
  );
  const selected = selectedSource(selection, current.sources);

  const runMutation = async (action: string, mutation: () => Promise<void>) => {
    setMutationError(null);
    try {
      await mutation();
    } catch (error) {
      setMutationError({ error, action });
    }
    await reload();
  };

  return (
    <div className="settings-panel">
      <h2 className="settings-panel-title">Metrics</h2>
      <div className="settings-subgroup-label">Sources</div>
      <hr className="settings-subgroup-divider" />
      <div className="settings-subgroup-description">
        Where the Metrics tab reads history. An in-cluster source queries a Prometheus Service
        through the Kubernetes API. Define a source once, then choose it for clusters below.
      </div>
      {loadError ? (
        <ErrorSurface kind="operational" error={loadError} context={{ source: 'MetricsSection' }} />
      ) : null}
      <div className="metrics-settings-sources">
        <SourceList
          sources={current.sources}
          loaded={settings !== null}
          selectedId={selected?.id}
          onSelect={setSelection}
        />
        <div className="metrics-settings-sources__detail">
          {settings ? (
            <MetricSourceEditor
              key={selected?.id ?? 'new'}
              source={selected}
              clusters={clusters}
              connectedClusterIds={managedClusterIds}
              usedBy={selected ? usedByNames(selected.id, current, clusters) : []}
              otherSourceNames={current.sources
                .filter((source) => source.id !== selected?.id)
                .map((source) => source.name)}
              onSaved={(saved) => {
                setSelection({ kind: 'source', id: saved.id });
                void reload();
              }}
              onDelete={(source) =>
                runMutation('deleteMetricSource', async () => {
                  await deleteMetricSource(source.id);
                  setSelection(null);
                })
              }
            />
          ) : null}
        </div>
      </div>
      <div className="settings-subgroup-label">Cluster assignments</div>
      <hr className="settings-subgroup-divider" />
      <div className="settings-subgroup-description">
        Which source each cluster&apos;s Metrics tab uses. Clusters without a source show live
        metrics-server data.
      </div>
      {mutationError ? (
        <div className="metrics-settings-error" role="alert">
          <ErrorSurface
            kind="operational"
            error={mutationError.error}
            context={{ action: mutationError.action, source: 'MetricsSection' }}
          />
        </div>
      ) : null}
      <MetricAssignments
        clusters={clusters}
        sources={current.sources}
        assignments={current.assignments}
        onChange={(clusterId, assignment) =>
          void runMutation('setClusterMetricAssignment', () =>
            setClusterMetricAssignment(clusterId, assignment)
          )
        }
      />
    </div>
  );
}

export default MetricsSection;
