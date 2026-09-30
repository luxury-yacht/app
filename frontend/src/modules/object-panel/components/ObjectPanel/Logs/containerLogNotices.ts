/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Logs/containerLogNotices.ts
 *
 * Turns typed container-log warnings, per-container issues, buffer truncation
 * and the live stream's phase into the notices shown above the log lines.
 */

import type {
  ContainerLogsStreamPhase,
  ContainerLogsTargetIssue,
  ContainerLogsWarning,
} from '@/core/refresh/types';

export const LIVE_LOGS_UNAVAILABLE_MESSAGE =
  'Logs are not available yet for the selected pod or container';
export const PREVIOUS_LOGS_UNAVAILABLE_MESSAGE =
  'No previous logs are available for the selected pod or container yet';
export const RETRY_HINT = 'Turn auto-refresh back on (R) to retry.';

const MAX_LISTED_CONTAINERS = 3;

const plural = (count: number, singular: string, pluralForm: string) =>
  count === 1 ? singular : pluralForm;

const targetLimitNotice = (warnings: ContainerLogsWarning[]): string | null => {
  const limits = warnings.filter((warning) => warning.kind === 'targetLimit');
  if (limits.length === 0) {
    return null;
  }
  const hidden = limits.reduce((sum, warning) => sum + (warning.hidden ?? 0), 0);
  const perTab = limits.find((warning) => warning.scope === 'perTab');
  const global = limits.find((warning) => warning.scope === 'global');
  return `Logs are hidden for ${hidden} containers because ${limitsReached(perTab, global)}. Using filters to reduce the number of containers may clear this message.`;
};

const limitsReached = (
  perTab: ContainerLogsWarning | undefined,
  global: ContainerLogsWarning | undefined
): string => {
  if (perTab && global) {
    return `the per-tab limit of ${perTab.limit} and global limit of ${global.limit} were reached`;
  }
  const scope = perTab ? 'per-tab' : 'global';
  return `the ${scope} limit of ${(perTab ?? global)?.limit} was reached`;
};

const droppedNotice = (warnings: ContainerLogsWarning[]): string | null => {
  const count = warnings
    .filter((warning) => warning.kind === 'dropped')
    .reduce((sum, warning) => sum + (warning.count ?? 0), 0);
  if (count === 0) {
    return null;
  }
  return `Dropped ${count} log ${plural(count, 'entry', 'entries')} because the log view fell behind. These lines were not filtered out.`;
};

const containerLabel = (issue: ContainerLogsTargetIssue) => `${issue.pod}/${issue.container}`;

const listIssues = (issues: ContainerLogsTargetIssue[], withReason: boolean): string => {
  const listed = issues
    .slice(0, MAX_LISTED_CONTAINERS)
    .map((issue) =>
      withReason ? `${containerLabel(issue)}: ${issue.reason}` : containerLabel(issue)
    );
  const more = issues.length - listed.length;
  return more > 0 ? `${listed.join('; ')}; and ${more} more` : listed.join('; ');
};

const issueNotices = (issues: ContainerLogsTargetIssue[]): string[] => {
  const unreadable = issues.filter((issue) => issue.state !== 'unavailable');
  const waiting = issues.filter((issue) => issue.state === 'unavailable');
  const notices: string[] = [];
  if (unreadable.length > 0) {
    notices.push(
      `Logs cannot be read for ${unreadable.length} ${plural(unreadable.length, 'container', 'containers')}: ${listIssues(unreadable, true)}.`
    );
  }
  if (waiting.length > 0) {
    notices.push(
      `Logs are not available yet for ${waiting.length} ${plural(waiting.length, 'container', 'containers')}: ${listIssues(waiting, false)}.`
    );
  }
  return notices;
};

const phaseNotice = (phase: ContainerLogsStreamPhase | null): string | null => {
  if (phase?.status === 'reconnecting') {
    return `Reconnecting to live logs (${phase.reason}).`;
  }
  if (phase?.status === 'failed') {
    return `Live logs stopped: ${phase.reason}. ${RETRY_HINT}`;
  }
  return null;
};

export type ContainerLogNoticeInput = {
  phase: ContainerLogsStreamPhase | null;
  warnings: ContainerLogsWarning[];
  issues: ContainerLogsTargetIssue[];
};

/** The notices to show above the log lines, most important first. */
export const buildContainerLogNotices = ({
  phase,
  warnings,
  issues,
}: ContainerLogNoticeInput): string[] =>
  [
    phaseNotice(phase),
    ...issueNotices(issues),
    targetLimitNotice(warnings),
    droppedNotice(warnings),
  ].filter((notice): notice is string => notice !== null);

/** True when every target reported that it has no readable log yet. */
export const onlyUnavailableIssues = (issues: ContainerLogsTargetIssue[]): boolean =>
  issues.length > 0 && issues.every((issue) => issue.state === 'unavailable');
