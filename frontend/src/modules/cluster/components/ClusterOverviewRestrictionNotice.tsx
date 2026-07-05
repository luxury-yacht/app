/**
 * frontend/src/modules/cluster/components/ClusterOverviewRestrictionNotice.tsx
 *
 * Standardized presentation for cluster-overview access restrictions. Every card
 * that must hide data because the current identity lacks the required Kubernetes
 * permissions renders this notice in the same place and style, so the reasons
 * read consistently, draw attention, and never truncate.
 */
import React from 'react';
import { WarningIcon } from '@shared/components/icons/SharedIcons';

export interface OverviewRestriction {
  /** Stable key for list rendering. */
  key: string;
  /** What is hidden or unavailable, e.g. "Capacity unavailable". */
  headline: string;
  /** Why it is hidden / what access is required. Wraps freely — no truncation. */
  detail: string;
  /** Optional test hook for the individual restriction row. */
  testId?: string;
}

interface ClusterOverviewRestrictionNoticeProps {
  restrictions: OverviewRestriction[];
}

/**
 * Renders one attention-drawing callout listing every access restriction that
 * applies to a card. Returns null when there are none so callers can render it
 * unconditionally.
 */
const ClusterOverviewRestrictionNotice: React.FC<ClusterOverviewRestrictionNoticeProps> = ({
  restrictions,
}) => {
  if (restrictions.length === 0) {
    return null;
  }

  return (
    <div className="overview-restriction" role="note" data-testid="cluster-overview-restriction">
      {restrictions.map((restriction) => (
        <div
          key={restriction.key}
          className="overview-restriction__item"
          data-testid={restriction.testId}
        >
          <WarningIcon width={16} height={16} className="overview-restriction__icon" ariaHidden />
          <span className="overview-restriction__headline">{restriction.headline}</span>
          <span className="overview-restriction__detail">{restriction.detail}</span>
        </div>
      ))}
    </div>
  );
};

export default ClusterOverviewRestrictionNotice;
