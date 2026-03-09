/**
 * frontend/src/ui/modals/create-resource/FormProbeField.tsx
 *
 * Probe editor for container readiness/liveness probes. Supports four probe
 * types (HTTP GET, TCP Socket, Exec, gRPC) with type-specific fields and
 * common timing parameters.
 */

import React, { useMemo, useState } from 'react';
import { Dropdown } from '@shared/components/dropdowns/Dropdown';
import type { DropdownOption } from '@shared/components/dropdowns/Dropdown';
import { FormCompactNumberInput, parseCompactNumberValue } from './FormCompactNumberInput';
import { FormGhostAddText, FormIconActionButton } from './FormActionPrimitives';
import { shellTokenize, shellJoin } from './commandInputUtils';
import {
  INPUT_BEHAVIOR_PROPS,
  getNestedValue,
  setNestedValue,
  unsetNestedValue,
} from './formUtils';

// ─── Types & Constants ──────────────────────────────────────────────────

type ProbeTypeKey = 'httpGet' | 'tcpSocket' | 'exec' | 'grpc';

const PROBE_TYPE_KEYS: ProbeTypeKey[] = ['httpGet', 'tcpSocket', 'exec', 'grpc'];

const PROBE_TYPE_OPTIONS: DropdownOption[] = [
  { value: 'httpGet', label: 'HTTP GET' },
  { value: 'tcpSocket', label: 'TCP Socket' },
  { value: 'exec', label: 'Exec' },
  { value: 'grpc', label: 'gRPC' },
];

const SCHEME_OPTIONS: DropdownOption[] = [
  { value: 'HTTP', label: 'HTTP' },
  { value: 'HTTPS', label: 'HTTPS' },
];

interface TimingFieldDef {
  key: string;
  label: string;
  placeholder: string;
}

/** Row 1: timing parameters. */
const TIMING_FIELDS: TimingFieldDef[] = [
  { key: 'initialDelaySeconds', label: 'Initial Delay', placeholder: '0' },
  { key: 'periodSeconds', label: 'Period', placeholder: '10' },
  { key: 'timeoutSeconds', label: 'Timeout', placeholder: '1' },
];

/** Row 2: threshold parameters. */
const THRESHOLD_FIELDS: TimingFieldDef[] = [
  { key: 'successThreshold', label: 'Success', placeholder: '1' },
  { key: 'failureThreshold', label: 'Failure', placeholder: '3' },
];

/** All timing + threshold fields combined (used for extraction helpers). */
const ALL_TIMING_FIELDS: TimingFieldDef[] = [...TIMING_FIELDS, ...THRESHOLD_FIELDS];

/** Default probe written when the user clicks "Add probe". */
const DEFAULT_PROBE: Record<string, unknown> = {
  httpGet: { path: '/' },
};

// ─── Helpers ────────────────────────────────────────────────────────────

/** Detect which probe type is active by checking for known keys. */
function detectProbeType(probe: Record<string, unknown>): ProbeTypeKey {
  for (const typeKey of PROBE_TYPE_KEYS) {
    if (probe[typeKey] !== undefined) return typeKey;
  }
  return 'httpGet';
}

/** Extract timing fields from a probe, preserving only those that are set. */
function extractTimingFields(probe: Record<string, unknown>): Record<string, unknown> {
  const timing: Record<string, unknown> = {};
  for (const field of ALL_TIMING_FIELDS) {
    if (probe[field.key] !== undefined) timing[field.key] = probe[field.key];
  }
  return timing;
}

/** Check whether a probe has any meaningful values set. */
export function hasProbeValues(probe: Record<string, unknown> | undefined): boolean {
  if (!probe) return false;
  return Object.keys(probe).length > 0;
}

// ─── Component ──────────────────────────────────────────────────────────

interface FormProbeFieldProps {
  dataFieldKey: string;
  /** Current probe object, or undefined if no probe is configured. */
  probe: Record<string, unknown> | undefined;
  /** Field label used for ghost text (e.g., "Readiness"). */
  label: string;
  /** Called with the updated probe object when any field changes. */
  onProbeChange: (newProbe: Record<string, unknown>) => void;
  /** Called to remove the probe entirely from the container. */
  onRemoveProbe: () => void;
}

/**
 * FormProbeField — renders a probe editor or an "Add probe" button.
 * Manages probe type switching, type-specific fields, and timing parameters.
 */
export function FormProbeField({
  dataFieldKey,
  probe,
  label,
  onProbeChange,
  onRemoveProbe,
}: FormProbeFieldProps): React.ReactElement {
  // Local editing state for the exec command text input.
  // Non-null only while the user is actively typing.
  const [editingExecText, setEditingExecText] = useState<string | null>(null);

  // All hooks must run unconditionally (before any early return).
  const probeType = probe ? detectProbeType(probe) : 'httpGet';

  const execCommand: string[] = useMemo(() => {
    if (!probe || probeType !== 'exec') return [];
    const cmd =
      probe.exec && typeof probe.exec === 'object'
        ? getNestedValue(probe.exec as Record<string, unknown>, ['command'])
        : undefined;
    return Array.isArray(cmd) ? cmd.map(String) : [];
  }, [probe, probeType]);

  const execDisplayText = useMemo(() => shellJoin(execCommand), [execCommand]);

  // ── No probe — show add button ──────────────────────────────────────

  if (!probe) {
    return (
      <div className="resource-form-probe-empty">
        <FormIconActionButton
          variant="add"
          label={`Add ${label.toLowerCase()} probe`}
          onClick={() => onProbeChange({ ...DEFAULT_PROBE })}
        />
        <FormGhostAddText text={`Add ${label.toLowerCase()} probe`} />
      </div>
    );
  }

  // ── Probe exists — show editor ──────────────────────────────────────

  /** Update a single path within the probe object. */
  const handleFieldChange = (path: string[], value: unknown) => {
    let nextProbe: Record<string, unknown>;
    if (value === '' || value === undefined || value === null) {
      nextProbe = unsetNestedValue(probe, path);
    } else {
      nextProbe = setNestedValue(probe, path, value);
    }
    onProbeChange(nextProbe);
  };

  /** Switch probe type, preserving timing fields. */
  const handleTypeChange = (nextValue: string | string[]) => {
    const nextType = (Array.isArray(nextValue) ? nextValue[0] : nextValue) as ProbeTypeKey;
    if (nextType === probeType) return;

    const timing = extractTimingFields(probe);
    const nextProbe: Record<string, unknown> = { ...timing };

    switch (nextType) {
      case 'httpGet':
        nextProbe.httpGet = { path: '/' };
        break;
      case 'tcpSocket':
        nextProbe.tcpSocket = {};
        break;
      case 'exec':
        nextProbe.exec = { command: [] };
        setEditingExecText('');
        break;
      case 'grpc':
        nextProbe.grpc = {};
        break;
    }
    onProbeChange(nextProbe);
  };

  /** Handle timing field changes with number validation. */
  const handleTimingChange = (fieldKey: string, rawValue: string) => {
    const parsed = parseCompactNumberValue(
      rawValue,
      { min: 0, integer: true },
      { allowEmpty: true }
    );
    if (parsed === null) return;
    handleFieldChange([fieldKey], parsed === '' ? undefined : parsed);
  };

  const execInputValue = editingExecText !== null ? editingExecText : execDisplayText;

  const commitExecCommand = () => {
    if (editingExecText === null) return;
    const tokens = shellTokenize(editingExecText.trim());
    handleFieldChange(['exec', 'command'], tokens.length > 0 ? tokens : []);
    setEditingExecText(null);
  };

  // ── Render ──────────────────────────────────────────────────────────

  return (
    <div data-field-key={dataFieldKey} className="resource-form-probe">
      {/* Row 1: type dropdown + type-specific fields */}
      <div className="resource-form-probe-config">
        <div className="resource-form-probe-type">
          <div className="resource-form-dropdown">
            <Dropdown
              options={PROBE_TYPE_OPTIONS}
              value={probeType}
              onChange={handleTypeChange}
              size="compact"
              ariaLabel={`${label} probe type`}
            />
          </div>
        </div>

        {probeType === 'httpGet' && (
          <>
            <div className="resource-form-probe-field">
              <label className="resource-form-field-label">Path</label>
              <input
                type="text"
                className="resource-form-input"
                style={{ flex: '0 0 auto', width: 'calc(16ch + 20px)', minWidth: 'calc(16ch + 20px)', maxWidth: 'calc(16ch + 20px)' }}
                data-field-key="httpGetPath"
                value={String(getNestedValue(probe, ['httpGet', 'path']) ?? '')}
                placeholder="/health"
                {...INPUT_BEHAVIOR_PROPS}
                onChange={(e) => handleFieldChange(['httpGet', 'path'], e.target.value)}
              />
            </div>
            <div className="resource-form-probe-field">
              <label className="resource-form-field-label">Port</label>
              <FormCompactNumberInput
                dataFieldKey="httpGetPort"
                value={String(getNestedValue(probe, ['httpGet', 'port']) ?? '')}
                placeholder="80"
                min={1}
                max={65535}
                integer
                style={{ flex: '0 0 auto', width: 'calc(5ch + 20px)', minWidth: 'calc(5ch + 20px)', maxWidth: 'calc(5ch + 20px)' }}
                onChange={(e) => {
                  const parsed = parseCompactNumberValue(
                    e.target.value,
                    { min: 1, max: 65535, integer: true },
                    { allowEmpty: true }
                  );
                  if (parsed !== null) handleFieldChange(['httpGet', 'port'], parsed === '' ? undefined : parsed);
                }}
              />
            </div>
            <div className="resource-form-probe-field">
              <label className="resource-form-field-label">Scheme</label>
              <div className="resource-form-probe-scheme">
                <div className="resource-form-dropdown">
                  <Dropdown
                    options={SCHEME_OPTIONS}
                    value={String(getNestedValue(probe, ['httpGet', 'scheme']) ?? 'HTTP')}
                    onChange={(v) => {
                      const val = Array.isArray(v) ? v[0] : v;
                      // HTTP is the default — omit it from YAML.
                      handleFieldChange(['httpGet', 'scheme'], val === 'HTTP' ? undefined : val);
                    }}
                    size="compact"
                    ariaLabel="HTTP scheme"
                  />
                </div>
              </div>
            </div>
          </>
        )}

        {probeType === 'tcpSocket' && (
          <div className="resource-form-probe-field">
            <label className="resource-form-field-label">Port</label>
            <FormCompactNumberInput
              dataFieldKey="tcpSocketPort"
              value={String(getNestedValue(probe, ['tcpSocket', 'port']) ?? '')}
              placeholder="80"
              min={1}
              max={65535}
              integer
              style={{ flex: '0 0 auto', width: 'calc(5ch + 20px)', minWidth: 'calc(5ch + 20px)', maxWidth: 'calc(5ch + 20px)' }}
              onChange={(e) => {
                const parsed = parseCompactNumberValue(
                  e.target.value,
                  { min: 1, max: 65535, integer: true },
                  { allowEmpty: true }
                );
                if (parsed !== null) handleFieldChange(['tcpSocket', 'port'], parsed === '' ? undefined : parsed);
              }}
            />
          </div>
        )}

        {probeType === 'exec' && (
          <div className="resource-form-probe-field resource-form-probe-field--exec">
            <label className="resource-form-field-label">Cmd</label>
            <input
              type="text"
              className="resource-form-input"
              data-field-key="execCommand"
              value={execInputValue}
              placeholder="cat /tmp/healthy"
              {...INPUT_BEHAVIOR_PROPS}
              onChange={(e) => setEditingExecText(e.target.value)}
              onBlur={commitExecCommand}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commitExecCommand();
                }
              }}
            />
          </div>
        )}

        {probeType === 'grpc' && (
          <>
            <div className="resource-form-probe-field">
              <label className="resource-form-field-label">Port</label>
              <FormCompactNumberInput
                dataFieldKey="grpcPort"
                value={String(getNestedValue(probe, ['grpc', 'port']) ?? '')}
                placeholder="50051"
                min={1}
                max={65535}
                integer
                style={{ flex: '0 0 auto', width: 'calc(5ch + 20px)', minWidth: 'calc(5ch + 20px)', maxWidth: 'calc(5ch + 20px)' }}
                onChange={(e) => {
                  const parsed = parseCompactNumberValue(
                    e.target.value,
                    { min: 1, max: 65535, integer: true },
                    { allowEmpty: true }
                  );
                  if (parsed !== null) handleFieldChange(['grpc', 'port'], parsed === '' ? undefined : parsed);
                }}
              />
            </div>
            <div className="resource-form-probe-field">
              <label className="resource-form-field-label">Service</label>
              <input
                type="text"
                className="resource-form-input"
                style={{ flex: '0 0 auto', width: 'calc(16ch + 20px)', minWidth: 'calc(16ch + 20px)', maxWidth: 'calc(16ch + 20px)' }}
                data-field-key="grpcService"
                value={String(getNestedValue(probe, ['grpc', 'service']) ?? '')}
                placeholder="optional"
                {...INPUT_BEHAVIOR_PROPS}
                onChange={(e) => handleFieldChange(['grpc', 'service'], e.target.value)}
              />
            </div>
          </>
        )}

        <div className="resource-form-probe-actions">
          <FormIconActionButton
            variant="remove"
            label={`Remove ${label.toLowerCase()} probe`}
            onClick={onRemoveProbe}
          />
        </div>
      </div>

      {/* Row 2: timing fields */}
      <div className="resource-form-probe-timing">
        <label className="resource-form-field-label resource-form-probe-timing-row-label">Timings (seconds)</label>
        {TIMING_FIELDS.map((tf) => (
          <div key={tf.key} className="resource-form-probe-timing-field">
            <label className="resource-form-field-label">{tf.label}</label>
            <FormCompactNumberInput
              dataFieldKey={tf.key}
              value={String(probe[tf.key] ?? '')}
              placeholder={tf.placeholder}
              min={0}
              integer
              style={{ flex: '0 0 auto', width: 'calc(4ch + 20px)', minWidth: 'calc(4ch + 20px)', maxWidth: 'calc(4ch + 20px)' }}
              onChange={(e) => handleTimingChange(tf.key, e.target.value)}
            />
          </div>
        ))}
      </div>

      {/* Row 3: threshold fields */}
      <div className="resource-form-probe-timing">
        <label className="resource-form-field-label resource-form-probe-timing-row-label">Thresholds</label>
        {THRESHOLD_FIELDS.map((tf) => (
          <div key={tf.key} className="resource-form-probe-timing-field">
            <label className="resource-form-field-label">{tf.label}</label>
            <FormCompactNumberInput
              dataFieldKey={tf.key}
              value={String(probe[tf.key] ?? '')}
              placeholder={tf.placeholder}
              min={0}
              integer
              style={{ flex: '0 0 auto', width: 'calc(4ch + 20px)', minWidth: 'calc(4ch + 20px)', maxWidth: 'calc(4ch + 20px)' }}
              onChange={(e) => handleTimingChange(tf.key, e.target.value)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
