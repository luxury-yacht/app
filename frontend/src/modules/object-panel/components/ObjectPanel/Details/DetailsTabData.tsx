import React, { useState, useMemo, useEffect } from 'react';
import { useDetailsSectionContext } from '@/core/contexts/ObjectPanelDetailsSectionContext';
import DetailsTabDataErrorBoundary from './DetailsTabDataErrorBoundary';
import { useShortcut } from '@ui/shortcuts';
import '../shared.css';
import './DetailsTabData.css';

interface DataSectionProps {
  data?: Record<string, string>;
  binaryData?: Record<string, string>;
  isSecret?: boolean;
}

const DataSectionInner: React.FC<DataSectionProps> = ({ data, binaryData, isSecret = false }) => {
  const { sectionStates, setSectionExpanded } = useDetailsSectionContext();
  const expanded = sectionStates.data;
  const [showDecoded, setShowDecoded] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Reset showDecoded when data changes (switching to a different secret)
  useEffect(() => {
    setShowDecoded(false);
  }, [data]);

  // Handle copying value to clipboard
  const handleCopyValue = (key: string, value: string) => {
    navigator.clipboard
      .writeText(value)
      .then(() => {
        setCopiedKey(key);
        // Clear the copied state after 500ms
        setTimeout(() => setCopiedKey(null), 1000);
      })
      .catch(() => {
        // Silent fallback for copy failures
      });
  };

  // Safely check if we have any data to display
  const dataKeys = useMemo(() => (data ? Object.keys(data) : []), [data]);
  const binaryKeys = useMemo(() => (binaryData ? Object.keys(binaryData) : []), [binaryData]);
  const hasData = dataKeys.length > 0 || binaryKeys.length > 0;

  // Compute displayed data based on isSecret and showDecoded state
  const displayData = useMemo(() => {
    if (!data || dataKeys.length === 0) {
      return {};
    }

    if (!isSecret || showDecoded) {
      return data;
    }

    // Encode the data to base64 for display
    const encoded: Record<string, string> = {};
    Object.entries(data).forEach(([key, value]) => {
      try {
        // Convert string to base64, handling null/undefined
        encoded[key] = value ? btoa(String(value)) : '';
      } catch (e) {
        // If encoding fails, use the original value
        encoded[key] = String(value || '');
      }
    });
    return encoded;
  }, [data, dataKeys, isSecret, showDecoded]);

  const dataCount = displayData ? Object.keys(displayData).length : 0;
  const binaryCount = binaryKeys.length;
  const totalCount = dataCount + binaryCount;

  // Add shortcut for toggling encode/decode when viewing secrets
  useShortcut({
    key: 's',
    handler: () => {
      if (isSecret && expanded) {
        setShowDecoded((prev) => !prev);
        return true;
      }
      return false;
    },
    description: 'Toggle encode/decode (when viewing secret data)',
    category: 'Object Panel',
    enabled: hasData, // Only active when data is available
    view: 'global',
    priority: isSecret && expanded ? 20 : 0,
  });

  if (!hasData) {
    return null;
  }

  return (
    <div className="object-panel-section">
      <div className="data-section-header">
        <div
          className={`object-panel-section-title collapsible${!expanded ? ' collapsed' : ''}`}
          onClick={() => setSectionExpanded('data', !expanded)}
        >
          <span className="collapse-icon">{expanded ? '▼' : '▶'}</span>
          Data
          {totalCount > 0 && <span className="metadata-count">({totalCount})</span>}
        </div>
        {isSecret && expanded && (
          <button
            className="button danger small"
            onClick={() => setShowDecoded(!showDecoded)}
            title={showDecoded ? 'Show encoded values' : 'Show decoded values'}
          >
            {showDecoded ? 'Encode' : 'Decode'}
          </button>
        )}
      </div>
      {expanded && (
        <div className="object-panel-section-grid">
          {displayData && dataCount > 0 && (
            <>
              {Object.entries(displayData).map(([key, value]) => (
                <div key={key} className="data-item">
                  <span className="data-label">{key}</span>
                  <div className="data-value-container">
                    <pre
                      className={`data-value ${copiedKey === key ? 'copied' : ''}`}
                      onClick={() => handleCopyValue(key, value)}
                      title="Click to copy"
                    >
                      {value}
                    </pre>
                    {copiedKey === key && <span className="copy-feedback">Copied</span>}
                  </div>
                </div>
              ))}
            </>
          )}
          {binaryData && binaryCount > 0 && (
            <>
              {dataCount > 0 && <div className="data-section-divider">Binary Data</div>}
              {Object.entries(binaryData).map(([key, value]) => (
                <div key={`binary-${key}`} className="data-item">
                  <span className="data-label">{key}</span>
                  <div className="data-value-container">
                    <pre
                      className={`data-value binary-data ${copiedKey === `binary-${key}` ? 'copied' : ''}`}
                      onClick={() => handleCopyValue(`binary-${key}`, value)}
                      title="Click to copy"
                    >
                      {value}
                    </pre>
                    {copiedKey === `binary-${key}` && (
                      <span className="copy-feedback">Copied!</span>
                    )}
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
};

const DataSection: React.FC<DataSectionProps> = (props) => {
  return (
    <DetailsTabDataErrorBoundary>
      <DataSectionInner {...props} />
    </DetailsTabDataErrorBoundary>
  );
};

export default DataSection;
