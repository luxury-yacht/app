import { StatusChip, type StatusChipVariant } from '@shared/components/StatusChip';
import Tooltip from '@shared/components/Tooltip';
import { getResourceLimitUsagePercent } from '@shared/utils/resourceCalculations';
import { withStableListKeys } from '@shared/utils/stableListKeys';
import { type ReactNode, useId, useState } from 'react';
import type {
  ConditionFacts,
  KarpenterFacts,
  KarpenterRequirement,
  KarpenterTaint,
} from '@/core/refresh/types';
import {
  capacityResourceLabel,
  detectCpuUnit,
  formatCapacityValue,
  sortedCapacityResources,
} from './karpenterCapacityFormat';
import { ConditionChips } from './shared/ConditionChips';
import { OverviewItem } from './shared/OverviewItem';
import './shared/OverviewBlocks.css';
import './KarpenterOverview.css';

export function KarpenterSection({
  title,
  tooltip,
  children,
}: Readonly<{ title: string; tooltip?: string; children: ReactNode }>) {
  return (
    <section className="karpenter-overview-section" aria-label={title}>
      <h3 className="metadata-label">
        <span>{title}</span>
        {!!tooltip && <Tooltip content={tooltip} triggerLabel={`${title} information`} />}
      </h3>
      {children}
    </section>
  );
}

export function KarpenterFields({
  fields,
}: Readonly<{ fields: readonly (readonly [string, ReactNode])[] }>) {
  return (
    <>
      {fields.map(([label, value]) => (
        <OverviewItem key={label} label={label} value={value === '' ? undefined : value} />
      ))}
    </>
  );
}

export function KarpenterValues({ label, values }: Readonly<{ label: string; values?: string[] }>) {
  if (!values?.length) {
    return null;
  }
  return (
    <section className="overview-stacked" aria-label={label}>
      <div className="karpenter-overview-subtitle">{label}</div>
      <div className="overview-ref-list">
        {withStableListKeys(values, (value) => value).map(({ key, value }) => (
          <span className="overview-ref-item" key={key}>
            {value}
          </span>
        ))}
      </div>
    </section>
  );
}

export function KarpenterMap({
  label,
  values,
}: Readonly<{ label: string; values?: Record<string, string> }>) {
  if (!values || !Object.keys(values).length) {
    return null;
  }
  return (
    <section className="overview-row-list" aria-label={label}>
      {Object.entries(values)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => (
          <div className="overview-row" key={key}>
            <span className="overview-row-label">{key}</span>
            <span className="overview-row-value">{value}</span>
          </div>
        ))}
    </section>
  );
}

const hasEntries = (values: Record<string, string> | undefined): boolean =>
  Object.keys(values ?? {}).length > 0;

// Capacity-to-limit percentage for the resources the shared calculation understands; the same
// number the family table's Usage column shows, warning-colored strictly above 80%.
const usedOfLimit = (
  resource: string,
  facts: KarpenterFacts
): { text: string; warning: boolean } => {
  const percentage =
    resource === 'cpu' || resource === 'memory'
      ? getResourceLimitUsagePercent(facts.capacity?.[resource], facts.limits?.[resource], resource)
      : undefined;
  if (percentage === undefined) {
    return { text: '-', warning: false };
  }
  return { text: `${Number(percentage.toFixed(1))}%`, warning: percentage > 80 };
};

function KarpenterUsedCell({
  resource,
  facts,
}: Readonly<{ resource: string; facts: KarpenterFacts }>) {
  const used = usedOfLimit(resource, facts);
  return (
    <td className="overview-row-value">
      {used.warning ? <span className="status-text warning">{used.text}</span> : used.text}
    </td>
  );
}

// One row per resource. Allocatable appears when the object reports it (claims); Limit and Used
// appear when limits are configured (pools). Capacity is always present.
export function KarpenterCapacity({
  facts,
  tooltip,
}: Readonly<{ facts: KarpenterFacts; tooltip?: string }>) {
  const resources = sortedCapacityResources([facts.capacity, facts.allocatable, facts.limits]);
  if (!resources.length) {
    return null;
  }
  const cpuUnit = detectCpuUnit([facts.capacity?.cpu, facts.allocatable?.cpu ?? facts.limits?.cpu]);
  const showAllocatable = hasEntries(facts.allocatable);
  const showLimits = hasEntries(facts.limits);
  const quantity = (values: Record<string, string> | undefined, resource: string) =>
    formatCapacityValue(resource, values?.[resource], cpuUnit);
  return (
    <KarpenterSection title="Capacity" tooltip={tooltip}>
      <table className="karpenter-capacity-table">
        <thead>
          <tr>
            <th scope="col">Resource</th>
            {showAllocatable && <th scope="col">Allocatable</th>}
            <th scope="col">Capacity</th>
            {showLimits && <th scope="col">Limit</th>}
            {showLimits && <th scope="col">Used</th>}
          </tr>
        </thead>
        <tbody>
          {resources.map((resource) => (
            <tr key={resource}>
              <th scope="row" className="overview-row-label">
                {capacityResourceLabel(resource)}
              </th>
              {showAllocatable && (
                <td className="overview-row-value">{quantity(facts.allocatable, resource)}</td>
              )}
              <td className="overview-row-value">{quantity(facts.capacity, resource)}</td>
              {showLimits && (
                <td className="overview-row-value">{quantity(facts.limits, resource)}</td>
              )}
              {showLimits && <KarpenterUsedCell resource={resource} facts={facts} />}
            </tr>
          ))}
        </tbody>
      </table>
    </KarpenterSection>
  );
}

export function KarpenterClaimInstance({ facts }: Readonly<{ facts: KarpenterFacts }>) {
  const { instanceType, capacityType, zone, architecture, providerID, imageID } = facts;
  const placement = [zone, architecture].filter(Boolean).join(' · ');
  const hasInstance = !!(instanceType || capacityType || placement);
  if (!hasInstance && !providerID && !imageID) {
    return null;
  }
  return (
    <>
      {hasInstance && (
        <OverviewItem
          label="Instance"
          value={
            <span className="karpenter-instance">
              {!!instanceType && <span className="overview-value-mono">{instanceType}</span>}
              {!!capacityType && <StatusChip variant="info">{capacityType}</StatusChip>}
              {!!placement && <span className="karpenter-instance-placement">{placement}</span>}
            </span>
          }
        />
      )}
      {!!providerID && (
        <OverviewItem
          label="Provider ID"
          value={<span className="overview-value-mono">{providerID}</span>}
        />
      )}
      {!!imageID && (
        <OverviewItem
          label="Image ID"
          value={<span className="overview-value-mono">{imageID}</span>}
        />
      )}
    </>
  );
}

function KarpenterTaints({
  label,
  taints,
}: Readonly<{ label: string; taints?: KarpenterTaint[] }>) {
  if (!taints?.length) {
    return null;
  }
  return (
    <section className="overview-stacked karpenter-scheduling-group" aria-label={label}>
      <div className="karpenter-overview-subtitle">{label}</div>
      <div className="overview-condition-list">
        {withStableListKeys(taints, (taint) => JSON.stringify(taint)).map(
          ({ key, value: taint }) => {
            const valueSuffix = taint.value ? `=${taint.value}` : '';
            return (
              <StatusChip key={key} variant="warning" className="karpenter-taint selectable">
                {`${taint.key}${valueSuffix}:${taint.effect}`}
              </StatusChip>
            );
          }
        )}
      </div>
    </section>
  );
}

const requirementLabels = new Map(
  Object.entries({
    'kubernetes.io/arch': 'Architecture',
    'kubernetes.io/os': 'Operating System',
    'topology.kubernetes.io/zone': 'Zone',
    'topology.kubernetes.io/region': 'Region',
    'node.kubernetes.io/instance-type': 'Instance Type',
    'karpenter.sh/capacity-type': 'Capacity Type',
    'karpenter.sh/nodepool': 'NodePool',
    'karpenter.sh/nodeclaim': 'NodeClaim',
    'karpenter.sh/provisioner-name': 'Provisioner',
    'karpenter.k8s.aws/instance-category': 'Instance Category',
    'karpenter.k8s.aws/instance-family': 'Instance Family',
    'karpenter.k8s.aws/instance-generation': 'Instance Generation',
    'karpenter.k8s.aws/instance-size': 'Instance Size',
    'karpenter.k8s.aws/instance-cpu': 'Instance CPUs',
    'karpenter.k8s.aws/instance-memory': 'Instance Memory',
  })
);

const requirementLabelWords = new Map(
  Object.entries({
    ami: 'AMI',
    api: 'API',
    aws: 'AWS',
    cpu: 'CPU',
    cpus: 'CPUs',
    ebs: 'EBS',
    eni: 'ENI',
    gpu: 'GPU',
    gpus: 'GPUs',
    id: 'ID',
    ids: 'IDs',
    ip: 'IP',
    nvme: 'NVMe',
    os: 'OS',
  })
);

const formatRequirementLabel = (key: string): string =>
  requirementLabels.get(key) ??
  (key
    .slice(key.lastIndexOf('/') + 1)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[-_.\s]+/)
    .filter(Boolean)
    .map(
      (word) =>
        requirementLabelWords.get(word.toLowerCase()) ?? word[0].toUpperCase() + word.slice(1)
    )
    .join(' ') ||
    key);

const requirementOperators: Record<string, string> = {
  In: '',
  NotIn: 'Not in',
  Exists: 'Exists',
  DoesNotExist: 'Does not exist',
  Gt: '>',
  Gte: '≥',
  Lt: '<',
  Lte: '≤',
};

function KarpenterRequirementValue({ value, label }: Readonly<{ value: string; label: string }>) {
  const [expanded, setExpanded] = useState(false);
  const valueId = useId();
  const isLong = value.length > 150;
  const action = expanded ? 'Collapse' : 'Expand';
  const displayValue = isLong && !expanded ? value.slice(0, 150) : value;
  const content = (
    <span id={valueId} className="selectable">
      {displayValue}
    </span>
  );
  if (!isLong) {
    return content;
  }
  return (
    <button
      type="button"
      className="karpenter-value-toggle selectable"
      aria-label={`${action} ${label}`}
      aria-expanded={expanded}
      aria-controls={valueId}
      title={`${action} ${label}`}
      onClick={() => setExpanded((current) => !current)}
    >
      {content}
      {!expanded && '…'}
    </button>
  );
}

function KarpenterRequirementRow({ requirement }: Readonly<{ requirement: KarpenterRequirement }>) {
  const label = formatRequirementLabel(requirement.key);
  const constraint = [
    requirementOperators[requirement.operator] ?? requirement.operator,
    requirement.values?.join(', '),
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div className="overview-row karpenter-requirement">
      <span className="overview-row-label selectable">
        <Tooltip
          content={<span className="selectable">{requirement.key}</span>}
          triggerLabel={`Kubernetes key for ${label}`}
          interactive
        >
          {label}
        </Tooltip>
      </span>
      <span className="overview-row-value selectable">
        <KarpenterRequirementValue value={constraint || '-'} label={label} />
        {requirement.minValues !== undefined && (
          <span className="karpenter-requirement-minimum">min values: {requirement.minValues}</span>
        )}
      </span>
    </div>
  );
}

export function KarpenterScheduling({ facts }: Readonly<{ facts: KarpenterFacts }>) {
  if (!facts.requirements?.length && !facts.taints?.length && !facts.startupTaints?.length) {
    return null;
  }
  return (
    <KarpenterSection title="Scheduling">
      {!!facts.requirements?.length && (
        <section className="overview-stacked karpenter-scheduling-group" aria-label="Requirements">
          <div className="karpenter-overview-subtitle">Requirements</div>
          <div className="overview-row-list">
            {withStableListKeys(facts.requirements, (requirement) => requirement.key).map(
              ({ key, value: requirement }) => (
                <KarpenterRequirementRow key={key} requirement={requirement} />
              )
            )}
          </div>
        </section>
      )}
      <KarpenterTaints label="Taints" taints={facts.taints} />
      <KarpenterTaints label="Startup Taints" taints={facts.startupTaints} />
    </KarpenterSection>
  );
}

export function KarpenterDisruption({ facts }: Readonly<{ facts: KarpenterFacts }>) {
  if (!facts.consolidationPolicy && !facts.consolidateAfter && !facts.budgets?.length) {
    return null;
  }
  return (
    <KarpenterSection title="Disruption">
      <KarpenterFields
        fields={[
          ['Consolidation Policy', facts.consolidationPolicy],
          ['Consolidate After', facts.consolidateAfter],
        ]}
      />
      {!!facts.budgets?.length && (
        <section className="overview-stacked" aria-label="Disruption Budgets">
          <div className="karpenter-overview-subtitle">Budgets</div>
          {withStableListKeys(facts.budgets, (budget) => JSON.stringify(budget)).map(
            ({ key, value: budget }) => (
              <div className="overview-row-list karpenter-budget" key={key}>
                <KarpenterFields
                  fields={[
                    ['Nodes', budget.nodes],
                    ['Reasons', budget.reasons?.join(', ')],
                    ['Schedule', budget.schedule],
                    ['Duration', budget.duration],
                  ]}
                />
              </div>
            )
          )}
        </section>
      )}
    </KarpenterSection>
  );
}

export function KarpenterLifecycle({ facts }: Readonly<{ facts: KarpenterFacts }>) {
  if (!facts.expireAfter && !facts.terminationGracePeriod) {
    return null;
  }
  return (
    <KarpenterSection title="Lifecycle">
      <KarpenterFields
        fields={[
          ['Expire After', facts.expireAfter],
          ['Termination Grace Period', facts.terminationGracePeriod],
        ]}
      />
    </KarpenterSection>
  );
}

const conditionVariants: Record<string, StatusChipVariant> = {
  True: 'healthy',
  False: 'unhealthy',
};

export function KarpenterConditions({ conditions }: Readonly<{ conditions?: ConditionFacts[] }>) {
  if (!conditions?.length) {
    return null;
  }
  return (
    <KarpenterSection title="Conditions">
      <ConditionChips
        conditions={conditions}
        variant={(condition) => conditionVariants[condition.status] ?? 'warning'}
      />
    </KarpenterSection>
  );
}
