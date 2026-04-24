import { useMemo, useState } from 'react';
import Tooltip from '@shared/components/Tooltip';
import { BrowserOpenURL } from '@wailsjs/runtime/runtime';
import {
  getObjPanelLogsApiTimestampFormat,
  getObjPanelLogsApiTimestampUseLocalTimeZone,
  getObjPanelLogsBufferMaxSize,
  getObjPanelLogsTargetGlobalLimit,
  getObjPanelLogsTargetPerScopeLimit,
  setObjPanelLogsApiTimestampFormat,
  setObjPanelLogsApiTimestampUseLocalTimeZone,
  setObjPanelLogsBufferMaxSize,
  setObjPanelLogsTargetGlobalLimit,
  setObjPanelLogsTargetPerScopeLimit,
  OBJ_PANEL_LOGS_BUFFER_DEFAULT_SIZE,
  OBJ_PANEL_LOGS_BUFFER_MAX_SIZE,
  OBJ_PANEL_LOGS_BUFFER_MIN_SIZE,
  OBJ_PANEL_LOGS_TARGET_GLOBAL_DEFAULT,
  OBJ_PANEL_LOGS_TARGET_GLOBAL_MAX,
  OBJ_PANEL_LOGS_TARGET_GLOBAL_MIN,
  OBJ_PANEL_LOGS_TARGET_PER_SCOPE_DEFAULT,
  OBJ_PANEL_LOGS_TARGET_PER_SCOPE_MAX,
  OBJ_PANEL_LOGS_TARGET_PER_SCOPE_MIN,
} from '@core/settings/appPreferences';
import {
  formatObjPanelLogsApiTimestamp,
  getObjPanelLogsApiTimestampFormatValidationError,
} from '@/utils/objPanelLogsApiTimestampFormat';
import '@ui/settings/Settings.css';
import './ObjPanelLogsSettings.css';

const LOG_API_TIMESTAMP_EXAMPLE = '2026-04-11T12:34:55.000Z';

function ObjPanelLogsSettings() {
  const [objPanelLogsBufferMaxSizeInput, setObjPanelLogsBufferMaxSizeInput] = useState<string>(() =>
    String(getObjPanelLogsBufferMaxSize())
  );
  const [objPanelLogsApiTimestampFormatInput, setObjPanelLogsApiTimestampFormatInput] =
    useState<string>(() => getObjPanelLogsApiTimestampFormat());
  const [
    objPanelLogsApiTimestampUseLocalTimeZone,
    setObjPanelLogsApiTimestampUseLocalTimeZoneState,
  ] = useState<boolean>(() => getObjPanelLogsApiTimestampUseLocalTimeZone());
  const [objPanelLogsApiTimestampFormatError, setObjPanelLogsApiTimestampFormatError] = useState<
    string | null
  >(null);
  const [objPanelLogsTargetPerScopeLimitInput, setObjPanelLogsTargetPerScopeLimitInput] =
    useState<string>(() => String(getObjPanelLogsTargetPerScopeLimit()));
  const [objPanelLogsTargetGlobalLimitInput, setObjPanelLogsTargetGlobalLimitInput] =
    useState<string>(() => String(getObjPanelLogsTargetGlobalLimit()));
  const objPanelLogsApiTimestampPreview = useMemo(() => {
    const validationError = getObjPanelLogsApiTimestampFormatValidationError(
      objPanelLogsApiTimestampFormatInput
    );
    if (validationError) {
      return null;
    }
    return formatObjPanelLogsApiTimestamp(
      LOG_API_TIMESTAMP_EXAMPLE,
      objPanelLogsApiTimestampFormatInput.trim(),
      objPanelLogsApiTimestampUseLocalTimeZone
    );
  }, [objPanelLogsApiTimestampFormatInput, objPanelLogsApiTimestampUseLocalTimeZone]);

  const commitObjPanelLogsBufferMaxSize = (raw: string) => {
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed)) {
      setObjPanelLogsBufferMaxSizeInput(String(getObjPanelLogsBufferMaxSize()));
      return;
    }
    const clamped = Math.max(
      OBJ_PANEL_LOGS_BUFFER_MIN_SIZE,
      Math.min(OBJ_PANEL_LOGS_BUFFER_MAX_SIZE, parsed)
    );
    setObjPanelLogsBufferMaxSize(clamped);
    setObjPanelLogsBufferMaxSizeInput(String(clamped));
  };

  const commitObjPanelLogsTargetPerScopeLimit = (raw: string) => {
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed)) {
      setObjPanelLogsTargetPerScopeLimitInput(String(getObjPanelLogsTargetPerScopeLimit()));
      return;
    }
    const clamped = Math.max(
      OBJ_PANEL_LOGS_TARGET_PER_SCOPE_MIN,
      Math.min(OBJ_PANEL_LOGS_TARGET_PER_SCOPE_MAX, parsed)
    );
    setObjPanelLogsTargetPerScopeLimit(clamped);
    setObjPanelLogsTargetPerScopeLimitInput(String(clamped));
  };

  const commitObjPanelLogsTargetGlobalLimit = (raw: string) => {
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed)) {
      setObjPanelLogsTargetGlobalLimitInput(String(getObjPanelLogsTargetGlobalLimit()));
      return;
    }
    const clamped = Math.max(
      OBJ_PANEL_LOGS_TARGET_GLOBAL_MIN,
      Math.min(OBJ_PANEL_LOGS_TARGET_GLOBAL_MAX, parsed)
    );
    setObjPanelLogsTargetGlobalLimit(clamped);
    setObjPanelLogsTargetGlobalLimitInput(String(clamped));
  };

  const commitObjPanelLogsApiTimestampFormat = (raw: string) => {
    const validationError = getObjPanelLogsApiTimestampFormatValidationError(raw);
    if (validationError) {
      setObjPanelLogsApiTimestampFormatError(validationError);
      return;
    }
    const normalized = raw.trim();
    setObjPanelLogsApiTimestampFormat(normalized);
    setObjPanelLogsApiTimestampFormatInput(normalized);
    setObjPanelLogsApiTimestampFormatError(null);
  };

  return (
    <div className="settings-view obj-panel-logs-settings-view">
      <div className="settings-section">
        <h3>Constraints</h3>
        <div className="settings-items">
          <div className="setting-item setting-item-inline">
            <label htmlFor="obj-panel-logs-buffer-max-size">
              Object Panel Logs Tab buffer size{' '}
            </label>
            <input
              type="number"
              id="obj-panel-logs-buffer-max-size"
              min={OBJ_PANEL_LOGS_BUFFER_MIN_SIZE}
              max={OBJ_PANEL_LOGS_BUFFER_MAX_SIZE}
              step={100}
              value={objPanelLogsBufferMaxSizeInput}
              onChange={(e) => setObjPanelLogsBufferMaxSizeInput(e.target.value)}
              onBlur={(e) => commitObjPanelLogsBufferMaxSize(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  e.currentTarget.blur();
                }
              }}
              data-obj-panel-logs-settings-focusable="true"
            />
            <Tooltip
              content={
                <>
                  <p className="obj-panel-logs-settings-tooltip-paragraph">
                    Max number of log rows kept by each Object Panel Logs Tab. Larger values use
                    more memory but give deeper scrollback.
                  </p>
                  <p className="obj-panel-logs-settings-tooltip-paragraph">
                    Range {OBJ_PANEL_LOGS_BUFFER_MIN_SIZE}-{OBJ_PANEL_LOGS_BUFFER_MAX_SIZE}, default{' '}
                    {OBJ_PANEL_LOGS_BUFFER_DEFAULT_SIZE}
                  </p>
                </>
              }
              variant="dark"
            />
          </div>
          <div className="setting-item obj-panel-logs-settings-target-limits">
            <div className="obj-panel-logs-settings-target-limits-grid">
              <div className="obj-panel-logs-settings-target-limits-title">
                <span>Max containers</span>
              </div>
              <label
                htmlFor="log-target-per-scope-limit"
                className="obj-panel-logs-settings-target-limits-row"
              >
                Per tab
              </label>
              <div className="obj-panel-logs-settings-target-limits-control">
                <input
                  type="number"
                  id="log-target-per-scope-limit"
                  min={OBJ_PANEL_LOGS_TARGET_PER_SCOPE_MIN}
                  max={OBJ_PANEL_LOGS_TARGET_PER_SCOPE_MAX}
                  step={1}
                  value={objPanelLogsTargetPerScopeLimitInput}
                  onChange={(e) => setObjPanelLogsTargetPerScopeLimitInput(e.target.value)}
                  onBlur={(e) => commitObjPanelLogsTargetPerScopeLimit(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      e.currentTarget.blur();
                    }
                  }}
                  data-obj-panel-logs-settings-focusable="true"
                />
                <Tooltip
                  content={
                    <>
                      <p className="obj-panel-logs-settings-tooltip-paragraph">
                        Limits how many pod/container Object Panel Logs Tab targets a single Logs
                        tab can stream or fetch at once.
                      </p>
                      <p className="obj-panel-logs-settings-tooltip-paragraph">
                        Range {OBJ_PANEL_LOGS_TARGET_PER_SCOPE_MIN}-
                        {OBJ_PANEL_LOGS_TARGET_PER_SCOPE_MAX}, default{' '}
                        {OBJ_PANEL_LOGS_TARGET_PER_SCOPE_DEFAULT}
                      </p>
                    </>
                  }
                  variant="dark"
                />
              </div>
              <label
                htmlFor="log-target-global-limit"
                className="obj-panel-logs-settings-target-limits-row"
              >
                Global
              </label>
              <div className="obj-panel-logs-settings-target-limits-control">
                <input
                  type="number"
                  id="log-target-global-limit"
                  min={OBJ_PANEL_LOGS_TARGET_GLOBAL_MIN}
                  max={OBJ_PANEL_LOGS_TARGET_GLOBAL_MAX}
                  step={1}
                  value={objPanelLogsTargetGlobalLimitInput}
                  onChange={(e) => setObjPanelLogsTargetGlobalLimitInput(e.target.value)}
                  onBlur={(e) => commitObjPanelLogsTargetGlobalLimit(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      e.currentTarget.blur();
                    }
                  }}
                  data-obj-panel-logs-settings-focusable="true"
                />
                <Tooltip
                  content={
                    <>
                      <p className="obj-panel-logs-settings-tooltip-paragraph">
                        Limits how many pod/container Object Panel Logs Tab targets can be shared
                        across all open Logs tabs.
                      </p>
                      <p className="obj-panel-logs-settings-tooltip-paragraph">
                        Range {OBJ_PANEL_LOGS_TARGET_GLOBAL_MIN}-{OBJ_PANEL_LOGS_TARGET_GLOBAL_MAX},
                        default {OBJ_PANEL_LOGS_TARGET_GLOBAL_DEFAULT}
                      </p>
                    </>
                  }
                  variant="dark"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="settings-section">
        <h3>API Timestamps</h3>
        <div className="settings-items">
          <div className="setting-item obj-panel-logs-settings-timestamp">
            <div className="obj-panel-logs-settings-timestamp-grid">
              <div className="obj-panel-logs-settings-timestamp-checkbox-row">
                <label
                  htmlFor="log-api-timestamp-local-time-zone"
                  className="obj-panel-logs-settings-timestamp-checkbox"
                >
                  <input
                    type="checkbox"
                    id="log-api-timestamp-local-time-zone"
                    checked={objPanelLogsApiTimestampUseLocalTimeZone}
                    onChange={(e) => {
                      const enabled = e.target.checked;
                      setObjPanelLogsApiTimestampUseLocalTimeZoneState(enabled);
                      setObjPanelLogsApiTimestampUseLocalTimeZone(enabled);
                    }}
                    data-obj-panel-logs-settings-focusable="true"
                  />
                  Use local time zone
                </label>
                <Tooltip
                  content="Formats Kubernetes API timestamps using this machine's local timezone instead of UTC."
                  variant="dark"
                />
              </div>
              <label
                htmlFor="log-api-timestamp-format"
                className="obj-panel-logs-settings-timestamp-format-label"
              >
                Format
              </label>
              <div className="obj-panel-logs-settings-timestamp-control">
                <input
                  type="text"
                  id="log-api-timestamp-format"
                  value={objPanelLogsApiTimestampFormatInput}
                  onChange={(e) => {
                    setObjPanelLogsApiTimestampFormatInput(e.target.value);
                    if (objPanelLogsApiTimestampFormatError) {
                      setObjPanelLogsApiTimestampFormatError(null);
                    }
                  }}
                  onBlur={(e) => commitObjPanelLogsApiTimestampFormat(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      e.currentTarget.blur();
                    }
                  }}
                  className={
                    objPanelLogsApiTimestampFormatError ? 'setting-input-error' : undefined
                  }
                  aria-invalid={objPanelLogsApiTimestampFormatError ? 'true' : 'false'}
                  data-obj-panel-logs-settings-focusable="true"
                />
                <a
                  className="obj-panel-logs-settings-format-link"
                  href="https://day.js.org/docs/en/parse/string-format#list-of-all-available-parsing-tokens"
                  tabIndex={-1}
                  data-focus-trap-ignore="true"
                  onClick={(e) => {
                    e.preventDefault();
                    BrowserOpenURL(
                      'https://day.js.org/docs/en/parse/string-format#list-of-all-available-parsing-tokens'
                    );
                  }}
                >
                  Formatting reference
                </a>
              </div>
              {objPanelLogsApiTimestampPreview ? (
                <>
                  <span className="obj-panel-logs-settings-timestamp-example-label"></span>
                  <span className="obj-panel-logs-settings-timestamp-example-value">
                    {objPanelLogsApiTimestampPreview}
                  </span>
                </>
              ) : null}
              {objPanelLogsApiTimestampFormatError ? (
                <div
                  className="setting-item-message setting-item-error obj-panel-logs-settings-timestamp-error"
                  role="alert"
                >
                  {objPanelLogsApiTimestampFormatError}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ObjPanelLogsSettings;
