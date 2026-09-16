import { StatusChip, type StatusChipVariant } from '@shared/components/StatusChip';
import { withStableListKeys } from '@shared/utils/stableListKeys';

interface OverviewCondition {
  type: string;
  status?: string;
  reason?: string;
  message?: string;
}

// Families supply their semantics: a disruption condition being True does not
// mean the same thing as a readiness condition being True.
export function ConditionChips<T extends OverviewCondition>({
  conditions,
  variant,
}: Readonly<{ conditions?: readonly T[]; variant: (condition: T) => StatusChipVariant }>) {
  if (!conditions?.length) {
    return null;
  }
  return (
    <div className="overview-condition-list">
      {withStableListKeys([...conditions], (condition) => condition.type).map(({ key, value }) => (
        <StatusChip
          key={key}
          variant={variant(value)}
          tooltip={[value.status, value.message || value.reason].filter(Boolean).join(': ')}
        >
          {value.type}
        </StatusChip>
      ))}
    </div>
  );
}
