/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/descriptors/pod.tsx
 *
 * Pod Overview descriptor (X1). Presentation ported verbatim from PodOverview.tsx.
 */

import React from 'react';
import { types } from '@wailsjs/go/models';
import { ObjectPanelLink } from '@shared/components/ObjectPanelLink';
import { StatusChip, type StatusChipVariant } from '@shared/components/StatusChip';
import {
  buildRequiredObjectReference,
  buildRequiredRelatedObjectReference,
} from '@shared/utils/objectIdentity';
import type { OverviewContext, OverviewDescriptor } from '../schema';
import {
  DEFAULT_TOLERATION_RE,
  parseToleration,
  type ParsedToleration,
} from '../shared/tolerations';
import '../shared/OverviewBlocks.css';

type PodDetailInfo = types.PodDetailInfo;

// Cluster identity threaded through the renderer context so links resolve to the active cluster.
const clusterMeta = (context: OverviewContext) => ({
  clusterId: context.clusterId ?? undefined,
  clusterName: context.clusterName ?? undefined,
});

const qosVariant = (qosClass: string): StatusChipVariant => {
  if (qosClass === 'Guaranteed') return 'healthy';
  if (qosClass === 'BestEffort') return 'warning';
  return 'info';
};

const qosTooltip = (qosClass: string): string | undefined => {
  if (qosClass === 'Guaranteed') {
    return 'Every container has equal CPU and memory requests and limits. Last to be evicted under node resource pressure.';
  }
  if (qosClass === 'Burstable') {
    return 'At least one container has CPU or memory requests/limits set, but the pod does not meet the Guaranteed criteria. Evicted before Guaranteed pods under node resource pressure.';
  }
  if (qosClass === 'BestEffort') {
    return 'No container has any CPU or memory requests or limits set. First to be evicted under node resource pressure.';
  }
  return undefined;
};

const hasOwner = (d: PodDetailInfo): boolean =>
  Boolean(d.ownerKind && d.ownerName && d.ownerKind !== 'None');

// Owner link reads ownerKind/ownerName/ownerApiVersion. Prefer the OwnerReference
// apiVersion when present so CRD-backed owners (Argo Rollout, KubeVirt VMI, Tekton
// TaskRun, etc.) keep their real GVK.
const renderOwner = (d: PodDetailInfo, context: OverviewContext): React.ReactNode => {
  // The renderer evaluates `render` before honoring `hidden`, so guard the
  // no-owner case here too.
  if (!hasOwner(d)) return null;
  let ownerRef = null;
  try {
    ownerRef = buildRequiredRelatedObjectReference({
      kind: d.ownerKind.toLowerCase(),
      apiVersion: d.ownerApiVersion,
      name: d.ownerName,
      namespace: d.namespace,
      ...clusterMeta(context),
    });
  } catch {
    ownerRef = null;
  }
  const label = `${d.ownerKind}/${d.ownerName}`;
  return ownerRef ? <ObjectPanelLink objectRef={ownerRef}>{label}</ObjectPanelLink> : label;
};

const parsedTolerations = (d: PodDetailInfo): ParsedToleration[] =>
  d.tolerations
    ?.filter((tol) => !DEFAULT_TOLERATION_RE.test(tol))
    .map(parseToleration)
    .filter((p): p is ParsedToleration => p !== null) ?? [];

// Whether the runtime/security group (QoS / Priority / Restart Policy / Service
// Account / Host) has any row to show.
const hasRuntimeGroup = (d: PodDetailInfo): boolean =>
  Boolean(
    d.qosClass ||
    d.priorityClass ||
    (d.restartPolicy && d.restartPolicy !== 'Always') ||
    (d.serviceAccount && d.serviceAccount !== 'default') ||
    d.hostNetwork ||
    d.hostPID ||
    d.hostIPC
  );

export const podDescriptor: OverviewDescriptor<PodDetailInfo> = {
  displayKind: 'Pod',
  dtoClass: types.PodDetailInfo,
  schema: {
    items: [
      { kind: 'status' },
      // ResourceStatus renders Status then Ready; the renderer's status item drops
      // `ready`, so surface it as its own row in the same position.
      {
        field: 'ready',
        label: 'Ready',
        hidden: (d) => !d.ready,
        render: (d) => {
          // `render` runs before `hidden` is honored, so guard the empty case.
          if (!d.ready) return null;
          const parts = d.ready.split('/');
          if (parts.length === 2) {
            const readyCount = parseInt(parts[0]);
            const totalCount = parseInt(parts[1]);
            if (!isNaN(readyCount) && !isNaN(totalCount) && readyCount !== totalCount) {
              return <span className="status-text warning">{d.ready}</span>;
            }
          }
          return d.ready;
        },
      },
      // Separator before the identity group (Restarts / Owner / Node / IPs).
      {
        kind: 'widget',
        render: (d) =>
          (d.restarts !== undefined && d.restarts > 0) ||
          hasOwner(d) ||
          d.node ||
          d.nodeIP ||
          d.podIP ? (
            <div className="metadata-section-separator" />
          ) : null,
        consumes: [],
      },
      // Restarts - highlight if there are any.
      {
        field: 'restarts',
        label: 'Restarts',
        hidden: (d) => !(d.restarts !== undefined && d.restarts > 0),
        render: (d) => <span className="status-text warning">{d.restarts}</span>,
      },
      // Owner - important relationship.
      {
        field: 'ownerName',
        derivedFrom: ['ownerKind', 'ownerApiVersion'],
        label: 'Owner',
        hidden: (d) => !hasOwner(d),
        render: renderOwner,
      },
      // Node information.
      {
        field: 'node',
        label: 'Node',
        hidden: (d) => !d.node,
        render: (d, context) =>
          !d.node ? null : (
            <ObjectPanelLink
              objectRef={buildRequiredObjectReference({
                kind: 'node',
                name: d.node,
                ...clusterMeta(context),
              })}
              title="Click to view node"
            >
              {d.node}
            </ObjectPanelLink>
          ),
      },
      { field: 'nodeIP', label: 'Node IP', hidden: (d) => !d.nodeIP },
      { field: 'podIP', label: 'Pod IP', hidden: (d) => !d.podIP },
      {
        field: 'tolerations',
        label: 'Tolerations',
        hidden: (d) => parsedTolerations(d).length === 0,
        render: (d) => (
          <div className="overview-condition-list">
            {parsedTolerations(d).map((p, i) => (
              <StatusChip key={`${p.label}-${i}`} variant="info" tooltip={p.tooltip}>
                {p.label}
              </StatusChip>
            ))}
          </div>
        ),
      },
      // Runtime / security group — visually separated from the identity rows above
      // (Owner / Node / IPs).
      {
        kind: 'widget',
        render: (d) => (hasRuntimeGroup(d) ? <div className="metadata-section-separator" /> : null),
        consumes: [],
      },
      {
        field: 'qosClass',
        label: 'QoS',
        hidden: (d) => !d.qosClass,
        render: (d) => (
          <StatusChip variant={qosVariant(d.qosClass)} tooltip={qosTooltip(d.qosClass)}>
            {d.qosClass}
          </StatusChip>
        ),
      },
      { field: 'priorityClass', label: 'Priority', hidden: (d) => !d.priorityClass },
      {
        field: 'restartPolicy',
        label: 'Restart Policy',
        hidden: (d) => !(d.restartPolicy && d.restartPolicy !== 'Always'),
      },
      {
        field: 'serviceAccount',
        label: 'Service Account',
        hidden: (d) => !(d.serviceAccount && d.serviceAccount !== 'default'),
        render: (d, context) =>
          !d.serviceAccount ? null : (
            <ObjectPanelLink
              objectRef={buildRequiredObjectReference({
                kind: 'serviceaccount',
                name: d.serviceAccount,
                namespace: d.namespace,
                ...clusterMeta(context),
              })}
              title="Click to view service account"
            >
              {d.serviceAccount}
            </ObjectPanelLink>
          ),
      },
      {
        field: 'hostNetwork',
        derivedFrom: ['hostPID', 'hostIPC'],
        label: 'Host',
        hidden: (d) => !(d.hostNetwork || d.hostPID || d.hostIPC),
        render: (d) => (
          <div className="overview-condition-list">
            {d.hostNetwork && (
              <StatusChip
                variant="warning"
                tooltip="Shares the host's network namespace. Bypasses network policies and can bind to host ports or sniff host traffic."
              >
                Network
              </StatusChip>
            )}
            {d.hostPID && (
              <StatusChip
                variant="warning"
                tooltip="Shares the host's process namespace. The pod can see, signal, and attach to every process running on the node."
              >
                PID
              </StatusChip>
            )}
            {d.hostIPC && (
              <StatusChip
                variant="warning"
                tooltip="Shares the host's IPC namespace. The pod can access shared memory and message queues used by host processes."
              >
                IPC
              </StatusChip>
            )}
          </div>
        ),
      },
    ],
  },
  // DTO keys handled outside this schema:
  // - containers / initContainers -> the Containers section
  // - cpuRequest/cpuLimit/cpuUsage/memRequest/memLimit/memUsage -> the Utilization section
  // - status fields (statusReason) handled by the status item; the others below are
  //   not surfaced in the Pod Overview by design (matches PodOverview.tsx).
  coveredElsewhere: [
    'containers',
    'initContainers',
    'cpuRequest',
    'cpuLimit',
    'cpuUsage',
    'memRequest',
    'memLimit',
    'memUsage',
    'conditions',
    'volumes',
    'affinity',
    'securityContext',
    'schedulerName',
    'runtimeClass',
    'dnsPolicy',
    'priority',
  ],
};
