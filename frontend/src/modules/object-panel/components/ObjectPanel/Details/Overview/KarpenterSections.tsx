import { StatusChip, type StatusChipVariant } from '@shared/components/StatusChip';
import { withStableListKeys } from '@shared/utils/stableListKeys';
import type { ReactNode } from 'react';
import type { ConditionFacts, KarpenterFacts, KarpenterTaint } from '@/core/refresh/types';
import { OverviewItem } from './shared/OverviewItem';
import './shared/OverviewBlocks.css';
import './KarpenterOverview.css';

export function KarpenterSection({
  title,
  children,
}: Readonly<{ title: string; children: ReactNode }>) {
  return (
    <section className="karpenter-overview-section" aria-label={title}>
      <h3 className="metadata-label">{title}</h3>
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

export function KarpenterCapacity({ facts }: Readonly<{ facts: KarpenterFacts }>) {
  const resources = [
    ...new Set([
      ...Object.keys(facts.capacity ?? {}),
      ...Object.keys(facts.allocatable ?? {}),
      ...Object.keys(facts.limits ?? {}),
    ]),
  ].sort();
  if (!resources.length) {
    return null;
  }
  return (
    <KarpenterSection title="Capacity">
      {resources.map((resource) => (
        <div className="overview-row" key={resource}>
          <span className="overview-row-label">{resource}</span>
          <div className="overview-row-value karpenter-capacity-values">
            {facts.capacity?.[resource] !== undefined && (
              <span>
                {facts.capacity[resource]} <span className="karpenter-fact-caption">capacity</span>
              </span>
            )}
            {facts.allocatable?.[resource] !== undefined && (
              <span>
                {facts.allocatable[resource]}{' '}
                <span className="karpenter-fact-caption">allocatable</span>
              </span>
            )}
            {facts.limits?.[resource] !== undefined && (
              <span>
                {facts.limits[resource]} <span className="karpenter-fact-caption">limit</span>
              </span>
            )}
          </div>
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
    <section className="overview-stacked" aria-label={label}>
      <div className="karpenter-overview-subtitle">{label}</div>
      <div className="overview-row-list">
        {withStableListKeys(taints, (taint) => JSON.stringify(taint)).map(
          ({ key, value: taint }) => (
            <div className="overview-row" key={key}>
              <span className="overview-row-label">{taint.key}</span>
              <span className="overview-row-value">
                {!!taint.value && <span>{taint.value} · </span>}
                {taint.effect}
              </span>
            </div>
          )
        )}
      </div>
    </section>
  );
}

export function KarpenterScheduling({ facts }: Readonly<{ facts: KarpenterFacts }>) {
  if (!facts.requirements?.length && !facts.taints?.length && !facts.startupTaints?.length) {
    return null;
  }
  return (
    <KarpenterSection title="Scheduling">
      {!!facts.requirements?.length && (
        <section className="overview-stacked" aria-label="Requirements">
          <div className="karpenter-overview-subtitle">Requirements</div>
          <div className="overview-row-list">
            {withStableListKeys(facts.requirements, (requirement) => requirement.key).map(
              ({ key, value: requirement }) => (
                <div className="overview-row karpenter-requirement" key={key}>
                  <span className="overview-row-label">{requirement.key}</span>
                  <span className="overview-row-value">
                    <span className="karpenter-fact-caption">{requirement.operator} </span>
                    {requirement.values?.join(', ')}
                    {requirement.minValues !== undefined && (
                      <span className="karpenter-fact-caption">
                        {' '}
                        (min values: {requirement.minValues})
                      </span>
                    )}
                  </span>
                </div>
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
