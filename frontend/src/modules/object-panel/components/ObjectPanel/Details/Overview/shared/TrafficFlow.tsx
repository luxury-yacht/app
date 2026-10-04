/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/shared/TrafficFlow.tsx
 *
 * Shared building blocks for Overview sections that show where traffic is allowed or routed
 * (NetworkPolicy, Ingress, Gateway API routes): a coloured section, one card per rule, and inside
 * each card a flow of endpoint boxes — from → arrow (with optional labels such as ports) → to.
 * Endpoint boxes read as sentences: a bold subject, mono terms, and a secondary scope line. The
 * boxes reuse the ReferenceGrant diagram styles in OverviewBlocks.css.
 */

import { withStableListKeys } from '@shared/utils/stableListKeys';
import type React from 'react';
import { Fragment } from 'react';
import './OverviewBlocks.css';
import './TrafficFlow.css';

/** Inbound traffic (ingress, routed requests) is blue; outbound (egress) is purple. */
export type TrafficFlowTone = 'inbound' | 'outbound';

/** `directional` marks the heading with the tone's dot, for views that show more than one direction. */
export const TrafficFlowSection: React.FC<{
  label: string;
  tone: TrafficFlowTone;
  directional?: boolean;
  children: React.ReactNode;
}> = ({ label, tone, directional, children }) => (
  <section
    className={`traffic-flow-section traffic-flow-section--${tone}${directional ? ' traffic-flow-section--directional' : ''}`}
    aria-label={label}
  >
    <h3 className="metadata-label">{label}</h3>
    {children}
  </section>
);

export const TrafficFlowRules: React.FC<{ label: string; children: React.ReactNode }> = ({
  label,
  children,
}) => (
  <ol className="traffic-flow-list traffic-flow-rules" aria-label={label}>
    {children}
  </ol>
);

export const TrafficFlowRule: React.FC<{ title: React.ReactNode; children: React.ReactNode }> = ({
  title,
  children,
}) => (
  <li className="traffic-flow-rule traffic-flow-card">
    <div className="traffic-flow-rule-title">{title}</div>
    {children}
  </li>
);

/** A card holding one flow without a rule title. */
export const TrafficFlowCard: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="traffic-flow-card">{children}</div>
);

/** A card for a direction that allows no traffic at all; its edge is red instead of the tone. */
export const TrafficFlowDeniedCard: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="traffic-flow-card traffic-flow-card--denied">{children}</div>
);

export const TrafficFlow: React.FC<{
  from: React.ReactNode;
  middle: React.ReactNode;
  to: React.ReactNode;
}> = ({ from, middle, to }) => (
  <div className="reference-grant-diagram traffic-flow">
    {from}
    {middle}
    {to}
  </div>
);

/**
 * One side of a flow. Separate endpoints are alternatives; conditions inside one apply together.
 * `fit` sizes the side to its content so the other side gets the remaining width.
 */
export const FlowEndpoints: React.FC<{
  label: string;
  fit?: boolean;
  children: React.ReactNode;
}> = ({ label, fit, children }) => (
  <ul
    className={`reference-grant-side-stack traffic-flow-list${fit ? ' traffic-flow-fit' : ''}`}
    aria-label={label}
  >
    {children}
  </ul>
);

/** One entry in a FlowEntries list: an optional title line above a mono detail line. */
export const FlowEntry: React.FC<{ title?: React.ReactNode; children: React.ReactNode }> = ({
  title,
  children,
}) => (
  <li>
    {!!title && <FlowSubject>{title}</FlowSubject>}
    <div className="reference-grant-item">{children}</div>
  </li>
);

/** A list of entries inside one endpoint box (e.g. every port of a Service). */
export const FlowEntries: React.FC<{ label: string; children: React.ReactNode }> = ({
  label,
  children,
}) => (
  <ul className="traffic-flow-list traffic-flow-entries" aria-label={label}>
    {children}
  </ul>
);

/**
 * An endpoint box. `target` outlines it in the section's tone (the object's own side); `warning`
 * marks endpoints that do not take traffic (e.g. not-ready addresses) with a dashed red edge.
 */
export const FlowEndpoint: React.FC<{
  target?: boolean;
  warning?: boolean;
  children: React.ReactNode;
}> = ({ target, warning, children }) => {
  let className = 'reference-grant-side';
  if (warning) {
    className += ' traffic-flow-warning';
  } else if (target) {
    className += ' traffic-flow-target';
  }
  return <li className={className}>{children}</li>;
};

export const FlowSubject: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="traffic-flow-subject">{children}</div>
);

export const FlowScope: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="traffic-flow-scope">{children}</div>
);

/**
 * Lets a long term wrap after "/", "=", ".", or ":" (selector keys, DNS names, IP addresses)
 * instead of mid-word. Lines fill greedily, so a later break such as "app.kubernetes.io/" wins
 * whenever it fits. The breaks are <wbr>, so copied text is unchanged.
 */
const WrappingTerm: React.FC<{ term: string }> = ({ term }) => {
  const parts = (term.match(/[^/=.:]*[/=.:]?/g) ?? []).filter(Boolean);
  return (
    <>
      {withStableListKeys(parts, (part) => part).map(({ key, value }, index) => (
        <Fragment key={key}>
          {index > 0 && <wbr />}
          {value}
        </Fragment>
      ))}
    </>
  );
};

/** An inline mono term (name, address, value) inside a subject or scope line. */
export const FlowTerm: React.FC<{ children: string | number }> = ({ children }) => (
  <span className="traffic-flow-term">
    <WrappingTerm term={String(children)} />
  </span>
);

/** Mono terms, one per line (selector terms, paths). */
export const FlowTermLines: React.FC<{ terms: string[] }> = ({ terms }) => (
  <>
    {withStableListKeys(terms, (term) => term).map(({ key, value }) => (
      <div key={key} className="reference-grant-item">
        <WrappingTerm term={value} />
      </div>
    ))}
  </>
);

/** The arrow between the two sides, with optional labels (e.g. ports) as pills under it. */
export const FlowArrow: React.FC<{ label?: string; items?: string[] }> = ({ label, items }) => (
  <div
    className={
      items?.length ? 'traffic-flow-arrow traffic-flow-arrow--labelled' : 'traffic-flow-arrow'
    }
  >
    <span className="reference-grant-arrow" aria-hidden="true">
      →
    </span>
    {!!items?.length && (
      <ul className="traffic-flow-list traffic-flow-pills" aria-label={label}>
        {withStableListKeys(items, (item) => item).map(({ key, value }) => (
          <li key={key}>{value}</li>
        ))}
      </ul>
    )}
  </div>
);

export const FlowDenied: React.FC = () => (
  <div className="traffic-flow-arrow traffic-flow-denied">
    <span className="reference-grant-arrow" aria-hidden="true">
      ✕
    </span>
    <span>denied</span>
  </div>
);
