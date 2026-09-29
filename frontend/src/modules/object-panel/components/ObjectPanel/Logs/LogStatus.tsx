/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Logs/LogStatus.tsx
 *
 * The error block and the warning bar Container Logs and Node Logs share.
 */

import { ErrorSurface } from '@shared/components/errors/ErrorSurface';
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
