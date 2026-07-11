/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/descriptors/node.tsx
 *
 * Node Overview descriptor (X1). Presentation ported verbatim from NodeOverview.tsx.
 *
 * Node is cluster-scoped, so the frame contributes kind/name/labels/annotations only (no namespace
 * value on the DTO). The drain affordance is panel state, not DTO data: the inline drain icon reads
 * `drainInProgress`/`onOpenDrain` from the OverviewContext the renderer threads through.
 */

import { DrainIcon } from '@shared/components/icons/SharedIcons';
import { StatusChip, type StatusChipVariant } from '@shared/components/StatusChip';
import { withStableListKeys } from '@shared/utils/stableListKeys';
import { nodes } from '@wailsjs/go/models';
import type React from 'react';
import type { OverviewContext, OverviewDescriptor } from '../schema';
import '../shared/OverviewBlocks.css';
import '../NodeOverview.css';

type NodeDetails = nodes.NodeDetails;

// For pressure-style conditions (MemoryPressure, DiskPressure, PIDPressure,
// NetworkUnavailable), `True` means the bad state exists; for the rest
// (Ready, etc.), `True` is healthy.
const PRESSURE_CONDITION_TYPES = new Set([
  'MemoryPressure',
  'DiskPressure',
  'PIDPressure',
  'NetworkUnavailable',
]);

const nodeConditionVariant = (type: string, status: string): StatusChipVariant => {
  if (status === 'Unknown') {
    return 'warning';
  }
  const healthyStatus = PRESSURE_CONDITION_TYPES.has(type) ? 'False' : 'True';
  return status === healthyStatus ? 'healthy' : 'unhealthy';
};

const hasSystemInfo = (d: NodeDetails): boolean =>
  Boolean(d.kubeletVersion || d.osImage || d.containerRuntime || d.kernelVersion);

/**
 * The inline drain affordance rendered next to the status block. Drain state is panel context, not
 * DTO data, so it lives in a widget rather than a field. Renders nothing unless an active drain job
 * exists for this node (`drainInProgress`) and the open-drain handler is wired.
 */
const renderDrainIcon = (_d: NodeDetails, context: OverviewContext): React.ReactNode => {
  if (!(context.drainInProgress && context.onOpenDrain)) {
    return null;
  }
  return (
    <button
      type="button"
      className="node-overview-drain-icon"
      onClick={context.onOpenDrain}
      title="Drain in progress — click to view"
      aria-label="Open drain status"
    >
      <DrainIcon />
    </button>
  );
};

const conditionList = (d: NodeDetails): nodes.NodeCondition[] => d.conditions ?? [];

const renderConditions = (d: NodeDetails): React.ReactNode => (
  <div className="overview-condition-list">
    {conditionList(d)
      .filter((condition) => Boolean(condition.kind))
      .map((condition) => (
        <StatusChip
          key={condition.kind}
          variant={nodeConditionVariant(condition.kind, condition.status)}
          tooltip={condition.message || condition.reason || undefined}
        >
          {condition.kind}
        </StatusChip>
      ))}
  </div>
);

const renderRoles = (d: NodeDetails): React.ReactNode => (
  <div className="overview-condition-list">
    {(d.roles ?? '')
      .split(',')
      .map((role) => role.trim())
      .filter(Boolean)
      .map((role) => (
        <StatusChip key={role} variant="info">
          {role}
        </StatusChip>
      ))}
  </div>
);

const renderTaints = (d: NodeDetails): React.ReactNode => (
  <div className="overview-condition-list">
    {withStableListKeys(d.taints ?? [], (taint) => JSON.stringify(taint)).map(
      ({ key, value: taint }) => {
        const label = `${taint.key}${taint.value ? `=${taint.value}` : ''}:${taint.effect}`;
        return (
          <StatusChip key={key} variant="warning">
            {label}
          </StatusChip>
        );
      }
    )}
  </div>
);

export const nodeDescriptor: OverviewDescriptor<NodeDetails> = {
  displayKind: 'Node',
  dtoClass: nodes.NodeDetails,
  schema: {
    items: [
      // Status + the inline drain affordance. The status block is the shared ResourceStatus; the
      // drain icon is panel context, rendered immediately after so the two read as one row.
      { kind: 'status' },
      { kind: 'widget', render: renderDrainIcon },

      // Conditions, then a section separator (only when conditions exist).
      {
        field: 'conditions',
        label: 'Conditions',
        hidden: (d) => conditionList(d).length === 0,
        render: renderConditions,
      },
      {
        kind: 'widget',
        render: (d) =>
          conditionList(d).length > 0 ? <div className="metadata-section-separator" /> : null,
        consumes: ['conditions'],
      },

      { field: 'roles', label: 'Roles', hidden: (d) => !d.roles, render: renderRoles },

      // Network information.
      { field: 'internalIP', label: 'Internal IP', hidden: (d) => !d.internalIP },
      { field: 'externalIP', label: 'External IP', hidden: (d) => !d.externalIP },
      {
        field: 'hostname',
        label: 'Hostname',
        hidden: (d) => !(d.hostname && d.hostname !== d.name),
      },

      // Pod count and capacity. If either value is unknown, display `unknown`.
      {
        field: 'podsCount',
        derivedFrom: ['podsCapacity'],
        label: 'Pods',
        render: (d) => `${d.podsCount ?? 'unknown'}/${d.podsCapacity ?? 'unknown'}`,
      },

      // Storage capacity if available.
      { field: 'storageCapacity', label: 'Storage', hidden: (d) => !d.storageCapacity },

      // System info group — visually separated from surrounding rows.
      {
        kind: 'widget',
        render: (d) => (hasSystemInfo(d) ? <div className="metadata-section-separator" /> : null),
        consumes: ['kubeletVersion', 'osImage', 'containerRuntime', 'kernelVersion'],
      },
      { field: 'kubeletVersion', label: 'Kubelet', hidden: (d) => !d.kubeletVersion },
      {
        field: 'os',
        derivedFrom: ['osImage', 'architecture'],
        label: 'OS',
        hidden: (d) => !(d.os && d.osImage),
        render: (d) => `${d.os}/${d.architecture || 'unknown'}`,
      },
      { field: 'osImage', label: 'OS Image', hidden: (d) => !d.osImage },
      { field: 'kernelVersion', label: 'Kernel', hidden: (d) => !d.kernelVersion },
      { field: 'containerRuntime', label: 'Runtime', hidden: (d) => !d.containerRuntime },
      {
        kind: 'widget',
        render: (d) => (hasSystemInfo(d) ? <div className="metadata-section-separator" /> : null),
        consumes: ['kubeletVersion', 'osImage', 'containerRuntime', 'kernelVersion'],
      },

      {
        field: 'taints',
        label: 'Taints',
        hidden: (d) => (d.taints ?? []).length === 0,
        render: renderTaints,
      },
    ],
  },
  // Consumed by the separate Utilization section (CPU/memory/pods/storage metrics + pod list), not
  // the Overview, plus `unschedulable` which the Overview surfaces only through the drain icon's
  // panel context rather than as a DTO-backed row.
  coveredElsewhere: [
    'cpuCapacity',
    'cpuAllocatable',
    'memoryCapacity',
    'memoryAllocatable',
    'podsCapacity',
    'podsAllocatable',
    'storageCapacity',
    'podsCount',
    'restarts',
    'cpuRequests',
    'cpuLimits',
    'memRequests',
    'memLimits',
    'cpuUsage',
    'memoryUsage',
    'cpu',
    'memory',
    'pods',
    'podsList',
    'unschedulable',
  ],
};
