import type { OperatorCondition, OperatorLabelSelector, ResourceLink } from '@core/refresh/types';
import { ObjectPanelLink } from '@shared/components/ObjectPanelLink';
import { StatusChip, type StatusChipVariant } from '@shared/components/StatusChip';
import { resourceLinkToObjectReference } from '@shared/utils/resourceLinkIdentity';
import { withStableListKeys } from '@shared/utils/stableListKeys';
import type { ReactNode } from 'react';
import { formatFullDate } from '@/utils/ageFormatter';
import { OverviewItem } from './OverviewItem';
import './OverviewBlocks.css';
import './OperatorOverview.css';

export function OperatorSection({
  title,
  children,
}: Readonly<{ title: string; children: ReactNode }>) {
  return (
    <section className="operator-section" aria-label={title}>
      <h3 className="metadata-label">{title}</h3>
      {children}
    </section>
  );
}

export function OperatorFields({
  fields,
}: Readonly<{ fields: readonly (readonly [string, ReactNode])[] }>) {
  const visible = fields.filter(
    ([, value]) => value !== '' && value !== undefined && value !== null
  );
  return visible.length ? (
    <div className="operator-fields">
      {visible.map(([label, value]) => (
        <OverviewItem key={label} label={label} value={value} />
      ))}
    </div>
  ) : null;
}

export function OperatorCard({
  title,
  children,
}: Readonly<{ title: string; children: ReactNode }>) {
  return (
    <div className="overview-card">
      <div className="overview-card-header">
        <h4 className="overview-card-title">{title}</h4>
      </div>
      {children}
    </div>
  );
}

export function OperatorValues({
  label,
  values,
}: Readonly<{ label: string; values?: readonly string[] }>) {
  return values?.length ? (
    <div className="overview-stacked">
      <div className="operator-subtitle">{label}</div>
      <div className="overview-ref-list">
        {withStableListKeys([...values], (value) => value).map(({ key, value }) => (
          <span key={key} className="overview-ref-item">
            {value}
          </span>
        ))}
      </div>
    </div>
  ) : null;
}

export function OperatorMessage({ label, text }: Readonly<{ label: string; text?: string }>) {
  return text ? (
    <div className="overview-stacked">
      <div className="operator-subtitle">{label}</div>
      <p className="operator-message">{text}</p>
    </div>
  ) : null;
}

export function operatorLink(link?: ResourceLink) {
  if (!link) {
    return undefined;
  }
  const reference = resourceLinkToObjectReference(link);
  const name = link.ref?.name ?? link.display?.name;
  return reference ? <ObjectPanelLink objectRef={reference}>{name}</ObjectPanelLink> : name;
}

const variants: Record<string, StatusChipVariant> = {
  ready: 'healthy',
  error: 'unhealthy',
  warning: 'warning',
};

export function OperatorStatus({
  status,
  presentation,
  conditions,
}: Readonly<{ status?: string; presentation?: string; conditions?: OperatorCondition[] }>) {
  return (
    <OperatorFields
      fields={[
        [
          'Status',
          status ? (
            <StatusChip key="status" variant={variants[presentation ?? 'unknown'] ?? 'info'}>
              {status}
            </StatusChip>
          ) : undefined,
        ],
        [
          'Conditions',
          conditions?.length ? (
            <div key="conditions" className="overview-condition-list">
              {withStableListKeys(conditions, (condition) => condition.type).map(
                ({ key, value }) => (
                  <StatusChip
                    key={key}
                    variant={variants[value.presentation] ?? 'info'}
                    tooltip={[value.status, value.message || value.reason]
                      .filter(Boolean)
                      .join(': ')}
                  >
                    {value.type}
                  </StatusChip>
                )
              )}
            </div>
          ) : undefined,
        ],
      ]}
    />
  );
}

export function OperatorSelector({
  label,
  selector,
  absent = 'None',
  empty = 'All',
}: Readonly<{
  label: string;
  selector?: OperatorLabelSelector | null;
  absent?: string;
  empty?: string;
}>) {
  const values = Object.entries(selector?.matchLabels ?? {}).map(
    ([key, value]) => `${key}=${value}`
  );
  for (const expression of selector?.matchExpressions ?? []) {
    values.push(
      [expression.key, expression.operator, expression.values?.join(', ')].filter(Boolean).join(' ')
    );
  }
  const fallback = selector ? empty : absent;
  return <OperatorValues label={label} values={values.length ? values : [fallback]} />;
}

export const operatorDate = (value?: string) => (value ? formatFullDate(value) : undefined);
export const operatorBoolean = (value?: boolean) =>
  value === undefined ? undefined : String(value);
export const operatorEntries = (values?: Record<string, string>) =>
  Object.entries(values ?? {}).map(([key, value]) => `${key}=${value}`);
