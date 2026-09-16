import { ConditionChips } from './shared/ConditionChips';
/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/KarpenterProgress.tsx
 *
 * Condition progress for Karpenter objects: ordered tracks of status conditions (a NodeClaim's
 * provisioning and termination, a NodePool's readiness prerequisites) rendered as steps with the
 * blocking reason underneath, followed by any remaining conditions as chips.
 */

import type { StatusChipVariant } from '@shared/components/StatusChip';
import type { ConditionFacts } from '@/core/refresh/types';
import { OverviewItem } from './shared/OverviewItem';
import './KarpenterOverview.css';

export interface ProgressTrack {
  label: string;
  /** Condition types in Karpenter's order; the last one is usually the rolled-up Ready. */
  steps: readonly string[];
  /** The roll-up condition. On its own it does not make the track worth rendering. */
  rollup?: string;
}

// Karpenter's NodeClaim root conditions (Launched, Registered, Initialized) roll up into Ready.
// Termination reports Drained, then VolumesDetached, then InstanceTerminating as the node winds
// down, mirroring the order of Karpenter's termination controller.
export const claimProgressTracks: readonly ProgressTrack[] = [
  {
    label: 'Provisioning',
    steps: ['Launched', 'Registered', 'Initialized', 'Ready'],
    rollup: 'Ready',
  },
  { label: 'Termination', steps: ['Drained', 'VolumesDetached', 'InstanceTerminating'] },
];

// A NodePool is Ready once its runtime configuration validates and its NodeClass reports Ready.
export const poolProgressTracks: readonly ProgressTrack[] = [
  {
    label: 'Readiness',
    steps: ['ValidationSucceeded', 'NodeClassReady', 'Ready'],
    rollup: 'Ready',
  },
];

type StepState = 'done' | 'failed' | 'pending';

interface LifecycleStep {
  type: string;
  state: StepState;
  reason?: string;
  message?: string;
}

const stepStates: Record<string, StepState> = { True: 'done', False: 'failed' };
const stepStateLabels: Record<StepState, string> = {
  done: 'complete',
  failed: 'failed',
  pending: 'pending',
};

const buildSteps = (types: readonly string[], conditions: ConditionFacts[]): LifecycleStep[] =>
  types.map((type) => {
    const condition = conditions.find((candidate) => candidate.type === type);
    return {
      type,
      state: stepStates[condition?.status ?? ''] ?? 'pending',
      reason: condition?.reason,
      message: condition?.message,
    };
  });

// The earliest step that has not completed and carries an explanation is what blocks progress.
const blockingStep = (steps: LifecycleStep[]): LifecycleStep | undefined =>
  steps.find((step) => step.state !== 'done' && !!(step.reason || step.message));

function KarpenterLifecycleSteps({
  label,
  steps,
}: Readonly<{ label: string; steps: LifecycleStep[] }>) {
  const blocking = blockingStep(steps);
  return (
    <div className="karpenter-lifecycle">
      <ol className="karpenter-lifecycle-steps" aria-label={`${label} steps`}>
        {steps.map((step) => (
          <li
            key={step.type}
            className={`karpenter-lifecycle-step karpenter-lifecycle-step--${step.state}`}
            data-step={step.type}
            data-state={step.state}
          >
            <span className="karpenter-lifecycle-marker" aria-hidden="true" />
            {step.type}
            <span className="sr-only">: {stepStateLabels[step.state]}</span>
          </li>
        ))}
      </ol>
      {!!blocking && (
        <p className="karpenter-lifecycle-note">
          <span className={`status-text ${blocking.state === 'failed' ? 'unhealthy' : 'warning'}`}>
            {blocking.reason ?? blocking.type}
          </span>
          {!!blocking.message && (
            <span className="karpenter-lifecycle-message selectable">{blocking.message}</span>
          )}
        </p>
      )}
    </div>
  );
}

// Drifted, Consolidatable, and DisruptionReason announce an upcoming disruption rather than
// health: True is highlighted, False is the quiet state, Unknown is still being evaluated.
const disruptionVariants: Record<string, StatusChipVariant> = {
  Drifted: 'warning',
  DisruptionReason: 'warning',
  Consolidatable: 'info',
};

const conditionVariant = (condition: ConditionFacts): StatusChipVariant => {
  const disruption = disruptionVariants[condition.type];
  if (condition.status === 'True') {
    return disruption ?? 'healthy';
  }
  if (condition.status === 'False') {
    return disruption ? 'healthy' : 'unhealthy';
  }
  return disruption ? 'info' : 'warning';
};

// A track is only worth drawing once a prerequisite step is reported; a legacy object that only
// reports the roll-up keeps that condition as a chip instead of a row of pending steps.
const isReported = (track: ProgressTrack, conditions: ConditionFacts[]): boolean =>
  conditions.some(
    (condition) => condition.type !== track.rollup && track.steps.includes(condition.type)
  );

export function KarpenterProgress({
  conditions = [],
  tracks,
}: Readonly<{ conditions?: ConditionFacts[]; tracks: readonly ProgressTrack[] }>) {
  if (!conditions.length) {
    return null;
  }
  const shown = tracks.filter((track) => isReported(track, conditions));
  const covered = new Set(shown.flatMap((track) => track.steps));
  const others = conditions.filter((condition) => !covered.has(condition.type));
  return (
    <>
      {shown.map((track) => (
        <OverviewItem
          key={track.label}
          label={track.label}
          value={
            <KarpenterLifecycleSteps
              label={track.label}
              steps={buildSteps(track.steps, conditions)}
            />
          }
        />
      ))}
      {others.length > 0 && (
        <OverviewItem
          label="Conditions"
          value={<ConditionChips conditions={others} variant={conditionVariant} />}
        />
      )}
    </>
  );
}
