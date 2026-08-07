import captainK8s from '@assets/captain-k8s-color.png';
import logo from '@assets/luxury-yacht-color-vert.png';
import { LiveAgeText } from '@shared/components/LiveAgeText';
import ResourceBar from '@shared/components/ResourceBar';
import {
  USAGE_CRITICAL_THRESHOLD_PERCENT,
  USAGE_HIGH_THRESHOLD_PERCENT,
} from '@shared/components/resourceBarThresholds';
import Tooltip from '@shared/components/Tooltip';
import type { ResourceCalculations } from '@shared/utils/resourceCalculations';
import { formatMemoryValue } from '@shared/utils/resourceCalculations';
import React from 'react';
import type { ClusterOverviewPayload, RecentEventEntry } from '@/core/refresh/types';
import { clusterOverviewCpuValue, clusterOverviewMemoryValue } from '@/core/resource-metrics';
import type { MetricsBannerInfo } from '@/shared/utils/metricsAvailability';
import ClusterOverviewRestrictionNotice, {
  type OverviewRestriction,
} from './ClusterOverviewRestrictionNotice';

const DASH = '—';

export interface OverviewMetricItem {
  key: string;
  label: string;
  value: number;
  variant: string;
}

export type OverviewPodStatusFilter =
  | 'none'
  | 'starting'
  | 'failing'
  | 'terminating'
  | 'restarts'
  | 'not-ready';

export interface OverviewPodStatusItem extends OverviewMetricItem {
  filter: OverviewPodStatusFilter;
  clickable?: boolean;
}

export interface OverviewWorkloadUsageItem extends OverviewMetricItem {
  usage: string;
}

interface OverviewStatusPresentation {
  summary?: string;
  status: string;
}

interface ResourceUtilizationPresentation {
  metricsBanner: MetricsBannerInfo | null;
  metricsDisabled: boolean;
  restrictions: OverviewRestriction[];
  nodesUnavailable: boolean;
  cpuMetrics: ResourceCalculations;
  memoryMetrics: ResourceCalculations;
  cpuUsageSummary: string;
  memoryUsageSummary: string;
  cpuWorkloadUsageItems: OverviewWorkloadUsageItem[];
  memoryWorkloadUsageItems: OverviewWorkloadUsageItem[];
  cpuWorkloadUsageTotal: number;
  memoryWorkloadUsageTotal: number;
  legendExpanded: boolean;
  onToggleLegend: () => void;
}

interface NodePresentation {
  unavailable: boolean;
  restrictions: OverviewRestriction[];
  healthItems: OverviewMetricItem[];
  cordonedItem: OverviewMetricItem;
  healthTotal: number;
  onNavigate: () => void;
}

interface WorkloadPresentation {
  namespacesUnavailable: boolean;
  podsUnavailable: boolean;
  restrictions: OverviewRestriction[];
  workloadItems: OverviewMetricItem[];
  workloadTotal: number;
  podStatusItems: OverviewPodStatusItem[];
  podSignalItems: OverviewPodStatusItem[];
  onPodStatusNavigate: (item: OverviewPodStatusItem) => void;
}

interface RecentEventsPresentation {
  events: RecentEventEntry[];
  canOpen: (event: RecentEventEntry) => boolean;
  onOpen: (event: RecentEventEntry) => void;
}

export interface ClusterOverviewViewProps {
  contextLabel: string;
  overview: ClusterOverviewPayload;
  overviewStatus: OverviewStatusPresentation;
  showSkeleton: boolean;
  errorMessage: string | null;
  resources: ResourceUtilizationPresentation;
  nodes: NodePresentation;
  workloads: WorkloadPresentation;
  recentEvents: RecentEventsPresentation;
}

const percentClassName = (baseClass: string, value: number): string =>
  value > 100 ? `${baseClass} ${baseClass}--warning` : baseClass;

const formatPercent = (value: number): string => `${value.toFixed(1)}%`;

const formatCpuTooltipValue = (millicores: number): string => {
  const cores = millicores / 1000;
  if (cores === 0) {
    return '0';
  }
  return String(Number(cores.toFixed(2)));
};

const formatResourceTooltipValue = (value: number, type: 'cpu' | 'memory'): string =>
  type === 'cpu' ? formatCpuTooltipValue(value) : formatMemoryValue(value);

const ResourceUtilizationTooltip = ({
  type,
  metrics,
  nodesUnavailable,
}: {
  type: 'cpu' | 'memory';
  metrics: ResourceCalculations;
  nodesUnavailable: boolean;
}) => (
  <div
    className="resource-utilization-tooltip"
    data-testid={`resource-utilization-tooltip-${type}`}
  >
    {[
      { label: 'Utilization', value: metrics.usage, percent: metrics.usagePercent },
      { label: 'Requests', value: metrics.request, percent: metrics.requestPercent },
      { label: 'Limits', value: metrics.limit, percent: metrics.limitPercent },
    ].map((row) => (
      <React.Fragment key={row.label}>
        <span className="resource-utilization-tooltip__label">{row.label}</span>
        <span className="resource-utilization-tooltip__value">
          {formatResourceTooltipValue(row.value, type)}
        </span>
        <span className={percentClassName('resource-utilization-tooltip__percent', row.percent)}>
          {nodesUnavailable ? DASH : formatPercent(row.percent)}
        </span>
      </React.Fragment>
    ))}
  </div>
);

const WorkloadUsageBreakdown = ({
  testKey,
  total,
  items,
  showSkeleton,
}: {
  testKey: string;
  total: number;
  items: OverviewWorkloadUsageItem[];
  showSkeleton: boolean;
}) => (
  <div className="resource-group workload-usage-breakdown">
    <div className="stacked-bar stacked-bar--workload-usage" aria-hidden="true">
      {!showSkeleton &&
        items.map((item) => {
          const width = total > 0 ? (item.value / total) * 100 : 0;
          if (width <= 0) {
            return null;
          }
          return (
            <div
              key={item.key}
              className={`stacked-bar__segment stacked-bar__segment--${item.variant}`}
              style={{ width: `${width}%` }}
            />
          );
        })}
    </div>
    <div className="metric-legend">
      <div className="metric-legend__items">
        {items.map((item) => (
          <div
            key={item.key}
            className="metric-legend__item"
            aria-disabled={item.value === 0}
            data-testid={`cluster-workload-usage-${testKey}-${item.key}`}
          >
            <span
              className={`metric-legend__dot metric-legend__dot--${item.variant}`}
              aria-hidden="true"
            />
            <span className="metric-legend__count">{showSkeleton ? DASH : item.usage}</span>
            <span className="metric-legend__label">{item.label}</span>
          </div>
        ))}
      </div>
    </div>
  </div>
);

const ResourceUtilizationGroup = ({
  type,
  overview,
  metrics,
  usageSummary,
  nodesUnavailable,
  showSkeleton,
}: {
  type: 'cpu' | 'memory';
  overview: ClusterOverviewPayload;
  metrics: ResourceCalculations;
  usageSummary: string;
  nodesUnavailable: boolean;
  showSkeleton: boolean;
}) => {
  const resourceValue = type === 'cpu' ? clusterOverviewCpuValue : clusterOverviewMemoryValue;
  const displayedUsageSummary = showSkeleton ? DASH : usageSummary;

  return (
    <div className="resource-group">
      <div className="metric-header metric-header--usage">
        <div className="metric-header__title-group">
          <h3>{type === 'cpu' ? 'CPU' : 'Memory'}</h3>
          <span className="metric-header__usage">{displayedUsageSummary}</span>
        </div>
        <div className={percentClassName('metric-header__percent', metrics.usagePercent)}>
          {showSkeleton || nodesUnavailable ? DASH : formatPercent(metrics.usagePercent)}
        </div>
      </div>
      <Tooltip
        content={
          <ResourceUtilizationTooltip
            type={type}
            metrics={metrics}
            nodesUnavailable={nodesUnavailable}
          />
        }
        placement="top"
        minWidth={220}
        inline={false}
        disabled={showSkeleton}
      >
        <div className="resource-bar-placeholder">
          <ResourceBar
            usage={resourceValue(overview, 'usage')}
            request={resourceValue(overview, 'request')}
            limit={resourceValue(overview, 'limit')}
            allocatable={resourceValue(overview, 'allocatable')}
            type={type}
            variant="default"
          />
        </div>
      </Tooltip>
    </div>
  );
};

const UtilizationLegend = ({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) => (
  <div className="utilization-legend">
    <button
      type="button"
      className="utilization-legend__toggle"
      aria-expanded={expanded}
      onClick={onToggle}
      data-testid="utilization-legend-toggle"
    >
      <span
        className={`utilization-legend__chevron${expanded ? ' utilization-legend__chevron--open' : ''}`}
        aria-hidden="true"
      />{' '}
      Legend
    </button>
    {expanded ? (
      <div className="utilization-legend__items" data-testid="utilization-legend">
        <div className="utilization-legend__item">
          <span className="utilization-legend__swatch utilization-legend__swatch--usage-normal" />
          <span>Usage below {USAGE_HIGH_THRESHOLD_PERCENT}%</span>
        </div>
        <div className="utilization-legend__item">
          <span className="utilization-legend__swatch utilization-legend__swatch--usage-high" />
          <span>
            Usage at {USAGE_HIGH_THRESHOLD_PERCENT}–{USAGE_CRITICAL_THRESHOLD_PERCENT}%
          </span>
        </div>
        <div className="utilization-legend__item">
          <span className="utilization-legend__swatch utilization-legend__swatch--usage-critical" />
          <span>Usage above {USAGE_CRITICAL_THRESHOLD_PERCENT}%</span>
        </div>
        <div className="utilization-legend__footnote">
          Thresholds derived from requests/limits when node capacity is unavailable.
        </div>
        <div className="utilization-legend__item">
          <span className="utilization-legend__swatch utilization-legend__swatch--reserved" />
          <span>Requested but currently unused</span>
        </div>
        <div className="utilization-legend__item">
          <span className="utilization-legend__swatch utilization-legend__swatch--overlimit" />
          <span>Usage above total limits</span>
        </div>
        <div className="utilization-legend__item">
          <span className="utilization-legend__swatch utilization-legend__swatch--request-marker" />
          <span>Total requests marker</span>
        </div>
        <div className="utilization-legend__item">
          <span className="utilization-legend__swatch utilization-legend__swatch--limit-marker" />
          <span>Total limits marker</span>
        </div>
      </div>
    ) : null}
  </div>
);

const ResourceUtilizationCard = ({
  overview,
  showSkeleton,
  errorMessage,
  presentation,
}: {
  overview: ClusterOverviewPayload;
  showSkeleton: boolean;
  errorMessage: string | null;
  presentation: ResourceUtilizationPresentation;
}) => {
  const showMetricsBanner =
    presentation.metricsBanner !== null && !errorMessage && !presentation.metricsDisabled;

  return (
    <div className="overview-section resource-usage">
      <div className="overview-section-header">
        <h2>Resource Utilization</h2>
        {showMetricsBanner ? (
          <div className="metrics-warning-banner" title={presentation.metricsBanner?.tooltip}>
            <span className="metrics-warning-banner__dot" />
            <span className="metrics-warning-banner__text">
              {presentation.metricsBanner?.message}
            </span>
          </div>
        ) : null}
      </div>

      <ClusterOverviewRestrictionNotice restrictions={presentation.restrictions} />

      <ResourceUtilizationGroup
        type="cpu"
        overview={overview}
        metrics={presentation.cpuMetrics}
        usageSummary={presentation.cpuUsageSummary}
        nodesUnavailable={presentation.nodesUnavailable}
        showSkeleton={showSkeleton}
      />
      <WorkloadUsageBreakdown
        testKey="cpu"
        total={presentation.cpuWorkloadUsageTotal}
        items={presentation.cpuWorkloadUsageItems}
        showSkeleton={showSkeleton}
      />

      <div className="resource-utilization-divider" />

      <ResourceUtilizationGroup
        type="memory"
        overview={overview}
        metrics={presentation.memoryMetrics}
        usageSummary={presentation.memoryUsageSummary}
        nodesUnavailable={presentation.nodesUnavailable}
        showSkeleton={showSkeleton}
      />
      <WorkloadUsageBreakdown
        testKey="memory"
        total={presentation.memoryWorkloadUsageTotal}
        items={presentation.memoryWorkloadUsageItems}
        showSkeleton={showSkeleton}
      />

      <UtilizationLegend
        expanded={presentation.legendExpanded}
        onToggle={presentation.onToggleLegend}
      />
    </div>
  );
};

const StackedBar = ({
  items,
  total,
  hidden,
}: {
  items: OverviewMetricItem[];
  total: number;
  hidden: boolean;
}) => (
  <div className="stacked-bar" aria-hidden="true">
    {!hidden &&
      items.map((item) => {
        const width = total > 0 ? (item.value / total) * 100 : 0;
        if (width <= 0) {
          return null;
        }
        return (
          <div
            key={item.key}
            className={`stacked-bar__segment stacked-bar__segment--${item.variant}`}
            style={{ width: `${width}%` }}
          />
        );
      })}
  </div>
);

const NodeHealthLegendItem = ({
  item,
  showSkeleton,
  unavailable,
  onNavigate,
}: {
  item: OverviewMetricItem;
  showSkeleton: boolean;
  unavailable: boolean;
  onNavigate: () => void;
}) => {
  const clickable = item.key !== 'ready' && item.value > 0 && !showSkeleton && !unavailable;
  const content = (
    <>
      <span
        className={`metric-legend__dot metric-legend__dot--${item.variant}`}
        aria-hidden="true"
      />
      <span className="metric-legend__count">
        {showSkeleton || unavailable ? DASH : item.value}
      </span>
      <span className="metric-legend__label">{item.label}</span>
    </>
  );

  return clickable ? (
    <button
      type="button"
      className="metric-legend__item metric-legend__item--clickable cluster-overview__node-link"
      onClick={onNavigate}
      data-testid={`cluster-node-health-${item.key}`}
    >
      {content}
    </button>
  ) : (
    <div
      className="metric-legend__item"
      aria-disabled={item.value === 0}
      data-testid={`cluster-node-health-${item.key}`}
    >
      {content}
    </div>
  );
};

const ProviderNodeStats = ({
  overview,
  unavailable,
  showSkeleton,
}: {
  overview: ClusterOverviewPayload;
  unavailable: boolean;
  showSkeleton: boolean;
}) => {
  const value = (count: number) => (showSkeleton || unavailable ? DASH : count);

  if (overview.clusterType === 'EKS') {
    return (
      <>
        <div className="metric-stat" data-testid="cluster-nodes-ec2">
          <span className="metric-stat__count">{value(overview.ec2Nodes)}</span>
          <span className="metric-stat__label">ec2</span>
        </div>
        <div className="metric-stat" data-testid="cluster-nodes-fargate">
          <span className="metric-stat__count">{value(overview.fargateNodes)}</span>
          <span className="metric-stat__label">fargate</span>
        </div>
      </>
    );
  }
  if (overview.clusterType === 'AKS') {
    return (
      <>
        <div className="metric-stat" data-testid="cluster-nodes-vm">
          <span className="metric-stat__count">{value(overview.vmNodes)}</span>
          <span className="metric-stat__label">vm</span>
        </div>
        <div className="metric-stat" data-testid="cluster-nodes-virtual">
          <span className="metric-stat__count">{value(overview.virtualNodes)}</span>
          <span className="metric-stat__label">virtual</span>
        </div>
      </>
    );
  }
  return null;
};

const NodesSummaryCard = ({
  overview,
  showSkeleton,
  presentation,
}: {
  overview: ClusterOverviewPayload;
  showSkeleton: boolean;
  presentation: NodePresentation;
}) => (
  <div className="overview-section nodes-summary">
    <h2>Nodes</h2>
    <ClusterOverviewRestrictionNotice restrictions={presentation.restrictions} />
    <div className="metric-stats">
      <div className="metric-stat" data-testid="cluster-nodes-total">
        <span className="metric-stat__count">
          {showSkeleton || presentation.unavailable ? DASH : overview.totalNodes}
        </span>
        <span className="metric-stat__label">total</span>
      </div>
      <ProviderNodeStats
        overview={overview}
        unavailable={presentation.unavailable}
        showSkeleton={showSkeleton}
      />
    </div>

    <div className="node-health">
      <div className="metric-header">
        <h3>Node Health</h3>
        <div className="metric-legend__total">
          <span className="metric-legend__total-value">
            {showSkeleton || presentation.unavailable ? DASH : overview.totalNodes}
          </span>
          <span className="metric-legend__total-label"> total</span>
        </div>
      </div>
      <StackedBar
        items={presentation.healthItems}
        total={presentation.healthTotal}
        hidden={showSkeleton}
      />
      <div className="metric-legend">
        <div className="metric-legend__items">
          {presentation.healthItems.map((item) => (
            <NodeHealthLegendItem
              key={item.key}
              item={item}
              showSkeleton={showSkeleton}
              unavailable={presentation.unavailable}
              onNavigate={presentation.onNavigate}
            />
          ))}
        </div>
        <div className="metric-legend__items metric-legend__items--restarted">
          <NodeHealthLegendItem
            item={presentation.cordonedItem}
            showSkeleton={showSkeleton}
            unavailable={presentation.unavailable}
            onNavigate={presentation.onNavigate}
          />
        </div>
      </div>
    </div>
  </div>
);

const WorkloadTypeBreakdown = ({
  items,
  total,
  showSkeleton,
}: {
  items: OverviewMetricItem[];
  total: number;
  showSkeleton: boolean;
}) => (
  <div className="workload-breakdown">
    <div className="metric-header">
      <h3>By Type</h3>
      <div className="metric-legend__total">
        <span className="metric-legend__total-value">{showSkeleton ? DASH : String(total)}</span>
        <span className="metric-legend__total-label"> total</span>
      </div>
    </div>
    <StackedBar items={items} total={total} hidden={showSkeleton} />
    <div className="metric-legend">
      <div className="metric-legend__items">
        {items.map((item) => (
          <div
            key={item.key}
            className="metric-legend__item"
            aria-disabled={item.value === 0}
            data-testid={`cluster-workload-${item.key}`}
          >
            <span
              className={`metric-legend__dot metric-legend__dot--${item.variant}`}
              aria-hidden="true"
            />
            <span className="metric-legend__count">{showSkeleton ? DASH : item.value}</span>
            <span className="metric-legend__label">{item.label}</span>
          </div>
        ))}
      </div>
    </div>
  </div>
);

const PodStatusCard = ({
  item,
  showSkeleton,
  podsUnavailable,
  onNavigate,
}: {
  item: OverviewPodStatusItem;
  showSkeleton: boolean;
  podsUnavailable: boolean;
  onNavigate: (item: OverviewPodStatusItem) => void;
}) => {
  const clickable = item.clickable !== false && item.value > 0;
  const itemClass = `pod-status-card pod-status-card--${item.variant}${clickable ? ' pod-status-card--clickable' : ''}`;
  const content = (
    <>
      <span className="pod-status-card__count">
        {showSkeleton || podsUnavailable ? DASH : item.value}
      </span>
      <span className="pod-status-card__label" title={item.label}>
        {item.label}
      </span>
    </>
  );

  return clickable ? (
    <button
      type="button"
      className={itemClass}
      onClick={() => onNavigate(item)}
      data-testid={`cluster-pod-status-${item.key}`}
    >
      {content}
    </button>
  ) : (
    <div className={itemClass} data-testid={`cluster-pod-status-${item.key}`}>
      {content}
    </div>
  );
};

const PodStatusSection = ({
  overview,
  showSkeleton,
  presentation,
}: {
  overview: ClusterOverviewPayload;
  showSkeleton: boolean;
  presentation: WorkloadPresentation;
}) => (
  <div className="pod-status">
    <div className="pod-status-groups">
      <div className="pod-status-group">
        <div className="metric-header">
          <h3>Pod Status</h3>
          <div className="metric-legend__total">
            <span className="metric-legend__total-value">
              {showSkeleton || presentation.podsUnavailable ? DASH : overview.totalPods}
            </span>
            <span className="metric-legend__total-label"> total</span>
          </div>
        </div>
        <div className="pod-status-cards">
          {presentation.podStatusItems.map((item) => (
            <PodStatusCard
              key={item.key}
              item={item}
              showSkeleton={showSkeleton}
              podsUnavailable={presentation.podsUnavailable}
              onNavigate={presentation.onPodStatusNavigate}
            />
          ))}
        </div>
      </div>
      <div className="pod-status-group">
        <div className="metric-header">
          <h3>Pod Signals</h3>
        </div>
        <div className="pod-status-cards pod-status-cards--signals">
          {presentation.podSignalItems.map((item) => (
            <PodStatusCard
              key={item.key}
              item={item}
              showSkeleton={showSkeleton}
              podsUnavailable={presentation.podsUnavailable}
              onNavigate={presentation.onPodStatusNavigate}
            />
          ))}
        </div>
      </div>
    </div>
  </div>
);

const WorkloadsSummaryCard = ({
  overview,
  showSkeleton,
  presentation,
}: {
  overview: ClusterOverviewPayload;
  showSkeleton: boolean;
  presentation: WorkloadPresentation;
}) => (
  <div className="overview-section workloads-summary">
    <h2>Workloads</h2>
    <ClusterOverviewRestrictionNotice restrictions={presentation.restrictions} />
    <div className="metric-stats">
      <div className="metric-stat" data-testid="cluster-workloads-namespaces">
        <span className="metric-stat__count">
          {showSkeleton || presentation.namespacesUnavailable ? DASH : overview.totalNamespaces}
        </span>
        <span className="metric-stat__label">namespaces</span>
      </div>
      <div className="metric-stat" data-testid="cluster-workloads-pods">
        <span className="metric-stat__count">
          {showSkeleton || presentation.podsUnavailable ? DASH : overview.totalPods}
        </span>
        <span className="metric-stat__label">pods</span>
      </div>
      <div className="metric-stat" data-testid="cluster-workloads-containers">
        <span className="metric-stat__count">
          {showSkeleton || presentation.podsUnavailable ? DASH : overview.totalContainers}
        </span>
        <span className="metric-stat__label">containers</span>
      </div>
    </div>

    <WorkloadTypeBreakdown
      items={presentation.workloadItems}
      total={presentation.workloadTotal}
      showSkeleton={showSkeleton}
    />
    <PodStatusSection overview={overview} showSkeleton={showSkeleton} presentation={presentation} />
  </div>
);

const RecentEventRow = ({
  event,
  clickable,
  onOpen,
}: {
  event: RecentEventEntry;
  clickable: boolean;
  onOpen: () => void;
}) => {
  const rowClass = `recent-events__row${clickable ? ' recent-events__row--clickable' : ''}`;
  const objectNamespaceSuffix = event.objectNamespace ? ` · ${event.objectNamespace}` : '';
  const content = (
    <>
      <LiveAgeText timestamp={event.timestamp} className="recent-events__age" />
      <span className="recent-events__reason">{event.reason}</span>
      <span className="recent-events__message">{event.message}</span>
    </>
  );

  return (
    <li>
      {clickable ? (
        <button
          type="button"
          className={rowClass}
          onClick={onOpen}
          title={`${event.objectKind}/${event.objectName}${objectNamespaceSuffix}`}
        >
          {content}
        </button>
      ) : (
        <div className={rowClass}>{content}</div>
      )}
    </li>
  );
};

const RecentEventsCard = ({
  showSkeleton,
  presentation,
}: {
  showSkeleton: boolean;
  presentation: RecentEventsPresentation;
}) => (
  <div className="overview-section recent-events">
    <div className="section-header">
      <h2>Latest Warning Events</h2>
      <span className="section-header__count">
        {presentation.events.length} {presentation.events.length === 1 ? 'event' : 'events'}
      </span>
    </div>
    {presentation.events.length === 0 ? (
      <div className="recent-events__empty">
        {showSkeleton ? '' : 'No warning events in the last 24 hours.'}
      </div>
    ) : (
      <ul className="recent-events__list">
        {presentation.events.map((event) => (
          <RecentEventRow
            key={event.eventUid}
            event={event}
            clickable={presentation.canOpen(event)}
            onOpen={() => presentation.onOpen(event)}
          />
        ))}
      </ul>
    )}
  </div>
);

const ClusterOverviewHeader = ({
  contextLabel,
  overview,
  overviewStatus,
  showSkeleton,
}: Pick<
  ClusterOverviewViewProps,
  'contextLabel' | 'overview' | 'overviewStatus' | 'showSkeleton'
>) => (
  <div className="overview-top">
    <div className="overview-top__info">
      <h1 className="overview-top__title">{contextLabel}</h1>
      <div className="cluster-info">
        <span className="cluster-info-item">
          <span className="cluster-info-label">Cluster Type</span>
          <span className="cluster-info-value">
            {showSkeleton ? DASH : overview.clusterType || 'Unknown'}
          </span>
        </span>
        <span className="cluster-info-item">
          <span className="cluster-info-label">Version</span>
          <span className="cluster-info-value">
            {showSkeleton ? DASH : overview.clusterVersion || 'Unknown'}
          </span>
        </span>
        {overviewStatus.summary ? (
          <span className="cluster-info-item">
            <span className="cluster-info-label">Status</span>
            <span className={`cluster-info-value cluster-info-value--${overviewStatus.status}`}>
              {overviewStatus.summary}
            </span>
          </span>
        ) : null}
      </div>
    </div>
    <div className="overview-top__hero">
      <img
        src={captainK8s}
        alt="Captain K8s"
        className="captain-k8s-small"
        width={1024}
        height={1024}
      />
      <img src={logo} alt="Luxury Yacht" className="logo-small" width={827} height={500} />
    </div>
  </div>
);

export const ClusterOverviewView: React.FC<ClusterOverviewViewProps> = ({
  contextLabel,
  overview,
  overviewStatus,
  showSkeleton,
  errorMessage,
  resources,
  nodes,
  workloads,
  recentEvents,
}) => (
  <div className="cluster-overview selectable">
    <ClusterOverviewHeader
      contextLabel={contextLabel}
      overview={overview}
      overviewStatus={overviewStatus}
      showSkeleton={showSkeleton}
    />

    {errorMessage ? (
      <div className="cluster-overview-loading-inline">
        <ClusterOverviewRestrictionNotice
          restrictions={[
            {
              key: 'load-error',
              headline: 'Failed to load Cluster Overview data',
              detail: errorMessage,
            },
          ]}
        />
      </div>
    ) : null}

    <div className="overview-grid">
      <ResourceUtilizationCard
        overview={overview}
        showSkeleton={showSkeleton}
        errorMessage={errorMessage}
        presentation={resources}
      />
      <NodesSummaryCard overview={overview} showSkeleton={showSkeleton} presentation={nodes} />
      <WorkloadsSummaryCard
        overview={overview}
        showSkeleton={showSkeleton}
        presentation={workloads}
      />
      <RecentEventsCard showSkeleton={showSkeleton} presentation={recentEvents} />
    </div>
  </div>
);
