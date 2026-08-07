import { DrainProgressCard } from '@shared/components/drain/DrainProgressCard';
import { ErrorSurface } from '@shared/components/errors/ErrorSurface';
import { DrainIcon } from '@shared/components/icons/SharedIcons';
import Tooltip from '@shared/components/Tooltip';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { NodeMaintenanceDrainJob } from '@/core/refresh/types';
import {
  type DrainOptionsState,
  MAX_NODE_DRAIN_GRACE_SECONDS,
  normalizeGraceSeconds,
  normalizeTimeoutSeconds,
  resolveDrainStartLabel,
} from './drainNodeModalModel';
import ModalHeader from './ModalHeader';
import ModalSurface from './ModalSurface';

const DRAIN_OPTION_TOOLTIPS = {
  ignoreDaemonSets:
    'DaemonSet pods are expected to run on every matching node. Leave this on for normal drains so those pods do not block the operation.',
  deleteEmptyDirData:
    'Allows draining pods that use emptyDir volumes. Data in those volumes is node-local and is lost when the pod is removed.',
  disableEviction:
    'Deletes pods directly instead of using the eviction API. This bypasses PodDisruptionBudget protection and should only be used when eviction cannot make progress.',
  skipWait:
    'Submits the pod evictions or deletions and completes the job without waiting for the pods to terminate.',
  gracePeriod:
    'Overrides each pod termination grace period. Leave disabled to use the grace period defined by each pod.',
  timeout:
    'Sets how long the drain waits for pod termination before failing. Leave disabled for no drain timeout.',
  force:
    'Allows deletion of pods that are not managed by a controller. Without this, unmanaged pods block the drain to avoid accidental workload loss.',
} as const;

type UpdateDrainOption = <K extends keyof DrainOptionsState>(
  field: K,
  value: DrainOptionsState[K]
) => void;

interface DrainOptionsSectionProps {
  activeDrainJob: NodeMaintenanceDrainJob | null;
  drainPending: boolean;
  options: DrainOptionsState;
  hasCustomGrace: boolean;
  hasCustomTimeout: boolean;
  customGraceSeconds: number;
  customTimeoutSeconds: number;
  setCustomGraceSeconds: Dispatch<SetStateAction<number>>;
  setCustomTimeoutSeconds: Dispatch<SetStateAction<number>>;
  updateDrainOption: UpdateDrainOption;
}

const DrainOptionsSection = ({
  activeDrainJob,
  drainPending,
  options,
  hasCustomGrace,
  hasCustomTimeout,
  customGraceSeconds,
  customTimeoutSeconds,
  setCustomGraceSeconds,
  setCustomTimeoutSeconds,
  updateDrainOption,
}: DrainOptionsSectionProps) => {
  if (activeDrainJob) {
    return null;
  }

  return (
    <details className="drain-node-modal-advanced">
      <summary>Advanced Options</summary>
      <fieldset className="drain-node-modal-options" disabled={drainPending}>
        <label className="drain-node-modal-checkbox">
          <input
            data-test="drain-modal-ignore-daemonsets"
            type="checkbox"
            checked={Boolean(options.ignoreDaemonSets)}
            onChange={(event) => updateDrainOption('ignoreDaemonSets', event.target.checked)}
          />
          <span>Ignore DaemonSet pods</span>
          <Tooltip content={DRAIN_OPTION_TOOLTIPS.ignoreDaemonSets} maxWidth={320} />
        </label>
        <label className="drain-node-modal-checkbox">
          <input
            data-test="drain-modal-delete-emptydir"
            type="checkbox"
            checked={Boolean(options.deleteEmptyDirData)}
            onChange={(event) => updateDrainOption('deleteEmptyDirData', event.target.checked)}
          />
          <span>Remove pods with emptyDir volumes</span>
          <Tooltip content={DRAIN_OPTION_TOOLTIPS.deleteEmptyDirData} maxWidth={320} />
        </label>
        <label className="drain-node-modal-checkbox">
          <input
            data-test="drain-modal-disable-eviction"
            type="checkbox"
            checked={Boolean(options.disableEviction)}
            onChange={(event) => updateDrainOption('disableEviction', event.target.checked)}
          />
          <span>Delete instead of evict</span>
          <Tooltip content={DRAIN_OPTION_TOOLTIPS.disableEviction} maxWidth={320} />
        </label>
        <label className="drain-node-modal-checkbox">
          <input
            data-test="drain-modal-skip-wait"
            type="checkbox"
            checked={Boolean(options.skipWaitForPodsToTerminate)}
            onChange={(event) =>
              updateDrainOption('skipWaitForPodsToTerminate', event.target.checked)
            }
          />
          <span>Skip wait for pod termination</span>
          <Tooltip content={DRAIN_OPTION_TOOLTIPS.skipWait} maxWidth={320} />
        </label>
        <label className="drain-node-modal-checkbox">
          <input
            data-test="drain-modal-force"
            type="checkbox"
            checked={Boolean(options.force)}
            onChange={(event) => updateDrainOption('force', event.target.checked)}
          />
          <span>Allow deleting unmanaged pods</span>
          <Tooltip content={DRAIN_OPTION_TOOLTIPS.force} maxWidth={320} />
        </label>
        <label className="drain-node-modal-checkbox drain-node-modal-grace">
          <input
            data-test="drain-modal-grace-toggle"
            type="checkbox"
            checked={hasCustomGrace}
            onChange={(event) =>
              updateDrainOption(
                'gracePeriodSeconds',
                event.target.checked ? customGraceSeconds : undefined
              )
            }
          />
          <span className="drain-node-modal-grace-label">Override grace period</span>
          <input
            type="number"
            min={1}
            max={MAX_NODE_DRAIN_GRACE_SECONDS}
            value={customGraceSeconds}
            disabled={!hasCustomGrace}
            onChange={(event) => {
              const normalized = normalizeGraceSeconds(Number(event.target.value));
              setCustomGraceSeconds(normalized);
              if (hasCustomGrace) {
                updateDrainOption('gracePeriodSeconds', normalized);
              }
            }}
          />
          <span className="drain-node-modal-grace-unit">seconds</span>
          <Tooltip content={DRAIN_OPTION_TOOLTIPS.gracePeriod} maxWidth={320} />
        </label>
        <label className="drain-node-modal-checkbox drain-node-modal-grace">
          <input
            data-test="drain-modal-timeout-toggle"
            type="checkbox"
            checked={hasCustomTimeout}
            onChange={(event) =>
              updateDrainOption(
                'timeoutSeconds',
                event.target.checked ? customTimeoutSeconds : undefined
              )
            }
          />
          <span className="drain-node-modal-grace-label">Drain timeout</span>
          <input
            data-test="drain-modal-timeout-input"
            type="number"
            min={1}
            value={customTimeoutSeconds}
            disabled={!hasCustomTimeout}
            onChange={(event) => {
              const normalized = normalizeTimeoutSeconds(Number(event.target.value));
              setCustomTimeoutSeconds(normalized);
              if (hasCustomTimeout) {
                updateDrainOption('timeoutSeconds', normalized);
              }
            }}
          />
          <span className="drain-node-modal-grace-unit">seconds</span>
          <Tooltip content={DRAIN_OPTION_TOOLTIPS.timeout} maxWidth={320} />
        </label>
      </fieldset>
    </details>
  );
};

interface CurrentDrainProps {
  activeDrainJob: NodeMaintenanceDrainJob | null;
  primaryDrainJob: NodeMaintenanceDrainJob | null;
  cancelDrainPending: boolean;
  cancelPermissionReason: string | null;
  onCancel: () => void;
}

const CurrentDrain = ({
  activeDrainJob,
  primaryDrainJob,
  cancelDrainPending,
  cancelPermissionReason,
  onCancel,
}: CurrentDrainProps) => {
  if (!primaryDrainJob) {
    return null;
  }
  const isActive = activeDrainJob?.id === primaryDrainJob.id;
  return (
    <div className="drain-node-modal-current">
      <DrainProgressCard
        job={primaryDrainJob}
        isActive={isActive}
        onCancel={isActive ? onCancel : undefined}
        cancelDisabled={
          isActive ? cancelDrainPending || Boolean(cancelPermissionReason) : undefined
        }
        cancelDisabledReason={isActive ? cancelPermissionReason : undefined}
      />
    </div>
  );
};

const EarlierDrainHistory = ({ jobs }: { jobs: NodeMaintenanceDrainJob[] }) => {
  if (jobs.length === 0) {
    return null;
  }
  return (
    <div className="drain-node-modal-history">
      <div className="drain-node-modal-history-label">Earlier drains</div>
      {jobs.map((job) => (
        <div key={job.id} className="drain-node-modal-history-entry">
          <DrainProgressCard job={job} isActive={false} />
        </div>
      ))}
    </div>
  );
};

interface DrainModalFeedbackProps {
  showLoading: boolean;
  drainError: string | null;
  showPermissionReason: boolean;
  startPermissionReason: string | null;
}

const DrainModalFeedback = ({
  showLoading,
  drainError,
  showPermissionReason,
  startPermissionReason,
}: DrainModalFeedbackProps) => (
  <>
    {showLoading ? <div className="drain-node-modal-helper">Loading drain status…</div> : null}
    {drainError ? (
      <div className="drain-node-modal-error">
        <ErrorSurface kind="reported" message={drainError} />
      </div>
    ) : null}
    {showPermissionReason ? (
      <div className="drain-node-modal-helper" data-test="drain-modal-permission-reason">
        {startPermissionReason}
      </div>
    ) : null}
  </>
);

interface DrainModalFooterProps {
  activeDrainJob: NodeMaintenanceDrainJob | null;
  closeLabel: 'Cancel' | 'Close';
  drainPending: boolean;
  isRetry: boolean;
  startDisabled: boolean;
  onClose: () => void;
  onStart: () => void;
}

const DrainModalFooter = ({
  activeDrainJob,
  closeLabel,
  drainPending,
  isRetry,
  startDisabled,
  onClose,
  onStart,
}: DrainModalFooterProps) => {
  const renderedCloseLabel = activeDrainJob ? 'Close' : closeLabel;
  return (
    <div className="modal-footer drain-node-modal-footer">
      <button type="button" className="button cancel" onClick={onClose}>
        {renderedCloseLabel}
      </button>
      {activeDrainJob ? null : (
        <button
          type="button"
          className="button danger"
          onClick={onStart}
          disabled={startDisabled}
          data-test={isRetry ? 'drain-modal-retry' : 'drain-modal-start'}
        >
          {resolveDrainStartLabel(drainPending, isRetry)}
        </button>
      )}
    </div>
  );
};

export interface DrainNodeModalViewProps extends DrainOptionsSectionProps {
  modalRef: RefObject<HTMLDivElement | null>;
  clusterName?: string;
  nodeName: string;
  primaryDrainJob: NodeMaintenanceDrainJob | null;
  earlierDrains: NodeMaintenanceDrainJob[];
  cancelDrainPending: boolean;
  cancelPermissionReason: string | null;
  drainsLoading: boolean;
  drainError: string | null;
  startPermissionReason: string | null;
  startDisabled: boolean;
  isRetry: boolean;
  closeLabel: 'Cancel' | 'Close';
  onClose: () => void;
  onStart: () => void;
  onCancel: () => void;
}

export const DrainNodeModalView = ({
  modalRef,
  clusterName,
  nodeName,
  primaryDrainJob,
  earlierDrains,
  cancelDrainPending,
  cancelPermissionReason,
  drainsLoading,
  drainError,
  startPermissionReason,
  startDisabled,
  isRetry,
  closeLabel,
  onClose,
  onStart,
  onCancel,
  ...optionsProps
}: DrainNodeModalViewProps) => (
  <ModalSurface
    modalRef={modalRef}
    labelledBy="drain-node-modal-title"
    onClose={onClose}
    containerClassName="drain-node-modal"
    closeOnBackdrop={false}
  >
    <ModalHeader
      title="Drain Node"
      titleId="drain-node-modal-title"
      icon={DrainIcon}
      onClose={onClose}
    />
    <div className="drain-node-modal-body">
      <div className="drain-node-modal-target">
        <span className="drain-node-modal-label">Node:</span>
        <span className="drain-node-modal-value">{nodeName}</span>
        {!!clusterName && (
          <>
            <span className="drain-node-modal-label">Cluster:</span>
            <span className="drain-node-modal-value">{clusterName}</span>
          </>
        )}
      </div>
      <CurrentDrain
        activeDrainJob={optionsProps.activeDrainJob}
        primaryDrainJob={primaryDrainJob}
        cancelDrainPending={cancelDrainPending}
        cancelPermissionReason={cancelPermissionReason}
        onCancel={onCancel}
      />
      <DrainOptionsSection {...optionsProps} />
      <DrainModalFeedback
        showLoading={drainsLoading && !primaryDrainJob && earlierDrains.length === 0}
        drainError={drainError}
        showPermissionReason={!optionsProps.activeDrainJob && Boolean(startPermissionReason)}
        startPermissionReason={startPermissionReason}
      />
      <EarlierDrainHistory jobs={earlierDrains} />
    </div>
    <DrainModalFooter
      activeDrainJob={optionsProps.activeDrainJob}
      closeLabel={closeLabel}
      drainPending={optionsProps.drainPending}
      isRetry={isRetry}
      startDisabled={startDisabled}
      onClose={onClose}
      onStart={onStart}
    />
  </ModalSurface>
);
