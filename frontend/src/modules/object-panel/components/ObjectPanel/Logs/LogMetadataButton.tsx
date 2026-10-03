/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Logs/LogMetadataButton.tsx
 *
 * A pod or container name in a container log line or table row; clicking it
 * narrows the logs to that pod or container. It stays out of the Tab order so
 * keyboard focus moves between the viewer's controls, not every log line.
 */

import type React from 'react';

interface LogMetadataButtonProps {
  subject: 'pod' | 'container';
  /** The name the accessible label uses. */
  name: string;
  /** What the button shows; defaults to the name. */
  text?: string;
  /** Workload views color a pod's metadata with the pod's color. */
  podColor?: string;
  onSelect: (event: React.MouseEvent<HTMLButtonElement>) => void;
}

export const LogMetadataButton = ({
  subject,
  name,
  text = name,
  podColor,
  onSelect,
}: LogMetadataButtonProps) => {
  const label = `Show only logs from ${subject} ${name}`;
  const colored = podColor !== undefined;
  return (
    <button
      type="button"
      className={
        colored ? 'log-viewer-metadata-button pod-color-text' : 'log-viewer-metadata-button'
      }
      tabIndex={-1}
      data-focus-trap-ignore="true"
      style={colored ? ({ '--pod-color': podColor } as React.CSSProperties) : undefined}
      onClick={onSelect}
      title={label}
      aria-label={label}
    >
      {text}
    </button>
  );
};
