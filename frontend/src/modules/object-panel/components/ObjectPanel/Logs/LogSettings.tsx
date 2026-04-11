import { useState } from 'react';
import Tooltip from '@shared/components/Tooltip';
import {
  getLogApiTimestampFormat,
  getLogApiTimestampUseLocalTimeZone,
  getLogBufferMaxSize,
  getLogTargetGlobalLimit,
  getLogTargetPerScopeLimit,
  setLogApiTimestampFormat,
  setLogApiTimestampUseLocalTimeZone,
  setLogBufferMaxSize,
  setLogTargetGlobalLimit,
  setLogTargetPerScopeLimit,
  LOG_BUFFER_DEFAULT_SIZE,
  LOG_BUFFER_MAX_SIZE,
  LOG_BUFFER_MIN_SIZE,
  LOG_TARGET_GLOBAL_DEFAULT,
  LOG_TARGET_GLOBAL_MAX,
  LOG_TARGET_GLOBAL_MIN,
  LOG_TARGET_PER_SCOPE_DEFAULT,
  LOG_TARGET_PER_SCOPE_MAX,
  LOG_TARGET_PER_SCOPE_MIN,
} from '@core/settings/appPreferences';
import { getLogApiTimestampFormatValidationError } from '@/utils/logApiTimestampFormat';
import '@ui/settings/Settings.css';
import './LogSettings.css';

function LogSettings() {
  const [logBufferMaxSizeInput, setLogBufferMaxSizeInput] = useState<string>(() =>
    String(getLogBufferMaxSize())
  );
  const [logApiTimestampFormatInput, setLogApiTimestampFormatInput] = useState<string>(() =>
    getLogApiTimestampFormat()
  );
  const [logApiTimestampUseLocalTimeZone, setLogApiTimestampUseLocalTimeZoneState] =
    useState<boolean>(() => getLogApiTimestampUseLocalTimeZone());
  const [logApiTimestampFormatError, setLogApiTimestampFormatError] = useState<string | null>(null);
  const [logTargetPerScopeLimitInput, setLogTargetPerScopeLimitInput] = useState<string>(() =>
    String(getLogTargetPerScopeLimit())
  );
  const [logTargetGlobalLimitInput, setLogTargetGlobalLimitInput] = useState<string>(() =>
    String(getLogTargetGlobalLimit())
  );

  const commitLogBufferMaxSize = (raw: string) => {
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed)) {
      setLogBufferMaxSizeInput(String(getLogBufferMaxSize()));
      return;
    }
    const clamped = Math.max(LOG_BUFFER_MIN_SIZE, Math.min(LOG_BUFFER_MAX_SIZE, parsed));
    setLogBufferMaxSize(clamped);
    setLogBufferMaxSizeInput(String(clamped));
  };

  const commitLogTargetPerScopeLimit = (raw: string) => {
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed)) {
      setLogTargetPerScopeLimitInput(String(getLogTargetPerScopeLimit()));
      return;
    }
    const clamped = Math.max(LOG_TARGET_PER_SCOPE_MIN, Math.min(LOG_TARGET_PER_SCOPE_MAX, parsed));
    setLogTargetPerScopeLimit(clamped);
    setLogTargetPerScopeLimitInput(String(clamped));
  };

  const commitLogTargetGlobalLimit = (raw: string) => {
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed)) {
      setLogTargetGlobalLimitInput(String(getLogTargetGlobalLimit()));
      return;
    }
    const clamped = Math.max(LOG_TARGET_GLOBAL_MIN, Math.min(LOG_TARGET_GLOBAL_MAX, parsed));
    setLogTargetGlobalLimit(clamped);
    setLogTargetGlobalLimitInput(String(clamped));
  };

  const commitLogApiTimestampFormat = (raw: string) => {
    const validationError = getLogApiTimestampFormatValidationError(raw);
    if (validationError) {
      setLogApiTimestampFormatError(validationError);
      return;
    }
    const normalized = raw.trim();
    setLogApiTimestampFormat(normalized);
    setLogApiTimestampFormatInput(normalized);
    setLogApiTimestampFormatError(null);
  };

  return (
    <div className="settings-view log-settings-view">
      <div className="settings-section">
        <h3>Pod Logs</h3>
        <div className="settings-items">
          <div className="setting-item setting-item-inline">
            <label htmlFor="log-buffer-max-size">Log buffer size </label>
            <input
              type="number"
              id="log-buffer-max-size"
              min={LOG_BUFFER_MIN_SIZE}
              max={LOG_BUFFER_MAX_SIZE}
              step={100}
              value={logBufferMaxSizeInput}
              onChange={(e) => setLogBufferMaxSizeInput(e.target.value)}
              onBlur={(e) => commitLogBufferMaxSize(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  commitLogBufferMaxSize((e.target as HTMLInputElement).value);
                }
              }}
              data-log-settings-focusable="true"
            />
            <Tooltip
              content={
                <>
                  <p className="log-settings-tooltip-paragraph">
                    Max number of logs in the pod logs viewer. Larger values use more memory but
                    give deeper scrollback.
                  </p>
                  <p className="log-settings-tooltip-paragraph">
                    Range {LOG_BUFFER_MIN_SIZE}-{LOG_BUFFER_MAX_SIZE}, default{' '}
                    {LOG_BUFFER_DEFAULT_SIZE}
                  </p>
                </>
              }
              variant="dark"
            />
          </div>
          <div className="setting-item log-settings-target-limits">
            <div className="log-settings-target-limits-grid">
              <div className="log-settings-target-limits-title">
                <span>Max containers</span>
              </div>
              <label
                htmlFor="log-target-per-scope-limit"
                className="log-settings-target-limits-row"
              >
                Per tab
              </label>
              <div className="log-settings-target-limits-control">
                <input
                  type="number"
                  id="log-target-per-scope-limit"
                  min={LOG_TARGET_PER_SCOPE_MIN}
                  max={LOG_TARGET_PER_SCOPE_MAX}
                  step={1}
                  value={logTargetPerScopeLimitInput}
                  onChange={(e) => setLogTargetPerScopeLimitInput(e.target.value)}
                  onBlur={(e) => commitLogTargetPerScopeLimit(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      commitLogTargetPerScopeLimit((e.target as HTMLInputElement).value);
                    }
                  }}
                  data-log-settings-focusable="true"
                />
                <Tooltip
                  content={
                    <>
                      <p className="log-settings-tooltip-paragraph">
                        Limits how many pod/container log targets a single Logs tab can stream or
                        fetch at once.
                      </p>
                      <p className="log-settings-tooltip-paragraph">
                        Range {LOG_TARGET_PER_SCOPE_MIN}-{LOG_TARGET_PER_SCOPE_MAX}, default{' '}
                        {LOG_TARGET_PER_SCOPE_DEFAULT}
                      </p>
                    </>
                  }
                  variant="dark"
                />
              </div>
              <label htmlFor="log-target-global-limit" className="log-settings-target-limits-row">
                Global
              </label>
              <div className="log-settings-target-limits-control">
                <input
                  type="number"
                  id="log-target-global-limit"
                  min={LOG_TARGET_GLOBAL_MIN}
                  max={LOG_TARGET_GLOBAL_MAX}
                  step={1}
                  value={logTargetGlobalLimitInput}
                  onChange={(e) => setLogTargetGlobalLimitInput(e.target.value)}
                  onBlur={(e) => commitLogTargetGlobalLimit(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      commitLogTargetGlobalLimit((e.target as HTMLInputElement).value);
                    }
                  }}
                  data-log-settings-focusable="true"
                />
                <Tooltip
                  content={
                    <>
                      <p className="log-settings-tooltip-paragraph">
                        Limits how many pod/container log targets can be shared across all open Logs
                        tabs.
                      </p>
                      <p className="log-settings-tooltip-paragraph">
                        Range {LOG_TARGET_GLOBAL_MIN}-{LOG_TARGET_GLOBAL_MAX}, default{' '}
                        {LOG_TARGET_GLOBAL_DEFAULT}
                      </p>
                    </>
                  }
                  variant="dark"
                />
              </div>
            </div>
          </div>
          <div className="setting-item log-settings-timestamp">
            <div className="log-settings-timestamp-grid">
              <div className="log-settings-timestamp-title">API Timestamps</div>
              <label
                htmlFor="log-api-timestamp-local-time-zone"
                className="log-settings-timestamp-checkbox"
              >
                <input
                  type="checkbox"
                  id="log-api-timestamp-local-time-zone"
                  checked={logApiTimestampUseLocalTimeZone}
                  onChange={(e) => {
                    const enabled = e.target.checked;
                    setLogApiTimestampUseLocalTimeZoneState(enabled);
                    setLogApiTimestampUseLocalTimeZone(enabled);
                  }}
                  data-log-settings-focusable="true"
                />
                Use local time zone
              </label>
              <span className="log-settings-timestamp-control">
                <Tooltip
                  content="Formats Kubernetes API timestamps using this machine's local timezone instead of UTC."
                  variant="dark"
                />
              </span>
              <label
                htmlFor="log-api-timestamp-format"
                className="log-settings-timestamp-format-label"
              >
                Format
              </label>
              <div className="log-settings-timestamp-control">
                <input
                  type="text"
                  id="log-api-timestamp-format"
                  value={logApiTimestampFormatInput}
                  onChange={(e) => {
                    setLogApiTimestampFormatInput(e.target.value);
                    if (logApiTimestampFormatError) {
                      setLogApiTimestampFormatError(null);
                    }
                  }}
                  onBlur={(e) => commitLogApiTimestampFormat(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      commitLogApiTimestampFormat((e.target as HTMLInputElement).value);
                    }
                  }}
                  className={logApiTimestampFormatError ? 'setting-input-error' : undefined}
                  aria-invalid={logApiTimestampFormatError ? 'true' : 'false'}
                  data-log-settings-focusable="true"
                />
                <Tooltip
                  content={
                    <>
                      <p className="log-settings-tooltip-paragraph">
                        Day.js pattern used for the Kubernetes API timestamp shown in pod logs.
                      </p>
                      <p className="log-settings-tooltip-paragraph">
                        Examples: <code>YYYY-MM-DDTHH:mm:ss.SSS[Z]</code>, <code>HH:mm:ss.SSS</code>
                        , <code>[ts=]HH:mm:ss.SSS</code>, <code>YYYY-MM-DD HH:mm:ss Z</code>
                      </p>
                      <p className="log-settings-tooltip-paragraph">
                        Wrap literal text in square brackets. Unsupported tokens are rejected.
                      </p>
                      <p className="log-settings-tooltip-paragraph">
                        Use <code>Z</code> or <code>ZZ</code> if you want the timezone offset shown
                        in local-time mode.
                      </p>
                    </>
                  }
                  variant="dark"
                />
              </div>
              {logApiTimestampFormatError ? (
                <div
                  className="setting-item-message setting-item-error log-settings-timestamp-error"
                  role="alert"
                >
                  {logApiTimestampFormatError}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default LogSettings;
