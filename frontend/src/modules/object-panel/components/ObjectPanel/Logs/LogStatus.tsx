/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Logs/LogStatus.tsx
 *
 * The error block, the warning bar and the buffer-full indicator Container Logs
 * and Node Logs share.
 */

import { ErrorSurface } from '@shared/components/errors/ErrorSurface';
import { WarningIcon } from '@shared/components/icons/SharedIcons';
import Tooltip from '@shared/components/Tooltip';
import { RETRY_HINT } from './containerLogNotices';

/** Why no logs could be shown, with the retry hint when turning auto-refresh on retries. */
export const LogErrorState = ({ message, retryHint }: { message: string; retryHint?: boolean }) => (
  <div className="logs-viewer-display-error">
    <div className="error-message">
      Error: <ErrorSurface kind="reported" message={message} />
    </div>
    {retryHint ? <div className="logs-viewer-retry-hint">{RETRY_HINT}</div> : null}
  </div>
);

/** Warnings about the shown logs, above them; nothing when there are none. */
export const LogWarningBar = ({ warnings }: { warnings: string[] }) =>
  warnings.length > 0 ? (
    <output className="logs-viewer-warning-bar" aria-label="Log warnings">
      {warnings.join(' ')}
    </output>
  ) : null;

/**
 * A warning icon beside the toolbar once the buffer has dropped logs; its
 * tooltip says how many are shown. Only the buffer size is known, so the full
 * log may be larger. `shown` is null while nothing has been dropped.
 */
export const LogBufferFullIndicator = ({ shown }: { shown: number | null }) =>
  shown === null ? null : (
    <Tooltip
      content={`Log buffer is full. Only showing the most recent ${shown} ${shown === 1 ? 'log' : 'logs'}.`}
      triggerLabel="Log buffer is full"
    >
      <span className="logs-viewer-buffer-full">
        <WarningIcon width={16} height={16} />
      </span>
    </Tooltip>
  );
