/**
 * frontend/src/ui/settings/sections/metrics/MetricAssignments.tsx
 *
 * Settings → Metrics cluster assignments: every kubeconfig context with its source choice, plus
 * assignments whose cluster no longer exists.
 */

import type { backend } from '@core/backend-api/models';
import type { MetricCluster } from '@core/settings/metricSourceModel';
import { metricAssignments } from '@core/settings/metricSourceModel';
import Dropdown from '@shared/components/dropdowns/Dropdown/Dropdown';
import { StatusChip } from '@shared/components/StatusChip';
import { useMemo, useState } from 'react';

const USE_DEFAULT = '__default';
const NONE = '__none';

interface MetricAssignmentsProps {
  clusters: MetricCluster[];
  sources: backend.MetricSource[];
  assignments: Record<string, backend.MetricClusterAssignment>;
  onChange: (clusterId: string, assignment: backend.MetricClusterAssignment) => void;
}

const choiceValue = (assignment: backend.MetricClusterAssignment | undefined): string => {
  if (assignment?.kind === 'source' && assignment.sourceId) {
    return assignment.sourceId;
  }
  return assignment?.kind === 'none' ? NONE : USE_DEFAULT;
};

const assignmentFor = (value: string): backend.MetricClusterAssignment => {
  if (value === USE_DEFAULT) {
    return metricAssignments.inheritDefault();
  }
  return value === NONE ? metricAssignments.none() : metricAssignments.source(value);
};

function sourceOptions(cluster: MetricCluster, sources: backend.MetricSource[], current: string) {
  const options = [
    { value: USE_DEFAULT, label: 'Live metrics only' },
    ...sources.map((source) => ({
      value: source.id,
      label: source.name,
      // An in-cluster source lives in one cluster, so it can serve only that cluster.
      disabled: !!source.inCluster && source.inCluster.clusterId !== cluster.id,
    })),
  ];
  // "None" is meaningful only once a default source exists; show it if one is already stored.
  if (current === NONE) {
    options.push({ value: NONE, label: 'None — live metrics only' });
  }
  return options;
}

export function MetricAssignments({
  clusters,
  sources,
  assignments,
  onChange,
}: Readonly<MetricAssignmentsProps>) {
  const [filter, setFilter] = useState('');
  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return needle
      ? clusters.filter((cluster) => cluster.name.toLowerCase().includes(needle))
      : clusters;
  }, [clusters, filter]);

  return (
    <div className="metrics-settings-assignments">
      <input
        type="search"
        className="metrics-settings-input metrics-settings-assignments__filter"
        placeholder="Filter clusters"
        aria-label="Filter clusters"
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
      />
      <div className="metrics-settings-assignments__head" aria-hidden="true">
        <span>Cluster</span>
        <span>Source</span>
      </div>
      {visible.map((cluster) => {
        const current = choiceValue(assignments[cluster.id]);
        return (
          <div
            key={cluster.id}
            className="metrics-settings-assignments__row"
            data-cluster-id={cluster.id}
          >
            <span className="metrics-settings-assignments__cluster" title={cluster.id}>
              {cluster.name}
              {cluster.orphan ? (
                <StatusChip
                  variant="warning"
                  tooltip="No kubeconfig context has this cluster ID — was the file or context renamed?"
                >
                  cluster not found
                </StatusChip>
              ) : null}
            </span>
            {cluster.orphan ? (
              <span className="metrics-settings-assignments__actions">
                <button
                  type="button"
                  className="button generic"
                  aria-label={`Remove assignment for ${cluster.id}`}
                  onClick={() => onChange(cluster.id, metricAssignments.inheritDefault())}
                >
                  Remove
                </button>
              </span>
            ) : (
              <Dropdown
                ariaLabel={`Metrics source for ${cluster.name}`}
                options={sourceOptions(cluster, sources, current)}
                value={current}
                onChange={(value) => {
                  const next = String(value);
                  if (next !== current) {
                    onChange(cluster.id, assignmentFor(next));
                  }
                }}
              />
            )}
          </div>
        );
      })}
      {visible.length === 0 ? (
        <div className="metrics-settings-hint">No clusters match.</div>
      ) : null}
    </div>
  );
}
