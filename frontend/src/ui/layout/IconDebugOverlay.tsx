import React from 'react';

import { iconDebugEntries, type IconDebugEntry } from '@shared/components/icons/iconDebugRegistry';
import { iconDebugGridSizes, iconDebugUsages } from '@shared/components/icons/iconDebugUsageSizes';
import { DebugOverlay } from '@ui/layout/DebugOverlay';

interface IconDebugOverlayProps {
  onClose: () => void;
}

const renderIconPreview = (entry: IconDebugEntry) => {
  if (entry.kind === 'asset') {
    return <img src={entry.src} alt="" className="icon-debug__asset-preview" />;
  }

  const Icon = entry.Component;
  return <Icon {...entry.previewProps} />;
};

export const IconDebugOverlay: React.FC<IconDebugOverlayProps> = ({ onClose }) => {
  return (
    <DebugOverlay title="Icon Debug (Ctrl+Alt+I)" testId="icon-debug-overlay" onClose={onClose}>
      <div className="debug-overlay__meta">
        {iconDebugEntries.length} SVG icons and cursor assets
      </div>
      <div className="icon-debug-list">
        {iconDebugEntries.map((entry) => (
          <div key={`${entry.file}:${entry.name}`} className="icon-debug-row">
            <div className="icon-debug-row__preview" aria-hidden="true">
              {renderIconPreview(entry)}
            </div>
            <div className="icon-debug-row__details">
              <div className="icon-debug-row__header">
                <span className="icon-debug-row__name">{entry.name}</span>
                <span className="icon-debug-row__file">{entry.file}</span>
              </div>
              <div className="icon-debug-row__metrics">
                <span className="icon-debug-row__metric">
                  grid {iconDebugGridSizes[entry.name] ?? 'unknown'}
                </span>
              </div>
              <div className="icon-debug-row__usages">
                {(iconDebugUsages[entry.name] ?? []).length > 0 ? (
                  iconDebugUsages[entry.name].map((usage, index) => (
                    <span
                      key={`${usage.source}-${index}`}
                      className="icon-debug-row__usage"
                      title={`${usage.source} (${usage.basis})`}
                    >
                      <span className="icon-debug-row__usage-size">
                        rendered {usage.renderedSize}
                      </span>
                      <span className="icon-debug-row__usage-source">{usage.source}</span>
                    </span>
                  ))
                ) : (
                  <span className="icon-debug-row__usage icon-debug-row__usage--empty">
                    No production usage found
                  </span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </DebugOverlay>
  );
};
