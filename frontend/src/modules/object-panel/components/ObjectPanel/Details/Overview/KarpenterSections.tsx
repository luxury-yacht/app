import { StatusChip, type StatusChipVariant } from '@shared/components/StatusChip';
import Tooltip from '@shared/components/Tooltip';
import {
  formatCpuValue,
  formatResourceValue,
  parseResourceValue,
} from '@shared/utils/resourceCalculations';
import { withStableListKeys } from '@shared/utils/stableListKeys';
import type { ReactNode } from 'react';
import type {
  ConditionFacts,
  KarpenterFacts,
  KarpenterRequirement,
  KarpenterTaint,
} from '@/core/refresh/types';
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

const formatCapacityValue = (
  resource: string,
  value: string | undefined,
  cpuUnit: 'cores' | 'millicores'
): string => {
  if (value === undefined || value === '') {
    return '-';
  }
  if (resource === 'cpu') {
    const millicores = parseResourceValue(value, 'cpu');
    const formatted = formatResourceValue(value, millicores, 'cpu');
    return cpuUnit === 'cores' && formatted !== '-' ? formatCpuValue(millicores) : formatted;
  }
  return resource === 'memory' || resource === 'ephemeral-storage'
    ? formatResourceValue(value, parseResourceValue(value, 'memory'), 'memory')
    : value;
};

const capacityResourceOrder = [
  'cpu',
  'memory',
  'ephemeral-storage',
  'nodes',
  'pods',
  'vpc.amazonaws.com/pod-eni',
  'hugepages',
];

const capacityResourceLabels: Record<string, string> = {
  'ephemeral-storage': 'storage',
  'vpc.amazonaws.com/pod-eni': 'pod-eni',
};

const capacityResourceRank = (resource: string): number => {
  const key = resource.startsWith('hugepages-') ? 'hugepages' : resource;
  const index = capacityResourceOrder.indexOf(key);
  return index < 0 ? capacityResourceOrder.length : index;
};

const formatCapacitySummary = (
  resource: string,
  facts: KarpenterFacts,
  cpuUnit: 'cores' | 'millicores'
): string => {
  const total = formatCapacityValue(resource, facts.capacity?.[resource], cpuUnit);
  const allocatable = facts.allocatable?.[resource];
  if (allocatable !== undefined) {
    const available = formatCapacityValue(resource, allocatable, cpuUnit);
    return available === total ? available : `${available} of ${total}`;
  }
  const limit = facts.limits?.[resource];
  return limit === undefined
    ? total
    : `${total} (limit ${formatCapacityValue(resource, limit, cpuUnit)})`;
};

export function KarpenterCapacity({ facts }: Readonly<{ facts: KarpenterFacts }>) {
  const cpuUnit = [facts.capacity?.cpu, facts.allocatable?.cpu ?? facts.limits?.cpu].some(
    (value) => parseResourceValue(value, 'cpu') % 1000 !== 0
  )
    ? 'millicores'
    : 'cores';
  const resources = [
    ...new Set([
      ...Object.keys(facts.capacity ?? {}),
      ...Object.keys(facts.allocatable ?? {}),
      ...Object.keys(facts.limits ?? {}),
    ]),
  ].sort((a, b) => capacityResourceRank(a) - capacityResourceRank(b) || a.localeCompare(b));
  if (!resources.length) {
    return null;
  }
  return (
    <KarpenterSection
      title="Capacity"
      tooltip={
        'Some resource capacity may be reserved for the system. In this case, the value will read "n of n" to show how much of that resource is available for pods.'
      }
    >
      {resources.map((resource) => (
        <div className="overview-row" key={resource}>
          <span className="overview-row-label">{capacityResourceLabels[resource] ?? resource}</span>
          <span className="overview-row-value">
            {formatCapacitySummary(resource, facts, cpuUnit)}
          </span>
        </div>
      ))}
    </KarpenterSection>
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
          ({ key, value: taint }) => (
            <StatusChip key={key} variant="warning" className="karpenter-taint selectable">
              {`${taint.key}${taint.value ? `=${taint.value}` : ''}:${taint.effect}`}
            </StatusChip>
          )
        )}
      </div>
    </section>
  );
}

const requirementLabels: Record<string, string> = {
  'kubernetes.io/arch': 'Architecture',
  'kubernetes.io/os': 'Operating System',
  'topology.kubernetes.io/zone': 'Zone',
  'topology.kubernetes.io/region': 'Region',
  'node.kubernetes.io/instance-type': 'Instance Type',
  'karpenter.sh/capacity-type': 'Capacity Type',
  'karpenter.k8s.aws/instance-category': 'Instance Category',
  'karpenter.k8s.aws/instance-family': 'Instance Family',
  'karpenter.k8s.aws/instance-generation': 'Instance Generation',
  'karpenter.k8s.aws/instance-size': 'Instance Size',
  'karpenter.k8s.aws/instance-cpu': 'Instance CPUs',
  'karpenter.k8s.aws/instance-memory': 'Instance Memory',
};

const requirementOperators: Record<string, string> = {
  In: '',
  NotIn: 'Not in',
  Exists: 'Exists',
  DoesNotExist: 'Does not exist',
  Gt: '>',
  Lt: '<',
};

function KarpenterRequirementRow({ requirement }: Readonly<{ requirement: KarpenterRequirement }>) {
  const label = requirementLabels[requirement.key];
  const constraint = [
    requirementOperators[requirement.operator] ?? requirement.operator,
    requirement.values?.join(', '),
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div
      className={`overview-row karpenter-requirement${label ? '' : ' karpenter-requirement--custom'}`}
    >
      <span className="overview-row-label selectable">
        {label ? (
          <Tooltip
            content={<span className="selectable">{requirement.key}</span>}
            triggerLabel={`Kubernetes key for ${label}`}
            interactive
          >
            {label}
          </Tooltip>
        ) : (
          requirement.key
        )}
      </span>
      <span className="overview-row-value selectable">
        {constraint || '-'}
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
      <div className="overview-condition-list">
        {withStableListKeys(conditions, (condition) => condition.type).map(
          ({ key, value: condition }) => (
            <StatusChip
              key={key}
              variant={conditionVariants[condition.status] ?? 'warning'}
              tooltip={condition.message || condition.reason || undefined}
            >
              {condition.type}
            </StatusChip>
          )
        )}
      </div>
    </KarpenterSection>
  );
}
