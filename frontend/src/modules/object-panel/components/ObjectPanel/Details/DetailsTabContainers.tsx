/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/DetailsTabContainers.tsx
 *
 * Per-container cards inside the object-panel Details tab. Init containers
 * and standard containers are rendered as two grouped sub-sections so the
 * lifecycle distinction is clear at a glance.
 *
 * Each card surfaces the operational signals first (state, restart count,
 * resources) and pushes lower-priority details (env, command, args, mounts)
 * out of the overview entirely — those are better served by a dedicated
 * spec/shell view.
 */

import React from 'react';
import { StatusChip, type StatusChipVariant } from '@shared/components/StatusChip';
import '../shared.css';
import './DetailsTabContainers.css';

interface Container {
  name: string;
  image: string;
  ready?: boolean;
  restartCount?: number;
  state?: string;
  stateReason?: string;
  stateMessage?: string;
  cpuRequest?: string;
  cpuLimit?: string;
  memRequest?: string;
  memLimit?: string;
}

interface ContainersProps {
  containers?: Container[];
  initContainers?: Container[];
}

interface ParsedImage {
  name: string;
  ref: string;
  isDigest: boolean;
}

const parseImage = (image: string): ParsedImage => {
  const atIdx = image.indexOf('@');
  if (atIdx > 0) {
    return { name: image.slice(0, atIdx), ref: image.slice(atIdx + 1), isDigest: true };
  }
  const lastColon = image.lastIndexOf(':');
  const lastSlash = image.lastIndexOf('/');
  if (lastColon > lastSlash && lastColon !== -1) {
    return { name: image.slice(0, lastColon), ref: image.slice(lastColon + 1), isDigest: false };
  }
  return { name: image, ref: 'latest', isDigest: false };
};

// Truncate digests so they don't blow out the layout — the prefix is enough
// to recognise an image, full value lives in the title attribute.
const formatRef = (parsed: ParsedImage): string =>
  parsed.isDigest && parsed.ref.length > 19 ? `${parsed.ref.slice(0, 19)}…` : parsed.ref;

// Map a container's state (and reason) to a StatusChip variant.
//
//   Running                          → healthy
//   Terminated/Completed             → healthy   (init containers; intentional exit)
//   Waiting/ContainerCreating|...    → info      (transient setup states)
//   Waiting/anything else            → unhealthy (CrashLoopBackOff, ImagePullBackOff, ...)
//   Terminated/anything else         → unhealthy (Error, OOMKilled, ...)
const TRANSIENT_WAITING_REASONS = new Set(['ContainerCreating', 'PodInitializing']);

const stateVariant = (state?: string, reason?: string): StatusChipVariant => {
  if (state === 'Running') return 'healthy';
  if (state === 'Terminated' && reason === 'Completed') return 'healthy';
  if (state === 'Waiting') {
    return reason && TRANSIENT_WAITING_REASONS.has(reason) ? 'info' : 'unhealthy';
  }
  if (state === 'Terminated') return 'unhealthy';
  return 'info';
};

const stateLabel = (state?: string, reason?: string): string => {
  if (!state) return 'Unknown';
  return reason ? `${state}: ${reason}` : state;
};

const ContainerCard: React.FC<{ container: Container }> = ({ container }) => {
  const parsed = parseImage(container.image);
  const variant = stateVariant(container.state, container.stateReason);
  const hasResources = Boolean(
    container.cpuRequest || container.cpuLimit || container.memRequest || container.memLimit
  );
  const restarts = container.restartCount ?? 0;

  return (
    <div className="containers-card">
      <div className="containers-card-header">
        <span className="containers-card-title">{container.name}</span>
        <StatusChip variant={variant} tooltip={container.stateMessage || undefined}>
          {stateLabel(container.state, container.stateReason)}
        </StatusChip>
        {restarts > 0 && (
          <StatusChip variant="warning">
            {restarts} restart{restarts === 1 ? '' : 's'}
          </StatusChip>
        )}
      </div>

      <div className="containers-image" title={container.image}>
        <span className="containers-image-name">{parsed.name}</span>
        <span className="containers-image-sep">{parsed.isDigest ? '@' : ':'}</span>
        <span className="containers-image-ref">{formatRef(parsed)}</span>
      </div>

      {hasResources && (
        <div className="containers-resources">
          <div className="containers-resource">
            <span className="containers-resource-value">
              {container.cpuRequest || '—'} / {container.cpuLimit || '—'}
            </span>
            <span className="containers-resource-label">CPU</span>
          </div>
          <div className="containers-resource">
            <span className="containers-resource-value">
              {container.memRequest || '—'} / {container.memLimit || '—'}
            </span>
            <span className="containers-resource-label">Memory</span>
          </div>
        </div>
      )}
    </div>
  );
};

const ContainerList: React.FC<{ containers: Container[] }> = ({ containers }) => (
  <div className="containers-card-list">
    {containers.map((c, i) => (
      <ContainerCard key={`${c.name}-${i}`} container={c} />
    ))}
  </div>
);

function Containers({ containers = [], initContainers = [] }: ContainersProps) {
  if (containers.length === 0 && initContainers.length === 0) {
    return null;
  }

  // Sub-headings only appear when both kinds are present — for the common
  // case of just standard containers we drop the redundant heading and let
  // the section title carry the meaning.
  const hasBoth = initContainers.length > 0 && containers.length > 0;

  return (
    <div className="object-panel-section">
      <div className="object-panel-section-title">Containers</div>
      <div className="containers-groups">
        {initContainers.length > 0 && (
          <div className="containers-group">
            {hasBoth && <div className="containers-group-heading">Init Containers</div>}
            <ContainerList containers={initContainers} />
          </div>
        )}
        {containers.length > 0 && (
          <div className="containers-group">
            {hasBoth && <div className="containers-group-heading">Containers</div>}
            <ContainerList containers={containers} />
          </div>
        )}
      </div>
    </div>
  );
}

export default Containers;
