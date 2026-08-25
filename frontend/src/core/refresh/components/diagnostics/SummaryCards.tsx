/**
 * frontend/src/core/refresh/components/diagnostics/SummaryCards.tsx
 *
 * The headline cards above the Cluster Data tree: orchestrator, metrics, event
 * stream, catalog and container-log summaries.
 */

import type React from 'react';
import type { SummaryCardData } from './diagnosticsPanelTypes';

interface DiagnosticsSummaryCardsProps {
  orchestratorSummary: SummaryCardData;
  metricsSummary: SummaryCardData;
  eventSummary: SummaryCardData;
  catalogSummary: SummaryCardData;
  logSummary: SummaryCardData;
}

export const DiagnosticsSummaryCards: React.FC<DiagnosticsSummaryCardsProps> = ({
  orchestratorSummary,
  metricsSummary,
  eventSummary,
  catalogSummary,
  logSummary,
}) => {
  return (
    <div className="diagnostics-summary">
      <SummaryCard heading="Orchestrator" data={orchestratorSummary} />
      <SummaryCard heading="Metrics" data={metricsSummary} />
      <SummaryCard heading="Events" data={eventSummary} />
      <SummaryCard heading="Catalog Stream" data={catalogSummary} />
      <SummaryCard heading="Logs" data={logSummary} />
    </div>
  );
};

interface SummaryCardProps {
  heading: string;
  data: SummaryCardData;
}

const SummaryCard: React.FC<SummaryCardProps> = ({ heading, data }) => {
  const primaryClassName = ['diagnostics-summary-primary', data.className]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="diagnostics-summary-card">
      <span className="diagnostics-summary-heading">{heading}</span>
      <span className={primaryClassName} title={data.title ?? ''}>
        {data.primary}
      </span>
      {data.secondary ? (
        <span className="diagnostics-summary-secondary" title={data.title ?? ''}>
          {data.secondary}
        </span>
      ) : null}
    </div>
  );
};
