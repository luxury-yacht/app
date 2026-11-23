/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Explain/useKindExplain.ts
 *
 * Reads a kind's `kubectl explain` output for the Explain tab: the field tree
 * once, and each field's description the first time the user selects it.
 */

import type { apiresources } from '@core/backend-api/models';
import { errorHandler } from '@utils/errorHandler';
import { errorStatusOf } from '@utils/errorStatus';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  type KindReadTarget,
  readKindField,
  readKindSchema,
  requestData,
} from '@/core/data-access';

export type KindSchemaState =
  | { status: 'loading' }
  | { status: 'ready'; schema: apiresources.KindSchema }
  // The cluster publishes no schema for the kind: an answer, not a failure.
  | { status: 'missing' }
  | { status: 'paused' }
  | { status: 'error'; message: string };

export type FieldExplanationState =
  | { status: 'loading' }
  | { status: 'ready'; explanation: apiresources.FieldExplanation }
  | { status: 'error'; message: string };

/**
 * Identifies a field by its name under each ancestor. A field name may itself
 * contain a dot, so a dotted string cannot tell `a.b` from `b` nested under `a`.
 */
export const fieldKey = (path: readonly string[]): string => JSON.stringify(path);

/** The kind itself: the parent of its top-level fields. */
export const KIND_PATH: readonly string[] = [];

const kindScope = (target: KindReadTarget) =>
  `${target.clusterId}:${target.group}/${target.version}/${target.resource}/${target.kind}`;

const describeFailure = (error: unknown, action: string, clusterId: string): string =>
  errorHandler.handleInline(error, { action, source: 'ExplainTab', clusterId }).message ||
  'The schema could not be read';

export function useKindExplain(target: KindReadTarget, enabled: boolean) {
  const { clusterId, group, version, kind, resource } = target;
  const [schema, setSchema] = useState<KindSchemaState>({ status: 'loading' });
  const [schemaRefresh, setSchemaRefresh] = useState(0);
  const [selectedPath, setSelectedPath] = useState<readonly string[]>(KIND_PATH);
  // Explanations already read for this kind, keyed by fieldKey.
  const [explanations, setExplanations] = useState<Record<string, FieldExplanationState>>({});
  const requestedPaths = useRef(new Set<string>());
  // Identifies the kind the in-flight reads belong to, so a late answer for a
  // kind the tab no longer shows is dropped.
  const generation = useRef(0);
  // The kind whose schema was requested. Re-running the effect for the same
  // kind (the tab is shown again, or React re-mounts it) keeps what was read;
  // a failed read clears it so showing the tab again retries.
  const requestedKind = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    const kindTarget = { clusterId, group, version, kind, resource };
    const kindKey = `${kindScope(kindTarget)}:${schemaRefresh}`;
    if (requestedKind.current === kindKey) {
      return;
    }
    requestedKind.current = kindKey;
    const current = ++generation.current;
    requestedPaths.current = new Set();
    setSchema({ status: 'loading' });
    setSelectedPath(KIND_PATH);
    setExplanations({});
    requestData({
      resource: 'kind-explain',
      // Opening the tab is the user asking for the schema.
      reason: 'user',
      adapter: 'rpc-read',
      label: 'Explain',
      scope: kindScope(kindTarget),
      read: () => readKindSchema(kindTarget),
    })
      .then((result) => {
        if (generation.current !== current) {
          return;
        }
        if (result.status === 'blocked') {
          requestedKind.current = null;
          setSchema({ status: 'paused' });
          return;
        }
        setSchema(result.data ? { status: 'ready', schema: result.data } : { status: 'missing' });
      })
      .catch((error: unknown) => {
        if (generation.current !== current) {
          return;
        }
        if (errorStatusOf(error)?.reason === 'NotFound') {
          setSchema({ status: 'missing' });
          return;
        }
        requestedKind.current = null;
        setSchema({
          status: 'error',
          message: describeFailure(error, 'loadKindSchema', clusterId),
        });
      });
  }, [enabled, clusterId, group, version, kind, resource, schemaRefresh]);

  const retrySchema = useCallback(() => {
    // Retire the previous tree and its field reads before reloading.
    generation.current++;
    setSchema({ status: 'loading' });
    setSchemaRefresh((value) => value + 1);
  }, []);

  const selectField = useCallback(
    (path: readonly string[]) => {
      if (schema.status !== 'ready') {
        return;
      }
      const { revision } = schema.schema;
      const key = fieldKey(path);
      setSelectedPath(path);
      // The kind's own description comes with its schema.
      if (path.length === 0 || requestedPaths.current.has(key)) {
        return;
      }
      requestedPaths.current.add(key);
      const kindTarget = { clusterId, group, version, kind, resource };
      const current = generation.current;
      const settle = (state: FieldExplanationState) => {
        if (generation.current === current) {
          setExplanations((previous) => ({ ...previous, [key]: state }));
        }
      };
      settle({ status: 'loading' });
      requestData({
        resource: 'kind-explain',
        reason: 'user',
        adapter: 'rpc-read',
        label: 'Explain field',
        scope: `${kindScope(kindTarget)}:${key}`,
        read: () => readKindField(kindTarget, path, revision),
      })
        .then((result) => {
          if (generation.current !== current) {
            return;
          }
          if (result.status === 'executed' && result.data) {
            settle({ status: 'ready', explanation: result.data });
            return;
          }
          // Let a later selection ask again.
          requestedPaths.current.delete(key);
          settle({ status: 'error', message: 'The field could not be explained' });
        })
        .catch((error: unknown) => {
          if (generation.current !== current) {
            return;
          }
          if (errorStatusOf(error)?.reason === 'Conflict') {
            retrySchema();
            return;
          }
          requestedPaths.current.delete(key);
          settle({
            status: 'error',
            message: describeFailure(error, 'loadKindField', clusterId),
          });
        });
    },
    [clusterId, group, version, kind, resource, schema, retrySchema]
  );

  return {
    schema,
    retrySchema,
    selectedPath,
    selectedExplanation: explanations[fieldKey(selectedPath)] ?? null,
    selectField,
  };
}
