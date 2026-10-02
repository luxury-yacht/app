/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Metrics/MetricsTab.tsx
 *
 * The object panel's Metrics tab for a Pod, Node, Deployment, StatefulSet, or DaemonSet: Resource
 * Utilization bars for the current values, then CPU and memory from the metrics API charted over
 * the time the panel has been visible. Nothing is stored — hiding the panel, switching clusters, or
 * pausing auto-refresh clears the charts, and the next visit starts new ones.
 */

import type { ObjectPanelRef } from '@modules/object-panel/objectPanelRef';
import { ErrorSurface } from '@shared/components/errors/ErrorSurface';
import { StatusChip } from '@shared/components/StatusChip';
import { useMemo } from 'react';
import { useAutoRefreshEnabled } from '@/core/refresh/hooks/useRefreshPreferences';
import type { KubernetesObjectReference } from '@/types/view-state';
import { MetricChart } from './MetricChart';
import {
  formatClockTime,
  formatMetricValue,
  graphStats,
  liveTimeline,
  type MetricGraph,
  type MetricTimeline,
} from './metricsTabModel';
import ResourceUtilization from './ResourceUtilization';
import { useLiveMetricSamples } from './useLiveMetricSamples';
import { useUtilizationData } from './useUtilizationData';
import './MetricsTab.css';

interface MetricsTabProps {
  objectData: ObjectPanelRef | null;
  /** The panel's object details: utilization values until live metrics arrive. */
  detail: unknown;
  /** The panel is visible (any of its tabs); samples are kept only while it is. */
  isPanelOpen: boolean;
  panelId: string;
}

// The tile's ceiling: a node's allocatable, as on the Details tab; otherwise the limit, which
// for a node is only the sum of its pods' limits.
const tileCeiling = (graph: MetricGraph): string => {
  const stats = graphStats(graph);
  if (stats.allocatable !== undefined) {
    return `allocatable ${formatMetricValue(graph.unit, stats.allocatable)}`;
  }
  return `limit ${stats.limit === undefined ? 'none' : formatMetricValue(graph.unit, stats.limit)}`;
};

function MetricTile({ graph }: Readonly<{ graph: MetricGraph }>) {
  const stats = graphStats(graph);
  return (
    <div className="metrics-tile" data-metric-tile={graph.id}>
      <span className="metrics-tile__label">{graph.title}</span>
      <span className="metrics-tile__value">{formatMetricValue(graph.unit, stats.current)}</span>
      <span className="metrics-tile__detail">
        peak {formatMetricValue(graph.unit, stats.peak)} · {tileCeiling(graph)}
      </span>
    </div>
  );
}

function MetricCard({
  graph,
  times,
  syncId,
}: Readonly<{ graph: MetricGraph; times: number[]; syncId: string }>) {
  return (
    <section className="metrics-card" data-metric-card={graph.id} aria-label={graph.title}>
      <h4 className="metrics-card__title">{graph.title}</h4>
      <div className="metrics-card__chart">
        {graph.hasData ? (
          <MetricChart graph={graph} times={times} syncId={syncId} />
        ) : (
          <div className="metrics-card__empty">No data</div>
        )}
      </div>
    </section>
  );
}

function LiveBody({
  timeline,
  error,
  paused,
  syncId,
}: Readonly<{ timeline: MetricTimeline; error: string | null; paused: boolean; syncId: string }>) {
  if (paused) {
    return (
      <div className="metrics-tab__notice" data-live-paused>
        Live metrics stop while auto-refresh is paused.
      </div>
    );
  }
  if (timeline.times.length === 0) {
    return error ? (
      <div className="metrics-tab__notice" data-live-unavailable>
        <span>Live metrics are unavailable:</span>
        <ErrorSurface kind="status" message={error} />
      </div>
    ) : (
      <div className="metrics-tab__notice" data-live-collecting>
        Collecting live metrics…
      </div>
    );
  }
  return (
    <>
      <div className="metrics-tab__tiles">
        {timeline.graphs.map((graph) => (
          <MetricTile key={graph.id} graph={graph} />
        ))}
      </div>
      <div className="metrics-tab__grid">
        {timeline.graphs.map((graph) => (
          <MetricCard key={graph.id} graph={graph} times={timeline.times} syncId={syncId} />
        ))}
      </div>
    </>
  );
}

function LiveMetrics({
  objectRef,
  isPanelOpen,
  panelId,
}: Readonly<{ objectRef: KubernetesObjectReference; isPanelOpen: boolean; panelId: string }>) {
  const autoRefresh = useAutoRefreshEnabled();
  const live = useLiveMetricSamples(objectRef, isPanelOpen && autoRefresh);
  const timeline = useMemo(() => liveTimeline(live.samples), [live.samples]);
  return (
    <>
      <div className="metrics-tab__toolbar" data-live-badge>
        <StatusChip variant="info">
          Live{live.startedAt ? ` · since ${formatClockTime(live.startedAt)}` : ''}
        </StatusChip>
        <span className="metrics-tab__hint">Not kept: cleared when you leave this panel.</span>
      </div>
      <LiveBody timeline={timeline} error={live.error} paused={!autoRefresh} syncId={panelId} />
    </>
  );
}

// Current values, not history: shown whatever the auto-refresh state, and the lease follows the
// panel's visibility.
function Utilization({
  objectData,
  detail,
  isPanelOpen,
}: Readonly<Pick<MetricsTabProps, 'objectData' | 'detail' | 'isPanelOpen'>>) {
  const utilization = useUtilizationData({ objectData, detail, enabled: isPanelOpen });
  if (!utilization) {
    return null;
  }
  return (
    <ResourceUtilization
      cpu={utilization.cpu}
      memory={utilization.memory}
      pods={utilization.pods}
      mode={utilization.mode}
      podCount={utilization.podCount}
      readyPodCount={utilization.readyPodCount}
    />
  );
}

export default function MetricsTab({
  objectData,
  detail,
  isPanelOpen,
  panelId,
}: Readonly<MetricsTabProps>) {
  const clusterId = objectData?.clusterId;
  const group = objectData?.group;
  const version = objectData?.version;
  const kind = objectData?.kind;
  const namespace = objectData?.namespace;
  const name = objectData?.name;
  const present = Boolean(objectData);
  // Rebuilt only when the identity changes, so the metrics lease is not re-acquired every render.
  const objectRef = useMemo(
    () => (present ? { clusterId, group, version, kind, namespace, name } : null),
    [present, clusterId, group, version, kind, namespace, name]
  );
  return (
    <div className="object-panel-tab-content metrics-tab">
      {objectRef ? (
        <>
          <Utilization objectData={objectData} detail={detail} isPanelOpen={isPanelOpen} />
          <LiveMetrics
            // Another object starts a new chart.
            key={[clusterId, group, version, kind, namespace, name].join('|')}
            objectRef={objectRef}
            isPanelOpen={isPanelOpen}
            panelId={panelId}
          />
        </>
      ) : null}
    </div>
  );
}
