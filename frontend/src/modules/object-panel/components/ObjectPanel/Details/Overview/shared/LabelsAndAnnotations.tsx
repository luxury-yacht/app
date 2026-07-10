/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/shared/LabelsAndAnnotations.tsx
 */

import { StatusChip } from '@shared/components/StatusChip';
import type React from 'react';
import { useState } from 'react';
import './LabelsAndAnnotations.css';

interface LabelsAndAnnotationsProps {
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  selectorEntries?: Record<string, string>;
}

const TRUNCATE_LENGTH = 150;

export const LabelsAndAnnotations: React.FC<LabelsAndAnnotationsProps> = ({
  labels,
  annotations,
  selectorEntries,
}) => {
  const [expandedAnnotations, setExpandedAnnotations] = useState<Set<string>>(new Set());
  const toggleAnnotationExpanded = (key: string) => {
    const newExpanded = new Set(expandedAnnotations);
    if (newExpanded.has(key)) {
      newExpanded.delete(key);
    } else {
      newExpanded.add(key);
    }
    setExpandedAnnotations(newExpanded);
  };

  const renderKeyValuePairs = (
    data: Record<string, string> | undefined,
    type: 'labels' | 'annotations'
  ) => {
    if (!data || Object.keys(data).length === 0) {
      return null;
    }

    const entries = Object.entries(data);

    return (
      <div className="metadata-section">
        <div className="metadata-label">{type === 'labels' ? 'Labels' : 'Annotations'}</div>
        <div className="metadata-pairs">
          {entries.map(([key, value]) => {
            const isAnnotation = type === 'annotations';
            const isLongValue = value.length > TRUNCATE_LENGTH;
            const isExpanded = expandedAnnotations.has(key);
            const shouldTruncate = isAnnotation && isLongValue && !isExpanded;

            let displayValue = value;
            if (shouldTruncate) {
              displayValue = `${value.substring(0, TRUNCATE_LENGTH)}... (click to expand)`;
            }

            const isSelector =
              type === 'labels' && selectorEntries && selectorEntries[key] === value;
            return (
              <div
                key={key}
                className={`metadata-pair${isSelector ? ' metadata-pair--selector' : ''}`}
              >
                <span className="metadata-key">{key}:</span>
                {isAnnotation && isLongValue ? (
                  <button
                    type="button"
                    className="metadata-value clickable"
                    onClick={() => toggleAnnotationExpanded(key)}
                    title={shouldTruncate ? 'Click to expand' : 'Click to collapse'}
                  >
                    {displayValue}
                  </button>
                ) : (
                  <span className="metadata-value">{displayValue}</span>
                )}
                {isSelector && (
                  <StatusChip
                    variant="info"
                    tooltip="This label/value pair is used to identify which pods belong to this workload."
                  >
                    Selector
                  </StatusChip>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // Don't render anything if both labels and annotations are empty
  if (
    (!labels || Object.keys(labels).length === 0) &&
    (!annotations || Object.keys(annotations).length === 0)
  ) {
    return null;
  }

  return (
    <>
      {/* Separator for metadata section */}
      <div className="metadata-section-separator" />

      {renderKeyValuePairs(labels, 'labels')}
      {renderKeyValuePairs(annotations, 'annotations')}
    </>
  );
};
