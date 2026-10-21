/**
 * frontend/src/ui/settings/sections/LogsSection.tsx
 *
 * Logs tab content: the settings Container Logs and Node Logs share — how many
 * logs a Logs tab keeps, how many containers it reads, and how Kubernetes API
 * timestamps are shown.
 */

import { openURL } from '@core/desktop-runtime';
import { ErrorSurface } from '@shared/components/errors/ErrorSurface';
import ToggleSwitch from '@shared/components/ToggleSwitch';
import { errorHandler } from '@utils/errorHandler';
import { useEffect, useId, useState } from 'react';
import {
  hydrateAppPreferences,
  setObjPanelLogsApiTimestampFormat,
  setObjPanelLogsApiTimestampUseLocalTimeZone,
  setObjPanelLogsBufferMaxSize,
  setObjPanelLogsTargetGlobalLimit,
  setObjPanelLogsTargetPerScopeLimit,
} from '@/core/settings/appPreferences';
import { usePreference } from '@/core/settings/usePreference';
import {
  formatObjPanelLogsApiTimestamp,
  getObjPanelLogsApiTimestampFormatValidationError,
} from '@/utils/objPanelLogsApiTimestampFormat';
import { PreferenceNumberRow, type PreferenceNumberSetting, SettingRow } from './SettingsControls';

const TIMESTAMP_EXAMPLE = '2026-04-11T12:34:55.000Z';
const TIMESTAMP_FORMAT_REFERENCE =
  'https://day.js.org/docs/en/parse/string-format#list-of-all-available-parsing-tokens';

const CONSTRAINTS: PreferenceNumberSetting[] = [
  {
    title: 'Buffer size',
    help: 'Max number of log rows kept by each Logs tab. Larger values use more memory but give deeper scrollback.',
    prefKey: 'objPanelLogsBufferMaxSize',
    persist: setObjPanelLogsBufferMaxSize,
    step: 100,
    unit: 'logs',
  },
  {
    title: 'Max containers per tab',
    help: 'Limits how many pod/container targets a single Logs tab can stream or fetch at once.',
    prefKey: 'objPanelLogsTargetPerScopeLimit',
    persist: setObjPanelLogsTargetPerScopeLimit,
    step: 1,
    unit: 'containers',
  },
  {
    title: 'Max containers across all tabs',
    help: 'Limits how many pod/container targets can be shared across all open Logs tabs.',
    prefKey: 'objPanelLogsTargetGlobalLimit',
    persist: setObjPanelLogsTargetGlobalLimit,
    step: 1,
    unit: 'containers',
  },
];

function TimestampFormatRow({
  id,
  useLocalTimeZone,
}: Readonly<{ id: string; useLocalTimeZone: boolean }>) {
  const format = usePreference('objPanelLogsApiTimestampFormat');
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const shown = draft ?? format;
  const preview = getObjPanelLogsApiTimestampFormatValidationError(shown)
    ? null
    : formatObjPanelLogsApiTimestamp(TIMESTAMP_EXAMPLE, shown.trim(), useLocalTimeZone);

  const commit = (raw: string) => {
    const validationError = getObjPanelLogsApiTimestampFormatValidationError(raw);
    if (validationError) {
      setError(validationError);
      return;
    }
    setObjPanelLogsApiTimestampFormat(raw.trim());
    setDraft(null);
    setError(null);
  };

  return (
    <SettingRow
      title="Timestamp format"
      controlId={id}
      help={
        <>
          How Kubernetes API timestamps are written, as a Day.js pattern.{' '}
          <button
            type="button"
            className="settings-help-link"
            onClick={() => openURL(TIMESTAMP_FORMAT_REFERENCE)}
          >
            Formatting reference
          </button>
        </>
      }
    >
      <div className="settings-items">
        <div className="setting-item setting-item-inline">
          <input
            type="text"
            id={id}
            value={shown}
            onChange={(event) => {
              setDraft(event.target.value);
              setError(null);
            }}
            onBlur={(event) => commit(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                event.currentTarget.blur();
              }
            }}
            className={error ? 'settings-input-error' : undefined}
            aria-invalid={error ? 'true' : 'false'}
            aria-describedby={error ? `${id}-error` : undefined}
          />
        </div>
        {preview ? <div className="setting-item setting-description">{preview}</div> : null}
        {error ? (
          <div id={`${id}-error`} className="setting-item settings-field-error" role="alert">
            <ErrorSurface kind="validation" message={error} />
          </div>
        ) : null}
      </div>
    </SettingRow>
  );
}

function LogsSection() {
  const elementIdPrefix = useId();
  const useLocalTimeZone = usePreference('objPanelLogsApiTimestampUseLocalTimeZone');

  useEffect(() => {
    void hydrateAppPreferences({ force: true }).catch((error) => {
      errorHandler.handle(error, { action: 'loadLogsSettings' });
    });
  }, []);

  return (
    <div className="settings-panel">
      <h2 className="settings-panel-title">Logs</h2>

      <div className="settings-subgroup-label">Constraints</div>
      <hr className="settings-subgroup-divider" />

      {CONSTRAINTS.map((setting) => (
        <PreferenceNumberRow
          key={setting.prefKey}
          setting={setting}
          id={`${elementIdPrefix}-${setting.prefKey}`}
        />
      ))}

      <div className="settings-subgroup-label">API Timestamps</div>
      <hr className="settings-subgroup-divider" />

      <SettingRow
        title="Use local time zone"
        help="Formats Kubernetes API timestamps using this machine's local timezone instead of UTC."
      >
        <ToggleSwitch
          id={`${elementIdPrefix}-logs-local-time-zone`}
          checked={useLocalTimeZone}
          onChange={setObjPanelLogsApiTimestampUseLocalTimeZone}
          ariaLabel="Use local time zone"
        />
      </SettingRow>

      <TimestampFormatRow
        id={`${elementIdPrefix}-logs-timestamp-format`}
        useLocalTimeZone={useLocalTimeZone}
      />
    </div>
  );
}

export default LogsSection;
