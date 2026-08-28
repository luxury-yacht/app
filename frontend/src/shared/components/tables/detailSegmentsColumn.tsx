/**
 * frontend/src/shared/components/tables/detailSegmentsColumn.tsx
 *
 * Shared column factory for backend DetailSegment lists — the typed Details
 * contract multi-kind tables use instead of a preformatted string. A column
 * can filter to one semantic slot (the backend tags each segment with
 * reference/address/counts), so a view renders several aligned slot columns
 * from one row field. The chips variant renders each segment as a subtle chip
 * (counts/status); the text variant renders plain separated values
 * (reference/address columns). Resolvable ResourceLink segments become
 * cross-object link buttons; backend presentation tokens map to CSS classes
 * at the edge; collapsed list values carry their full text in the tooltip.
 */

import type {
  ColumnWidthInput,
  GridColumnDefinition,
} from '@shared/components/tables/GridTable.types';
import {
  backendStatusClass,
  backendStatusTextClass,
} from '@shared/utils/backendStatusPresentation';
import type { ResolvedObjectReference } from '@shared/utils/objectIdentity';
import { resourceLinkToObjectReference } from '@shared/utils/resourceLinkIdentity';
import type React from 'react';
import type { DetailSegment } from '@/core/refresh/types';
import './detailSegmentsColumn.css';

const detailSegmentText = (segment: DetailSegment): string =>
  segment.label ? `${segment.label}: ${segment.value}` : segment.value;

const detailSegmentSearchText = (segment: DetailSegment): string => {
  if (!segment.search) {
    return detailSegmentText(segment);
  }
  return segment.label ? `${segment.label}: ${segment.search}` : segment.search;
};

/**
 * Flattens displayed segments to one line, matching the backend's
 * DetailSegmentsText for export. Tooltips expand collapsed values separately.
 */
export const detailSegmentsText = (segments: DetailSegment[] | undefined): string =>
  (segments ?? []).map(detailSegmentText).join(', ');

export interface CreateDetailSegmentsColumnOptions<T> {
  key?: string;
  header?: string;
  getSegments?: (item: T) => DetailSegment[] | undefined;
  /** Renders only the segments tagged with this backend slot. */
  slot?: string;
  /** 'chips' (default) wraps each segment in a chip; 'text' renders plain separated values. */
  variant?: 'chips' | 'text';
  /** Opens a segment's linked object; link segments render inert without it. */
  openReference?: (reference: ResolvedObjectReference) => void;
  /** Alt+click handler — navigates to the linked object's view. */
  navigateReference?: (reference: ResolvedObjectReference) => void;
  /** Cluster display name attached to resolved references. */
  clusterName?: string | null;
  className?: string;
  sortable?: boolean;
  autoSizeMaxWidth?: ColumnWidthInput;
}

export function createDetailSegmentsColumn<T>(
  options: CreateDetailSegmentsColumnOptions<T> = {}
): GridColumnDefinition<T> {
  const getSegments =
    options.getSegments ?? ((item: T) => (item as { details?: DetailSegment[] }).details);

  const renderSegmentValue = (segment: DetailSegment, segmentKey: string): React.ReactNode => {
    const reference = segment.link
      ? resourceLinkToObjectReference(segment.link, options.clusterName)
      : undefined;

    if (reference && options.openReference) {
      const open = options.openReference;
      return (
        <button
          key={`${segmentKey}-value`}
          type="button"
          className="gridtable-cell-button gridtable-link object-panel-link detail-segment-value"
          data-gridtable-shortcut-optout="true"
          data-gridtable-rowclick="suppress"
          onClick={(event) => {
            if (event.altKey && options.navigateReference) {
              event.preventDefault();
              event.stopPropagation();
              options.navigateReference(reference);
            } else {
              open(reference);
            }
          }}
        >
          {segment.value}
        </button>
      );
    }

    const presentationClass = segment.presentation
      ? ` ${backendStatusTextClass(segment.presentation)}`
      : '';
    return (
      <span key={`${segmentKey}-value`} className={`detail-segment-value${presentationClass}`}>
        {segment.value}
      </span>
    );
  };

  return {
    key: options.key ?? 'details',
    header: options.header ?? 'Details',
    className: options.className,
    sortable: options.sortable ?? false,
    autoSizeMaxWidth: options.autoSizeMaxWidth,
    // No measurementText/measurementElement: the auto-width measurer's fallback
    // clones the rendered cell with its classNames, so chip padding, borders,
    // and gaps are part of the measured width.
    render: (item) => {
      const all = getSegments(item) ?? [];
      const segments = options.slot ? all.filter((segment) => segment.slot === options.slot) : all;
      if (segments.length === 0) {
        return '-';
      }
      const flatText = detailSegmentsText(segments);
      const titleText = segments.map(detailSegmentSearchText).join(', ');
      const text = options.variant === 'text';
      const containerClassName = [
        'detail-segments',
        text ? 'detail-segments--text' : undefined,
        options.className,
      ]
        .filter(Boolean)
        .join(' ');
      return (
        <span
          className={containerClassName}
          title={titleText}
          data-gridtable-export-text={flatText}
        >
          {segments.map((segment, index) => {
            const segmentKey = `${index}:${segment.label ?? ''}`;
            const presentationClass = segment.presentation
              ? `--${backendStatusClass(segment.presentation)}`
              : '';
            if (text) {
              return (
                <span key={segmentKey} className="detail-segment-text">
                  {index > 0 ? <span className="detail-segment-separator">{' · '}</span> : null}
                  {segment.label ? (
                    <span className="detail-segment-label">{`${segment.label}:`}</span>
                  ) : null}
                  {renderSegmentValue(segment, segmentKey)}
                </span>
              );
            }
            return (
              <span
                key={segmentKey}
                className={`detail-segment${presentationClass ? ` detail-segment${presentationClass}` : ''}`}
              >
                {segment.label ? (
                  <span className="detail-segment-label">{segment.label}</span>
                ) : null}
                {renderSegmentValue(segment, segmentKey)}
              </span>
            );
          })}
        </span>
      );
    },
  };
}
