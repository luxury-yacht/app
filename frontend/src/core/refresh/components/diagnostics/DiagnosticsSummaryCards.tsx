/**
 * frontend/src/core/refresh/components/diagnostics/DiagnosticsSummaryCards.tsx
 *
 * Summary cards for diagnostics status and telemetry.
 */
import React from 'react';
import type { SummaryCardData } from './diagnosticsPanelTypes';

interface DiagnosticsSummaryCardsProps {
  orchestratorPendingRequests: number;
  metricsSummary: SummaryCardData;
  eventSummary: SummaryCardData;
  catalogSummary: SummaryCardData;
  logSummary: SummaryCardData;
}

export const DiagnosticsSummaryCards: React.FC<DiagnosticsSummaryCardsProps> = ({
  orchestratorPendingRequests,
  metricsSummary,
  eventSummary,
  catalogSummary,
  logSummary,
}) => {
  return (
    <div className="diagnostics-summary">
      <div className="diagnostics-summary-card">
        <span className="diagnostics-summary-heading">Orchestrator</span>
        <span className="diagnostics-summary-primary">
          Pending Requests: {orchestratorPendingRequests}
        </span>
      </div>
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
  return (
    <div className="diagnostics-summary-card">
      <span className="diagnostics-summary-heading">{heading}</span>
      <span
        className={`diagnostics-summary-primary${data.className ? ` ${data.className}` : ''}`}
        title={data.title ?? ''}
      >
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
