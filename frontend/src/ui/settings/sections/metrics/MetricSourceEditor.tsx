/**
 * frontend/src/ui/settings/sections/metrics/MetricSourceEditor.tsx
 *
 * Editor for one in-cluster metrics source. The user picks the cluster, then a Service and port
 * from that cluster's catalog; nothing is pre-selected or auto-detected. A source on a cluster
 * that is not connected keeps its saved values but cannot be re-pointed until it is opened.
 */

import type { backend } from '@core/backend-api/models';
import { IN_CLUSTER_MODE, type MetricCluster } from '@core/settings/metricSourceModel';
import {
  loadMetricServiceCandidates,
  loadServicePorts,
  saveMetricSource,
  testMetricSource,
} from '@core/settings/metricSources';
import Dropdown from '@shared/components/dropdowns/Dropdown/Dropdown';
import { ErrorSurface } from '@shared/components/errors/ErrorSurface';
import SegmentedButton from '@shared/components/SegmentedButton';
import { type ReactNode, useEffect, useId, useMemo, useState } from 'react';

interface MetricSourceEditorProps {
  source: backend.MetricSource | null;
  clusters: MetricCluster[];
  connectedClusterIds: string[];
  usedBy: string[];
  /** Names of the other sources, so a duplicate is caught locally before saving. */
  otherSourceNames: string[];
  onSaved: (source: backend.MetricSource) => void;
  onDelete: (source: backend.MetricSource) => Promise<void>;
}

interface Draft {
  name: string;
  clusterId: string;
  namespace: string;
  service: string;
  port: string;
  scheme: string;
  pathPrefix: string;
}

const draftFrom = (source: backend.MetricSource | null): Draft => ({
  name: source?.name ?? '',
  clusterId: source?.inCluster?.clusterId ?? '',
  namespace: source?.inCluster?.namespace ?? '',
  service: source?.inCluster?.service ?? '',
  port: source?.inCluster?.port ?? '',
  scheme: source?.inCluster?.scheme || 'http',
  pathPrefix: source?.inCluster?.pathPrefix ?? '',
});

const sourceFromDraft = (draft: Draft, id: string): backend.MetricSource => ({
  id,
  name: draft.name,
  mode: IN_CLUSTER_MODE,
  inCluster: {
    clusterId: draft.clusterId,
    namespace: draft.namespace,
    service: draft.service,
    port: draft.port,
    scheme: draft.scheme,
    pathPrefix: draft.pathPrefix,
  },
});

// The draft as a queryable source, or null until every connection field is chosen.
const connectionFromDraft = (draft: Draft, id: string): backend.MetricSource | null =>
  draft.clusterId && draft.namespace && draft.service && draft.port
    ? sourceFromDraft(draft, id)
    : null;

const connectionKey = (draft: Draft) =>
  [
    draft.clusterId,
    draft.namespace,
    draft.service,
    draft.port,
    draft.scheme,
    draft.pathPrefix,
  ].join('|');

const portValue = (port: backend.ContainerPortInfo) => port.name || String(port.port);
const portLabel = (port: backend.ContainerPortInfo) =>
  port.name ? `${port.name} (${port.port})` : String(port.port);

// Keep the saved value visible even when the list it came from is not loaded.
function withCurrent(options: { value: string; label: string }[], current: string) {
  return current && !options.some((option) => option.value === current)
    ? [{ value: current, label: current }, ...options]
    : options;
}

/** Loads the connected cluster's Services, dropping results for a cluster the user moved away from. */
function useServiceCandidates(clusterId: string, connected: boolean) {
  const [candidates, setCandidates] = useState<backend.MetricServiceCandidate[]>([]);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    setCandidates([]);
    setError(null);
    if (!clusterId || !connected) {
      return;
    }
    let current = true;
    loadMetricServiceCandidates(clusterId).then(
      (next) => current && setCandidates(next),
      (failure: unknown) => current && setError(failure)
    );
    return () => {
      current = false;
    };
  }, [clusterId, connected]);
  return { candidates, error };
}

function useServicePorts(
  clusterId: string,
  namespace: string,
  service: string,
  connected: boolean
) {
  const [ports, setPorts] = useState<backend.ContainerPortInfo[]>([]);
  useEffect(() => {
    setPorts([]);
    if (!connected || !clusterId || !namespace || !service) {
      return;
    }
    let current = true;
    loadServicePorts(clusterId, namespace, service).then(
      (next) => current && setPorts(next),
      () => current && setPorts([])
    );
    return () => {
      current = false;
    };
  }, [clusterId, namespace, service, connected]);
  return ports;
}

type ConnectionTestState =
  | { status: 'idle' | 'testing' }
  | { status: 'done'; result: backend.MetricSourceTestResult }
  | { status: 'failed'; error: unknown };

/** Tests the connection as currently edited; keyed by those fields so an edit clears the result. */
function ConnectionTest({ source }: Readonly<{ source: backend.MetricSource | null }>) {
  const [state, setState] = useState<ConnectionTestState>({ status: 'idle' });
  const run = async (candidate: backend.MetricSource) => {
    setState({ status: 'testing' });
    try {
      setState({ status: 'done', result: await testMetricSource(candidate) });
    } catch (error) {
      setState({ status: 'failed', error });
    }
  };
  return (
    <div className="metrics-settings-test">
      <button
        type="button"
        className="button generic"
        disabled={!source || state.status === 'testing'}
        onClick={() => source && void run(source)}
      >
        Test connection
      </button>
      {state.status === 'done' && state.result.ok ? (
        <span className="metrics-settings-hint" data-connection-test="ok">
          Connected · Prometheus {state.result.version}
        </span>
      ) : null}
      {state.status === 'done' && !state.result.ok ? (
        <span className="metrics-settings-error" role="alert">
          <ErrorSurface
            kind="status"
            message={state.result.error || 'The source did not answer.'}
          />
        </span>
      ) : null}
      {state.status === 'failed' ? (
        <span className="metrics-settings-error" role="alert">
          <ErrorSurface
            kind="operational"
            error={state.error}
            context={{ action: 'testMetricSource', source: 'MetricSourceEditor' }}
          />
        </span>
      ) : null}
    </div>
  );
}

const Field = ({ label, children }: { label: string; children: ReactNode }) => (
  <>
    <span className="metrics-settings-form__label">{label}</span>
    <div className="metrics-settings-form__field">{children}</div>
  </>
);

export function MetricSourceEditor({
  source,
  clusters,
  connectedClusterIds,
  usedBy,
  otherSourceNames,
  onSaved,
  onDelete,
}: Readonly<MetricSourceEditorProps>) {
  const id = useId();
  const [draft, setDraft] = useState<Draft>(() => draftFrom(source));
  const [saveError, setSaveError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const connected = connectedClusterIds.includes(draft.clusterId);
  const { candidates, error: candidatesError } = useServiceCandidates(draft.clusterId, connected);
  const ports = useServicePorts(draft.clusterId, draft.namespace, draft.service, connected);

  const clusterOptions = useMemo(() => {
    const options = clusters
      .filter((cluster) => connectedClusterIds.includes(cluster.id))
      .map((cluster) => ({ value: cluster.id, label: cluster.name }));
    const saved = clusters.find((cluster) => cluster.id === draft.clusterId);
    return withCurrent(options, draft.clusterId).map((option) =>
      option.value === draft.clusterId && !connected
        ? { ...option, label: `${saved?.name ?? option.value} (not connected)` }
        : option
    );
  }, [clusters, connectedClusterIds, draft.clusterId, connected]);
  const namespaceOptions = withCurrent(
    [...new Set(candidates.map((candidate) => candidate.namespace))].map((value) => ({
      value,
      label: value,
    })),
    draft.namespace
  );
  const serviceOptions = withCurrent(
    candidates
      .filter((candidate) => candidate.namespace === draft.namespace)
      .map((candidate) => ({ value: candidate.name, label: candidate.name })),
    draft.service
  );
  const portOptions = withCurrent(
    ports.map((port) => ({ value: portValue(port), label: portLabel(port) })),
    draft.port
  );

  const update = (patch: Partial<Draft>) => {
    setSaveError(null);
    setDraft((previous) => ({ ...previous, ...patch }));
  };
  const duplicateName = otherSourceNames.some(
    (name) => name.toLowerCase() === draft.name.trim().toLowerCase()
  );
  const connection = connectionFromDraft(draft, source?.id ?? '');
  const complete = connection !== null && !duplicateName && !!draft.name.trim();
  const clusterName =
    clusters.find((cluster) => cluster.id === draft.clusterId)?.name ?? draft.clusterId;

  const save = async () => {
    setSaving(true);
    try {
      const saved = await saveMetricSource(sourceFromDraft(draft, source?.id ?? ''));
      onSaved(saved);
    } catch (error) {
      setSaveError(error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="metrics-settings-form">
      <Field label="Name">
        <input
          id={`${id}-name`}
          className="metrics-settings-input"
          aria-label="Name"
          placeholder="e.g. dev prometheus"
          value={draft.name}
          onChange={(event) => update({ name: event.target.value })}
        />
      </Field>
      <Field label="Connection">
        <span className="metrics-settings-hint">
          In-cluster Service, through the Kubernetes API with your kubeconfig login. Needs{' '}
          <code>get services/proxy</code> on the Service.
        </span>
      </Field>
      <Field label="Cluster">
        <Dropdown
          ariaLabel="Cluster"
          placeholder="Choose a connected cluster"
          options={clusterOptions}
          value={draft.clusterId}
          onChange={(value) =>
            update({ clusterId: String(value), namespace: '', service: '', port: '' })
          }
        />
      </Field>
      {draft.clusterId && !connected ? (
        <Field label="">
          <span className="metrics-settings-hint">Open {clusterName} to change its Service.</span>
        </Field>
      ) : null}
      <Field label="Namespace">
        <Dropdown
          ariaLabel="Namespace"
          placeholder="Choose a namespace"
          searchable
          disabled={!connected}
          options={namespaceOptions}
          value={draft.namespace}
          onChange={(value) => update({ namespace: String(value), service: '', port: '' })}
        />
      </Field>
      <Field label="Service">
        <Dropdown
          ariaLabel="Service"
          placeholder="Choose a Service"
          searchable
          disabled={!connected || !draft.namespace}
          options={serviceOptions}
          value={draft.service}
          onChange={(value) => update({ service: String(value), port: '' })}
        />
      </Field>
      <Field label="Port">
        <Dropdown
          ariaLabel="Port"
          placeholder="Choose a port"
          disabled={!connected || !draft.service}
          options={portOptions}
          value={draft.port}
          onChange={(value) => update({ port: String(value) })}
        />
      </Field>
      {candidatesError ? (
        <Field label="">
          <span className="metrics-settings-error">
            <ErrorSurface
              kind="operational"
              error={candidatesError}
              context={{ action: 'listMetricServiceCandidates', source: 'MetricSourceEditor' }}
            />
          </span>
        </Field>
      ) : null}
      <Field label="Scheme">
        <SegmentedButton
          size="small"
          ariaLabel="Scheme"
          value={draft.scheme}
          onChange={(scheme) => update({ scheme })}
          options={[
            { value: 'http', label: 'http' },
            { value: 'https', label: 'https' },
          ]}
        />
      </Field>
      <Field label="Path prefix">
        <input
          className="metrics-settings-input"
          aria-label="Path prefix"
          placeholder="optional, e.g. /prometheus"
          value={draft.pathPrefix}
          onChange={(event) => update({ pathPrefix: event.target.value })}
        />
      </Field>
      <Field label="">
        <ConnectionTest key={connectionKey(draft)} source={connection} />
      </Field>
      {duplicateName ? (
        <div className="metrics-settings-form__message metrics-settings-error" role="alert">
          <ErrorSurface
            kind="validation"
            message={`A source named "${draft.name.trim()}" already exists.`}
          />
        </div>
      ) : null}
      {saveError ? (
        <div className="metrics-settings-form__message metrics-settings-error" role="alert">
          <ErrorSurface
            kind="operational"
            error={saveError}
            context={{ action: 'saveMetricSource', source: 'MetricSourceEditor' }}
          />
        </div>
      ) : null}
      <div className="metrics-settings-form__footer">
        {source ? (
          <DeleteControl
            source={source}
            usedBy={usedBy}
            confirming={confirmingDelete}
            setConfirming={setConfirmingDelete}
            onDelete={onDelete}
          />
        ) : (
          <span />
        )}
        <button
          type="button"
          className="button save"
          disabled={!complete || saving}
          onClick={() => void save()}
        >
          Save
        </button>
      </div>
    </div>
  );
}

function DeleteControl({
  source,
  usedBy,
  confirming,
  setConfirming,
  onDelete,
}: Readonly<{
  source: backend.MetricSource;
  usedBy: string[];
  confirming: boolean;
  setConfirming: (confirming: boolean) => void;
  onDelete: (source: backend.MetricSource) => Promise<void>;
}>) {
  if (!confirming) {
    return (
      <button type="button" className="button danger" onClick={() => setConfirming(true)}>
        Delete
      </button>
    );
  }
  return (
    <span className="metrics-settings-form__confirm">
      <span className="metrics-settings-hint">
        Delete {source.name}?
        {usedBy.length > 0 ? ` ${usedBy.join(', ')} will use live metrics.` : ''}
      </span>
      <button type="button" className="button danger" onClick={() => void onDelete(source)}>
        Confirm delete
      </button>
      <button type="button" className="button cancel" onClick={() => setConfirming(false)}>
        Cancel
      </button>
    </span>
  );
}
