/**
 * frontend/src/shared/hooks/useBatchObjectActions.tsx
 *
 * Runs one object action over the rows picked in batch-select mode. Which rows
 * an action covers comes from the same policy and permission checks as a row's
 * context menu, and each object goes to the backend on its own with its
 * complete identity.
 */

import type { types } from '@core/backend-api/models';
import {
  type ObjectActionTargetRef,
  runCronJobSuspend,
  runNodeCordon,
  runNodeUncordon,
  runObjectDelete,
  runObjectRestart,
  runObjectScale,
  runStartDrain,
} from '@shared/actions/objectActionClient';
import {
  OBJECT_ACTION_IDS,
  type ObjectActionId,
  objectActionLabel,
} from '@shared/actions/objectActionContract';
import {
  type ObjectActionData,
  type ObjectActionHandlerAvailability,
  type ObjectActionPolicy,
  resolveObjectActionPolicy,
} from '@shared/actions/objectActionPolicy';
import {
  CordonIcon,
  DeleteIcon,
  DrainIcon,
  RestartIcon,
  ScaleIcon,
} from '@shared/components/icons/SharedIcons';
import BatchDrainModal from '@shared/components/modals/BatchDrainModal';
import ConfirmationModal from '@shared/components/modals/ConfirmationModal';
import ScaleModal from '@shared/components/modals/ScaleModal';
import { clampReplicas } from '@shared/components/modals/scaleModalModel';
import type {
  GridTableBatchAction,
  GridTableBatchSelectedRow,
  GridTableBatchSelection,
} from '@shared/components/tables/GridTable.types';
import {
  nodeActionPermissionInputs,
  resolveNodeDrainOperationPermissions,
} from '@shared/hooks/nodeActionPermissions';
import {
  actionTargetFor,
  isDrainableNode,
  missingPermissionChecks,
  nodeRemovalWarning,
  resolveObjectActionPermissions,
} from '@shared/hooks/useObjectActionController';
import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { queryPermissionChecks, useUserPermissions } from '@/core/capabilities';
import { useClusterNameResolver } from '@/core/cluster-workspace/useClusterWorkspace';
import { errorHandler } from '@/utils/errorHandler';
import { errorStatusOf } from '@/utils/errorStatus';

export type BatchObjectActionId =
  | 'restart'
  | 'scale'
  | 'suspend'
  | 'resume'
  | 'cordon'
  | 'uncordon'
  | 'drain'
  | 'delete';

// A few requests at a time keeps a large selection from flooding the API server.
const BATCH_CONCURRENCY = 5;
const NO_ROWS_SELECTED: ReadonlySet<string> = new Set();

// Every action is offered here; the policy still decides per object.
const ALL_HANDLERS: ObjectActionHandlerAvailability = {
  restart: true,
  scale: true,
  delete: true,
  cordon: true,
  drain: true,
  suspendToggle: true,
};

interface BatchActionDefinition {
  id: BatchObjectActionId;
  actionId: ObjectActionId;
  past: string;
  icon: React.ReactNode;
  danger: boolean;
  message: (replicas: number) => string;
  covers: (policy: ObjectActionPolicy, object: ObjectActionData) => boolean;
  run: (target: ObjectActionTargetRef, batch: BatchRun) => Promise<unknown>;
  /** A dialog that gathers input first; other actions go straight to confirmation. */
  prompt?: 'scale' | 'drain';
  /** Set when repeating the action could do harm: no Retry is offered, and this says why. */
  noRetryReason?: string;
}

const BATCH_ACTIONS: readonly BatchActionDefinition[] = [
  {
    id: 'restart',
    actionId: OBJECT_ACTION_IDS.restart,
    past: 'Restarted',
    icon: <RestartIcon width={16} height={16} />,
    danger: true,
    message: () => 'This will perform a rolling restart of all pods.',
    covers: (policy) => policy.restartEnabled,
    run: (target) => runObjectRestart(target),
    noRetryReason:
      'A failed restart may still have started, so check the workload before restarting it again.',
  },
  {
    id: 'scale',
    actionId: OBJECT_ACTION_IDS.scale,
    past: 'Scaled',
    icon: <ScaleIcon width={16} height={16} />,
    danger: false,
    message: (replicas) => `Sets ${replicas} replicas on every selected workload.`,
    covers: (policy) => policy.scaleActionId === OBJECT_ACTION_IDS.scale,
    run: (target, { replicas }) => runObjectScale(target, replicas),
    prompt: 'scale',
  },
  {
    id: 'suspend',
    actionId: OBJECT_ACTION_IDS.suspend,
    past: 'Suspended',
    icon: '⏸',
    danger: false,
    message: () => 'These CronJobs will stop creating new Jobs until resumed.',
    covers: (policy) => policy.suspendActionId === OBJECT_ACTION_IDS.suspend,
    run: (target) => runCronJobSuspend(target, true),
  },
  {
    id: 'resume',
    actionId: OBJECT_ACTION_IDS.resume,
    past: 'Resumed',
    icon: '▶',
    danger: false,
    message: () => 'These CronJobs will start creating Jobs again.',
    covers: (policy) => policy.suspendActionId === OBJECT_ACTION_IDS.resume,
    run: (target) => runCronJobSuspend(target, false),
  },
  {
    id: 'cordon',
    actionId: OBJECT_ACTION_IDS.cordon,
    past: 'Cordoned',
    icon: <CordonIcon width={16} height={16} />,
    danger: false,
    message: () => 'New pods will not be scheduled on these nodes.',
    covers: (policy) => policy.cordonActionId === OBJECT_ACTION_IDS.cordon,
    run: (target) => runNodeCordon(target),
  },
  {
    id: 'uncordon',
    actionId: OBJECT_ACTION_IDS.uncordon,
    past: 'Uncordoned',
    icon: <CordonIcon width={16} height={16} />,
    danger: false,
    message: () => 'New pods can be scheduled on these nodes again.',
    covers: (policy) => policy.cordonActionId === OBJECT_ACTION_IDS.uncordon,
    run: (target) => runNodeUncordon(target),
  },
  {
    id: 'drain',
    actionId: OBJECT_ACTION_IDS.drain,
    past: 'Started draining',
    icon: <DrainIcon width={16} height={16} />,
    danger: true,
    message: () => 'Starts a drain on every selected node.',
    covers: (policy, object) => policy.drainEnabled && !object.drainRunning,
    run: (target, { drainOptions }) => runStartDrain(target, drainOptions),
    prompt: 'drain',
  },
  {
    id: 'delete',
    actionId: OBJECT_ACTION_IDS.delete,
    past: 'Deleted',
    icon: <DeleteIcon width={16} height={16} />,
    danger: true,
    message: () => 'This action cannot be undone.',
    covers: (policy) => policy.deleteEnabled,
    run: (target) => runObjectDelete(target),
  },
];

interface BatchEntry {
  key: string;
  object: ObjectActionData;
}

interface BatchRun {
  definition: BatchActionDefinition;
  entries: BatchEntry[];
  skipped: number;
  replicas: number;
  drainOptions?: types.DrainNodeOptions;
}

interface BatchFailure {
  entry: BatchEntry;
  reason: string;
  outcome: 'failed' | 'no-answer' | 'not-started';
}

type BatchDialog =
  | { stage: 'scale'; run: BatchRun }
  | { stage: 'drain'; run: BatchRun }
  | { stage: 'confirm'; run: BatchRun }
  | { stage: 'running'; run: BatchRun; done: number }
  | { stage: 'results'; run: BatchRun; failed: BatchFailure[] };

const unique = (values: string[]): string[] => [...new Set(values)];

const pluralKind = (kind: string): string => {
  if (/[^aeiou]y$/i.test(kind)) {
    return `${kind.slice(0, -1)}ies`;
  }
  return /(s|x|ch|sh)$/i.test(kind) ? `${kind}es` : `${kind}s`;
};

// Custom resources from different API groups can share a kind name.
const gvkOf = (object: ObjectActionData): string =>
  `${object.group}/${object.version}/${object.kind}`;

const apiVersionOf = (object: ObjectActionData): string =>
  object.group ? `${object.group}/${object.version}` : object.version;

const countNoun = (objects: readonly ObjectActionData[]): string => {
  if (unique(objects.map(gvkOf)).length > 1) {
    return 'Objects';
  }
  const { kind } = objects[0];
  return objects.length === 1 ? kind : pluralKind(kind);
};

/**
 * Lists `shown` with only the columns needed to tell every object in `objects`
 * apart, so a list of failures reads the same as the confirmation before it.
 */
const targetDetailsTable = (
  objects: readonly ObjectActionData[],
  shown: readonly ObjectActionData[],
  nameHeader: string
) => {
  const gvks = unique(objects.map(gvkOf)).length;
  const kindNames = unique(objects.map((object) => object.kind)).length;
  const namespaces = unique(objects.map((object) => object.namespace ?? '')).length;
  const columns = [
    { header: 'Kind', needed: gvks > 1, valueOf: (object: ObjectActionData) => object.kind },
    { header: 'API Version', needed: gvks > kindNames, valueOf: apiVersionOf },
    {
      header: 'Namespace',
      needed: namespaces > 1,
      valueOf: (object: ObjectActionData) => object.namespace ?? '',
    },
    {
      header: nameHeader,
      needed: true,
      monospace: true,
      valueOf: (object: ObjectActionData) => object.name,
    },
  ].filter((column) => column.needed);
  return {
    longList: true,
    columns: columns.map(({ header, monospace }) => ({ header, monospace })),
    rows: shown.map((object) => columns.map((column) => column.valueOf(object))),
  };
};

const OUTCOME_LABELS: Record<BatchFailure['outcome'], string> = {
  failed: 'Failed',
  'no-answer': 'No answer',
  'not-started': 'Not started',
};

/** The list of failures, saying what happened to each object when that differs. */
const failureDetailsTable = (run: BatchRun, failed: readonly BatchFailure[]) => {
  const mixed = unique(failed.map((failure) => failure.outcome)).length > 1;
  const table = targetDetailsTable(
    run.entries.map((entry) => entry.object),
    failed.map(({ entry }) => entry.object),
    mixed ? 'Name' : 'Failed'
  );
  if (!mixed) {
    return table;
  }
  return {
    ...table,
    columns: [...table.columns, { header: 'Result', monospace: undefined }],
    rows: table.rows.map((row, index) => [...row, OUTCOME_LABELS[failed[index].outcome]]),
  };
};

const actionTitle = (label: string, eligible: number, total: number): string =>
  eligible === total ? `${label} ${eligible}` : `${label} ${eligible} of ${total}`;

const errorReason = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const notStartedFailure = (entry: BatchEntry): BatchFailure => ({
  entry,
  reason: 'The remaining objects were not started because the cluster stopped answering.',
  outcome: 'not-started',
});

/** Runs one object; returns its failure, or null when the batch can count it done. */
const runEntry = async (run: BatchRun, entry: BatchEntry): Promise<BatchFailure | null> => {
  const { definition } = run;
  const { object } = entry;
  try {
    const action = objectActionLabel(definition.actionId).toLowerCase();
    // Bound to the object the user selected: if something else now holds its
    // name, the API server refuses the write.
    const target = { ...actionTargetFor(object, action), uid: object.uid };
    await definition.run(target, run);
    return null;
  } catch (error) {
    const status = errorStatusOf(error);
    // Already gone is what a delete asked for. The backend names the object only
    // when it confirmed that exact object is missing; a replacement answers Conflict.
    if (definition.id === 'delete' && status?.reason === 'NotFound' && status.ref) {
      return null;
    }
    errorHandler.handleInline(error, {
      source: 'useBatchObjectActions',
      action: definition.id,
      kind: object.kind,
      name: object.name,
    });
    const outcome = status?.reason === 'DeadlineExceeded' ? 'no-answer' : 'failed';
    return { entry, reason: errorReason(error), outcome };
  }
};

const executeBatch = async (
  run: BatchRun,
  onProgress: (done: number) => void,
  isAbandoned: () => boolean
): Promise<BatchFailure[]> => {
  const queue = [...run.entries];
  const failed: BatchFailure[] = [];
  let done = 0;
  const worker = async () => {
    for (let entry = queue.shift(); entry && !isAbandoned(); entry = queue.shift()) {
      const failure = await runEntry(run, entry);
      if (failure) {
        failed.push(failure);
      }
      // Each call waits out its deadline, so more calls would only hold the
      // dialog open against a cluster that is not responding.
      if (failure?.outcome === 'no-answer') {
        failed.push(...queue.splice(0).map(notStartedFailure));
      }
      done += 1;
      onProgress(done);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(BATCH_CONCURRENCY, queue.length) }, () => worker())
  );
  return failed;
};

const scopeMessage = (
  objects: readonly ObjectActionData[],
  resolveClusterName: (clusterId: string) => string | undefined
): string => {
  const namespaces = unique(objects.map((object) => object.namespace ?? '').filter(Boolean));
  const clusters = unique(objects.map((object) => object.clusterId));
  const where = namespaces.length
    ? ` in ${namespaces.length} ${namespaces.length === 1 ? 'namespace' : 'namespaces'}`
    : '';
  const on =
    clusters.length === 1
      ? `on cluster ${resolveClusterName(clusters[0]) ?? clusters[0]}`
      : `on ${clusters.length} clusters`;
  return `${objects.length} objects${where} ${on}.`;
};

const confirmationProps = (
  run: BatchRun,
  resolveClusterName: (clusterId: string) => string | undefined
) => {
  const { definition, entries, skipped, replicas } = run;
  const objects = entries.map((entry) => entry.object);
  const namespaces = unique(objects.map((object) => object.namespace ?? ''));
  const clusters = unique(objects.map((object) => object.clusterId));
  const label = objectActionLabel(definition.actionId);
  const noun = countNoun(objects);
  const oneKind = unique(objects.map(gvkOf)).length === 1 && clusters.length === 1;
  return {
    title: `${label} ${objects.length} ${noun}`,
    target: oneKind
      ? {
          clusterId: clusters[0],
          group: objects[0].group,
          kind: objects[0].kind,
          name: `${objects.length} ${noun.toLowerCase()}`,
          namespace: namespaces.length === 1 ? namespaces[0] : undefined,
        }
      : undefined,
    message: [
      oneKind ? undefined : scopeMessage(objects, resolveClusterName),
      definition.message(replicas),
    ]
      .filter(Boolean)
      .join(' '),
    detailsTable: targetDetailsTable(objects, objects, 'Name'),
    notice: skipped
      ? `${skipped} selected ${skipped === 1 ? 'object is' : 'objects are'} skipped: not available or not permitted.`
      : undefined,
    warning:
      definition.id === 'delete'
        ? nodeRemovalWarning(objects.filter(isDrainableNode).length)
        : undefined,
    confirmText: `${label} ${objects.length}`,
    confirmButtonClass: definition.danger ? 'danger' : 'generic',
  };
};

interface BatchState {
  scopeKey: string;
  active: boolean;
  selectedKeys: ReadonlySet<string>;
}

const initialBatchState = (scopeKey: string): BatchState => ({
  scopeKey,
  active: false,
  selectedKeys: NO_ROWS_SELECTED,
});

interface UseBatchObjectActionsOptions<T> {
  /** The object a row acts on; null for a row no action applies to. */
  getObject: (row: T) => ObjectActionData | null;
  /** Identifies the cluster and view scope. Changing it leaves batch-select mode. */
  scopeKey: string;
  /** Limits the actions this table offers; defaults to all of them. */
  allowedActions?: readonly BatchObjectActionId[];
  /** Runs when a batch finishes, whether or not every object succeeded. */
  onRunComplete?: (actionId: BatchObjectActionId) => void;
}

export function useBatchObjectActions<T>({
  getObject,
  scopeKey,
  allowedActions,
  onRunComplete,
}: UseBatchObjectActionsOptions<T>): {
  batchSelection: GridTableBatchSelection<T>;
  modals: React.ReactNode;
} {
  const permissionMap = useUserPermissions();
  const resolveClusterName = useClusterNameResolver();
  const [stored, setStored] = useState(() => initialBatchState(scopeKey));
  const [dialog, setDialog] = useState<BatchDialog | null>(null);
  // Reset while rendering so the old scope's selection is never painted under the
  // new one, and is gone if the mounted view returns to the old scope later. A
  // running batch keeps its dialog: it cannot be recalled, so it must report.
  if (stored.scopeKey !== scopeKey) {
    setStored(initialBatchState(scopeKey));
    if (dialog && dialog.stage !== 'running') {
      setDialog(null);
    }
  }

  const update = useCallback(
    (change: Partial<Omit<BatchState, 'scopeKey'>>) => {
      // A batch that finishes after the table moved on must not touch the new scope.
      setStored((previous) =>
        previous.scopeKey === scopeKey ? { ...previous, ...change } : previous
      );
    },
    [scopeKey]
  );

  // The dialog reports to this view. Once the view is gone nobody can see a result,
  // so objects still queued stop starting.
  const abandoned = useRef(false);
  useEffect(() => {
    abandoned.current = false;
    return () => {
      abandoned.current = true;
    };
  }, []);

  const startRun = useCallback(
    async (run: BatchRun) => {
      setDialog({ stage: 'running', run, done: 0 });
      const failed = await executeBatch(
        run,
        (done) => setDialog({ stage: 'running', run, done }),
        () => abandoned.current
      );
      onRunComplete?.(run.definition.id);
      if (failed.length === 0) {
        update({ active: false, selectedKeys: NO_ROWS_SELECTED });
        setDialog(null);
        return;
      }
      update({ selectedKeys: new Set(failed.map((failure) => failure.entry.key)) });
      setDialog({ stage: 'results', run, failed });
    },
    [onRunComplete, update]
  );

  const getActions = useCallback(
    (selected: GridTableBatchSelectedRow<T>[]): GridTableBatchAction[] => {
      const rows = selected.flatMap(({ row, key }) => {
        const object = getObject(row);
        return object
          ? [
              {
                key,
                object,
                policy: resolveObjectActionPolicy({
                  object,
                  context: 'gridtable',
                  handlers: ALL_HANDLERS,
                  permissions: resolveObjectActionPermissions(object, permissionMap),
                }),
              },
            ]
          : [];
      });
      const missing = rows.flatMap(({ object }) => missingPermissionChecks(object, permissionMap));
      if (missing.length > 0) {
        // Toolbars build their items while rendering; ask once the render is done.
        queueMicrotask(() => queryPermissionChecks(missing));
      }
      return BATCH_ACTIONS.filter(
        (definition) => !allowedActions || allowedActions.includes(definition.id)
      ).flatMap((definition) => {
        // A row with no UID could not be tied to the object the user selected.
        const entries = rows.filter(
          ({ policy, object }) => Boolean(object.uid) && definition.covers(policy, object)
        );
        if (entries.length === 0) {
          return [];
        }
        const run: BatchRun = {
          definition,
          entries: entries.map(({ key, object }) => ({ key, object })),
          skipped: rows.length - entries.length,
          replicas: 1,
        };
        return [
          {
            id: definition.id,
            icon: definition.icon,
            label: actionTitle(objectActionLabel(definition.actionId), entries.length, rows.length),
            danger: definition.danger,
            onRun: () => setDialog({ stage: definition.prompt ?? 'confirm', run }),
          },
        ];
      });
    },
    [allowedActions, getObject, permissionMap]
  );

  // A selection is of the object the user checked, not of whatever holds its
  // name later: a replacement must never inherit a pending destructive action.
  const getRowInstance = useCallback((row: T) => getObject(row)?.uid, [getObject]);

  const batchSelection = useMemo<GridTableBatchSelection<T>>(
    () => ({
      active: stored.active,
      onActiveChange: (active) => update({ active }),
      selectedKeys: stored.selectedKeys,
      onSelectedKeysChange: (selectedKeys) => update({ selectedKeys }),
      getActions,
      getRowInstance,
    }),
    [getActions, getRowInstance, stored.active, stored.selectedKeys, update]
  );

  const closeDialog = () => setDialog(null);

  const renderScale = (run: BatchRun) => (
    <ScaleModal
      isOpen
      allowUnchanged
      kind={`${run.entries.length} ${countNoun(run.entries.map((entry) => entry.object))}`}
      value={run.replicas}
      onCancel={closeDialog}
      onApply={() => setDialog({ stage: 'confirm', run })}
      onValueChange={(value) =>
        setDialog({ stage: 'scale', run: { ...run, replicas: clampReplicas(value) } })
      }
    />
  );

  const renderDrain = (run: BatchRun) => {
    const clusterId = run.entries[0].object.clusterId;
    return (
      <BatchDrainModal
        nodeNames={run.entries.map((entry) => entry.object.name)}
        clusterName={resolveClusterName(clusterId) ?? clusterId}
        skipped={run.skipped}
        permissions={resolveNodeDrainOperationPermissions(
          nodeActionPermissionInputs(permissionMap, { clusterId })
        )}
        onClose={closeDialog}
        onStart={(drainOptions) => void startRun({ ...run, drainOptions })}
      />
    );
  };

  // Retrying a node delete asks again, so its pod warning is seen before the retry.
  const retry = (run: BatchRun) => {
    const needsConfirmation =
      run.definition.id === 'delete' && run.entries.some(({ object }) => isDrainableNode(object));
    if (needsConfirmation) {
      setDialog({ stage: 'confirm', run });
    } else {
      void startRun(run);
    }
  };

  const renderResults = (run: BatchRun, failed: BatchFailure[]) => {
    const total = run.entries.length;
    const noun = countNoun(run.entries.map((entry) => entry.object));
    const { noRetryReason } = run.definition;
    const notStarted = failed.filter((failure) => failure.outcome === 'not-started').length;
    const summary =
      notStarted > 0
        ? `${failed.length - notStarted} failed, ${notStarted} not started.`
        : `${failed.length} failed.`;
    // A run keeps going across a scope change, so this can open over another cluster.
    const { target } = confirmationProps(run, resolveClusterName);
    const scope = target
      ? undefined
      : scopeMessage(
          run.entries.map((entry) => entry.object),
          resolveClusterName
        );
    return (
      <ConfirmationModal
        isOpen
        title={`${run.definition.past} ${total - failed.length} of ${total} ${noun}`}
        target={target}
        message={[scope, summary, noRetryReason].filter(Boolean).join(' ')}
        detailsTable={failureDetailsTable(run, failed)}
        warning={unique(failed.map((failure) => failure.reason)).join(' ')}
        cancelText="Close"
        confirmText={`Retry ${failed.length}`}
        confirmButtonClass="generic"
        onConfirm={
          noRetryReason
            ? undefined
            : () => retry({ ...run, entries: failed.map(({ entry }) => entry), skipped: 0 })
        }
        onCancel={closeDialog}
      />
    );
  };

  /** `done` counts finished objects once the run is under way; null before it starts. */
  const renderConfirmation = (run: BatchRun, done: number | null) => {
    const running = done !== null;
    const props = confirmationProps(run, resolveClusterName);
    return (
      <ConfirmationModal
        isOpen
        {...props}
        message={running ? `${done} of ${run.entries.length} finished.` : props.message}
        busy={running}
        onConfirm={() => void startRun(run)}
        onCancel={running ? () => undefined : closeDialog}
      />
    );
  };

  const renderDialog = (): React.ReactNode => {
    switch (dialog?.stage) {
      case 'scale':
        return renderScale(dialog.run);
      case 'drain':
        return renderDrain(dialog.run);
      case 'results':
        return renderResults(dialog.run, dialog.failed);
      case 'running':
        return renderConfirmation(dialog.run, dialog.done);
      case 'confirm':
        return renderConfirmation(dialog.run, null);
      default:
        return null;
    }
  };

  return { batchSelection, modals: renderDialog() };
}
