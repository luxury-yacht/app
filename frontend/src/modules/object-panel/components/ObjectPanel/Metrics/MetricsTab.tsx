/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Metrics/MetricsTab.tsx
 *
 * The object panel's Metrics tab (docs/plans/metrics-history.md, layout B): CPU and memory
 * tiles over a grid of chart cards, from the cluster's metrics source. Without a source, or while
 * the source fails (reported and retried on the re-query cadence), it charts live metrics that
 * are kept only while the panel stays visible.
 */

import { backend, metrichistory } from '@core/backend-api/models';
import { useOptionalViewState } from '@core/contexts/ViewStateContext';
import { getObjectMetricsRefresherName } from '@modules/object-panel/components/ObjectPanel/constants';
import type { PanelObjectData } from '@modules/object-panel/components/ObjectPanel/types';
import { ErrorSurface } from '@shared/components/errors/ErrorSurface';
import LoadingSpinner from '@shared/components/LoadingSpinner';
import SegmentedButton from '@shared/components/SegmentedButton';
import { StatusChip } from '@shared/components/StatusChip';
import { setLastSettingsTab } from '@ui/settings/settingsTabPreference';
import { useMemo, useState } from 'react';
import type { ObjectReadTarget } from '@/core/data-access';
import { useAutoRefreshEnabled } from '@/core/refresh/hooks/useRefreshPreferences';
import { MetricChart } from './MetricChart';
import { metricHistoryTarget } from './metricHistoryApi';
import {
  DEFAULT_RANGE_PRESET,
  formatClockTime,
  formatMetricValue,
  graphStats,
  gridTimes,
  liveTimeline,
  METRIC_RANGE_PRESETS,
  type MetricRangePresetId,
  type MetricTimeline,
  presetSpanMs,
} from './metricHistoryModel';
import { type LiveMetricSamples, useLiveMetricSamples } from './useLiveMetricSamples';
import { useMetricHistory } from './useMetricHistory';
import './MetricsTab.css';

interface MetricsTabProps {
  objectData: PanelObjectData | null;
  /** The tab is visible in an open panel; history is read and re-queried only then. */
  isActive: boolean;
  /** The panel is visible (any of its tabs); live samples are kept only while it is. */
  isPanelOpen: boolean;
  panelId: string;
}

const GRAPH_TITLES: Partial<Record<metrichistory.GraphID, string>> = {
  [metrichistory.GraphID.GraphCPU]: 'CPU',
  [metrichistory.GraphID.GraphMemory]: 'Memory',
};

const graphTitle = (graph: metrichistory.Graph) => GRAPH_TITLES[graph.id] ?? graph.id;

const RANGE_OPTIONS = METRIC_RANGE_PRESETS.map((preset) => ({
  value: preset.id,
  label: preset.id,
}));

function NoSourceNotice() {
  // Detached panel windows have no Settings; only the main window can open it.
  const viewState = useOptionalViewState();
  return (
    <div className="metrics-tab__notice">
      <span>No history source for this cluster.</span>
      {viewState ? (
        <button
          type="button"
          className="button generic"
          onClick={() => {
            setLastSettingsTab('metrics');
            viewState.setIsSettingsOpen(true);
          }}
        >
          Choose one in Settings → Metrics
        </button>
      ) : (
        <span>Choose one in Settings → Metrics in the main window.</span>
      )}
    </div>
  );
}

function SourceErrorState({ response }: Readonly<{ response: backend.MetricHistoryResponse }>) {
  return (
    <div className="metrics-tab__error" role="alert">
      <strong>Couldn&apos;t read {response.source?.name ?? 'the metrics source'}</strong>
      <ErrorSurface kind="status" message={response.error ?? 'The source did not answer.'} />
      <span className="metrics-tab__hint">Showing live metrics. Retrying automatically.</span>
    </div>
  );
}

function MetricTile({ graph }: Readonly<{ graph: metrichistory.Graph }>) {
  const stats = graphStats(graph);
  return (
    <div className="metrics-tile" data-metric-tile={graph.id}>
      <span className="metrics-tile__label">{graphTitle(graph)}</span>
      <span className="metrics-tile__value">{formatMetricValue(graph.unit, stats.current)}</span>
      <span className="metrics-tile__detail">
        peak {formatMetricValue(graph.unit, stats.peak)} · limit{' '}
        {stats.limit === undefined ? 'none' : formatMetricValue(graph.unit, stats.limit)}
      </span>
    </div>
  );
}

const cardPlaceholder = (graph: metrichistory.Graph) =>
  graph.status === metrichistory.GraphStatus.GraphStatusLive
    ? 'Not available from live metrics'
    : 'No data';

function MetricCard({
  graph,
  times,
  syncId,
}: Readonly<{ graph: metrichistory.Graph; times: number[]; syncId: string }>) {
  const hasData = graph.status === metrichistory.GraphStatus.GraphStatusOK;
  return (
    <section className="metrics-card" data-metric-card={graph.id} aria-label={graphTitle(graph)}>
      <h4 className="metrics-card__title">{graphTitle(graph)}</h4>
      <div className="metrics-card__chart">
        {hasData ? (
          <MetricChart graph={graph} times={times} syncId={syncId} />
        ) : (
          <div className="metrics-card__empty">{cardPlaceholder(graph)}</div>
        )}
      </div>
    </section>
  );
}

/** Tiles and chart cards for a timeline, in either mode. */
function TimelineView({
  timeline,
  syncId,
}: Readonly<{ timeline: MetricTimeline; syncId: string }>) {
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

function SourceHistory({
  response,
  preset,
  onPresetChange,
  syncId,
}: Readonly<{
  response: backend.MetricHistoryResponse;
  preset: MetricRangePresetId;
  onPresetChange: (preset: MetricRangePresetId) => void;
  syncId: string;
}>) {
  const timeline = useMemo(
    () => ({ times: gridTimes(response.grid), graphs: response.graphs ?? [] }),
    [response]
  );
  return (
    <>
      <div className="metrics-tab__toolbar">
        <SegmentedButton
          size="small"
          ariaLabel="Time range"
          value={preset}
          onChange={onPresetChange}
          options={RANGE_OPTIONS}
        />
        <StatusChip variant="info">Prometheus · {response.source?.name}</StatusChip>
      </div>
      <TimelineView timeline={timeline} syncId={syncId} />
    </>
  );
}

function LiveBody({
  timeline,
  live,
  paused,
  syncId,
}: Readonly<{
  timeline: MetricTimeline;
  live: LiveMetricSamples;
  paused: boolean;
  syncId: string;
}>) {
  if (paused) {
    return (
      <div className="metrics-tab__notice" data-live-paused>
        Live metrics stop while auto-refresh is paused.
      </div>
    );
  }
  if (timeline.times.length > 0) {
    return <TimelineView timeline={timeline} syncId={syncId} />;
  }
  return live.error ? (
    <div className="metrics-tab__notice">
      <span>Live metrics are unavailable:</span>
      <ErrorSurface kind="status" message={live.error} />
    </div>
  ) : (
    <div className="metrics-tab__notice" data-live-collecting>
      Collecting live metrics…
    </div>
  );
}

function LiveHistory({
  response,
  live,
  paused,
  syncId,
}: Readonly<{
  response: backend.MetricHistoryResponse;
  live: LiveMetricSamples;
  paused: boolean;
  syncId: string;
}>) {
  const timeline = useMemo(
    () => liveTimeline(live.samples, response.graphs ?? []),
    [live.samples, response.graphs]
  );
  return (
    <>
      {response.liveReason === backend.MetricHistoryLiveReason.MetricHistoryLiveSourceError ? (
        <SourceErrorState response={response} />
      ) : (
        <NoSourceNotice />
      )}
      <div className="metrics-tab__toolbar" data-live-badge>
        <StatusChip variant="info">
          Live{live.startedAt ? ` · since ${formatClockTime(live.startedAt)}` : ''}
        </StatusChip>
        <span className="metrics-tab__hint">Not kept: cleared when you leave this panel.</span>
      </div>
      <LiveBody timeline={timeline} live={live} paused={paused} syncId={syncId} />
    </>
  );
}

function MetricsTabContent({
  target,
  isActive,
  isPanelOpen,
  panelId,
}: Readonly<{
  target: ObjectReadTarget;
  isActive: boolean;
  isPanelOpen: boolean;
  panelId: string;
}>) {
  const [preset, setPreset] = useState<MetricRangePresetId>(DEFAULT_RANGE_PRESET);
  const refresherName = useMemo(
    () => getObjectMetricsRefresherName(target.kind, panelId),
    [target.kind, panelId]
  );
  const { response, error } = useMetricHistory({
    target,
    spanMs: presetSpanMs(preset),
    isActive,
    refresherName,
  });
  const autoRefresh = useAutoRefreshEnabled();
  const liveMode = response?.mode === backend.MetricHistoryMode.MetricHistoryModeLive;
  // Live samples are collected only while live data is shown in a visible panel, never as a
  // standby buffer behind source history.
  const live = useLiveMetricSamples(target, liveMode && isPanelOpen && autoRefresh);

  if (!response) {
    return error ? (
      <ErrorSurface
        kind="operational"
        error={error}
        context={{ action: 'getObjectMetricHistory', source: 'MetricsTab' }}
      />
    ) : (
      <LoadingSpinner message="Loading metrics..." />
    );
  }
  return liveMode ? (
    <LiveHistory response={response} live={live} paused={!autoRefresh} syncId={panelId} />
  ) : (
    <SourceHistory
      response={response}
      preset={preset}
      onPresetChange={setPreset}
      syncId={panelId}
    />
  );
}

export default function MetricsTab({
  objectData,
  isActive,
  isPanelOpen,
  panelId,
}: Readonly<MetricsTabProps>) {
  const clusterId = objectData?.clusterId;
  const group = objectData?.group;
  const version = objectData?.version;
  const kind = objectData?.kind;
  const namespace = objectData?.namespace;
  const name = objectData?.name;
  // Rebuilt only when the identity changes, so reads are not re-issued on every render.
  const target = useMemo(
    () => metricHistoryTarget({ clusterId, group, version, kind, namespace, name }),
    [clusterId, group, version, kind, namespace, name]
  );
  return (
    <div className="object-panel-tab-content metrics-tab">
      {target ? (
        <MetricsTabContent
          key={`${target.clusterId}|${target.group}/${target.version}|${target.kind}|${target.namespace}/${target.name}`}
          target={target}
          isActive={isActive}
          isPanelOpen={isPanelOpen}
          panelId={panelId}
        />
      ) : null}
    </div>
  );
}
