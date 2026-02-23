/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/JobOverview.tsx
 */

import React from 'react';
import { OverviewItem } from '@modules/object-panel/components/ObjectPanel/Details/Overview/shared/OverviewItem';
import { ResourceHeader } from '@shared/components/kubernetes/ResourceHeader';

interface JobOverviewProps {
  kind?: string;
  name?: string;
  namespace?: string;
  age?: string;
  // Job fields
  completions?: number;
  succeeded?: number;
  active?: number | string;
  failed?: number;
  duration?: string;
  parallelism?: number;
  backoffLimit?: number;
  // CronJob fields
  schedule?: string;
  suspend?: boolean;
  activeJobs?: number | any[];
  lastScheduleTime?: string | any;
  successfulJobsHistory?: number;
  failedJobsHistory?: number;
}

// Job and CronJob Overview
export const JobOverview: React.FC<JobOverviewProps> = (props) => {
  const { kind, name, namespace, age } = props;
  const isJob = props.kind?.toLowerCase() === 'job';
  const isCronJob = props.kind?.toLowerCase() === 'cronjob';

  return (
    <>
      <ResourceHeader kind={kind || ''} name={name || ''} namespace={namespace} age={age} />

      {/* Job-specific fields */}
      {isJob && (
        <>
          {/* Job status - show completions prominently */}
          {props.completions && (
            <OverviewItem
              label="Completions"
              value={
                props.succeeded === props.completions ? (
                  <span className="status-badge success">{`${props.succeeded}/${props.completions} Complete`}</span>
                ) : (
                  `${props.succeeded || 0}/${props.completions}`
                )
              }
            />
          )}

          {/* Active/Failed status - only show if non-zero */}
          {props.active && Number(props.active) > 0 && (
            <OverviewItem
              label="Active"
              value={<span className="status-badge running">{props.active}</span>}
            />
          )}

          {props.failed && props.failed > 0 && (
            <OverviewItem
              label="Failed"
              value={<span className="status-badge error">{props.failed}</span>}
            />
          )}

          {/* Duration if available */}
          {props.duration && <OverviewItem label="Duration" value={props.duration} />}

          {/* Configuration - only show non-defaults */}
          {props.parallelism && props.parallelism > 1 && (
            <OverviewItem label="Parallelism" value={props.parallelism} />
          )}

          {props.backoffLimit !== undefined && props.backoffLimit !== 6 && (
            <OverviewItem label="Backoff Limit" value={props.backoffLimit} />
          )}
        </>
      )}

      {/* CronJob-specific fields */}
      {isCronJob && (
        <>
          {/* Schedule is the most important */}
          <OverviewItem label="Schedule" value={<code>{props.schedule}</code>} />

          {/* Suspended state - highlight if suspended */}
          {props.suspend && (
            <OverviewItem
              label="Status"
              value={<span className="status-badge paused">Suspended</span>}
            />
          )}

          {/* Active jobs - only show if there are any */}
          {props.activeJobs &&
            (Array.isArray(props.activeJobs) ? props.activeJobs.length : props.activeJobs) > 0 && (
              <OverviewItem
                label="Active Jobs"
                value={
                  <span className="status-badge running">
                    {Array.isArray(props.activeJobs) ? props.activeJobs.length : props.activeJobs}
                  </span>
                }
              />
            )}

          {/* Last scheduled time */}
          <OverviewItem label="Last Scheduled" value={props.lastScheduleTime || 'Never'} />

          {/* History - combine into a single line if both exist */}
          {((props.successfulJobsHistory && props.successfulJobsHistory > 0) ||
            (props.failedJobsHistory && props.failedJobsHistory > 0)) && (
            <OverviewItem
              label="History"
              value={`${props.successfulJobsHistory || 0} succeeded, ${props.failedJobsHistory || 0} failed`}
            />
          )}
        </>
      )}
    </>
  );
};
