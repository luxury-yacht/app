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
    <div className="logs-viewer-warning-bar" role="status" aria-label="Log warnings">
      {warnings.join(' ')}
    </div>
  ) : null;

/**
 * A warning icon beside the toolbar while the buffer is full; its tooltip says
 * which logs are shown. It keeps the log area free of a warning line.
 */
export const LogBufferFullIndicator = ({ message }: { message: string | null }) =>
  message ? (
    <Tooltip content={message} triggerLabel="Log buffer is full">
      <span className="logs-viewer-buffer-full">
        <WarningIcon width={16} height={16} />
      </span>
    </Tooltip>
  ) : null;
