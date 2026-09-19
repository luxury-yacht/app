/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/DetailsTabData.tsx
 */

import { useShortcut } from '@ui/shortcuts';
import type React from 'react';
import { useEffect, useMemo, useState } from 'react';
import DetailsTabDataErrorBoundary from './DetailsTabDataErrorBoundary';
import '../shared.css';
import './DetailsTabData.css';

interface DataSectionProps {
  data?: Record<string, string>;
  binaryData?: Record<string, string>;
  isSecret?: boolean;
}

const encodeSecretValue = (value: string): string => {
  try {
    return value ? btoa(String(value)) : '';
  } catch {
    return String(value || '');
  }
};

interface DataItemProps {
  label: string;
  value: string;
  binary?: boolean;
  copied: boolean;
  onCopy: () => void;
}

const DataItem = ({ label, value, binary = false, copied, onCopy }: DataItemProps) => (
  <div className="data-item">
    <span className="data-label">{label}</span>
    <div className="data-value-container">
      <button
        type="button"
        className={`data-value ${binary ? 'binary-data ' : ''}${copied ? 'copied' : ''}`}
        onClick={onCopy}
        title="Click to copy"
      >
        {value}
      </button>
      {!!copied && <span className="copy-feedback">{binary ? 'Copied!' : 'Copied'}</span>}
    </div>
  </div>
);

const DataSectionInner: React.FC<DataSectionProps> = ({ data, binaryData, isSecret = false }) => {
  const [showDecoded, setShowDecoded] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Reset showDecoded when data changes (switching to a different secret)
  useEffect(() => {
    void data;
    setShowDecoded(false);
  }, [data]);

  // Handle copying value to clipboard
  const handleCopyValue = (key: string, value: string) => {
    navigator.clipboard
      .writeText(value)
      .then(() => {
        setCopiedKey(key);
        setTimeout(() => setCopiedKey(null), 1000);
      })
      .catch(() => {
        // Silent fallback for copy failures
      });
  };

  const dataKeys = useMemo(() => (data ? Object.keys(data) : []), [data]);
  const binaryKeys = useMemo(() => (binaryData ? Object.keys(binaryData) : []), [binaryData]);
  const hasData = dataKeys.length > 0 || binaryKeys.length > 0;
  const displayData = useMemo(() => {
    if (!data || dataKeys.length === 0) {
      return {};
    }
    if (!isSecret || showDecoded) {
      return data;
    }
    const encoded: Record<string, string> = {};
    for (const [key, value] of Object.entries(data)) {
      encoded[key] = encodeSecretValue(value);
    }
    return encoded;
  }, [data, dataKeys, isSecret, showDecoded]);
  const dataEntries = Object.entries(displayData);

  // Add shortcut for toggling encode/decode when viewing secrets
  useShortcut({
    key: 's',
    handler: () => {
      if (isSecret) {
        setShowDecoded((prev) => !prev);
        return true;
      }
      return false;
    },
    description: 'Toggle encode/decode (when viewing secret data)',
    category: 'Resource Data',
    helpOrder: 30,
    enabled: hasData, // Only active when data is available
    priority: isSecret ? 20 : 0,
  });

  if (!hasData) {
    return null;
  }

  return (
    <div className="object-panel-section">
      <div className="data-section-header">
        <div className="object-panel-section-title">Data</div>
        {!!isSecret && (
          <button
            type="button"
            className="button generic small"
            onClick={() => setShowDecoded(!showDecoded)}
            title={showDecoded ? 'Show encoded values' : 'Show decoded values'}
          >
            {showDecoded ? 'Encode' : 'Decode'}
          </button>
        )}
      </div>
      <div className="object-panel-section-grid">
        {dataEntries.map(([key, value]) => (
          <DataItem
            key={key}
            label={key}
            value={value}
            copied={copiedKey === key}
            onCopy={() => handleCopyValue(key, value)}
          />
        ))}
        {binaryData && binaryKeys.length > 0 && (
          <>
            {dataEntries.length > 0 && <div className="data-section-divider">Binary Data</div>}
            {Object.entries(binaryData).map(([key, value]) => (
              <DataItem
                key={`binary-${key}`}
                label={key}
                value={value}
                binary
                copied={copiedKey === `binary-${key}`}
                onCopy={() => handleCopyValue(`binary-${key}`, value)}
              />
            ))}
          </>
        )}
      </div>
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
