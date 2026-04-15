import type { ResourceFormDefinition } from './types';
import {
  makeContainerSubFields,
  containerDefaultValue,
  volumeSubFields,
  volumeDefaultValue,
  makeAdvancedPodSpecFields,
  makePodAnnotationsField,
  makeImagePullSecretsField,
} from './shared';

// Path constants for this resource type (extra nesting via jobTemplate).
const volumesPath = ['spec', 'jobTemplate', 'spec', 'template', 'spec', 'volumes'];
const podSpecPrefix = ['spec', 'jobTemplate', 'spec', 'template', 'spec'];
const podTemplatePrefix = ['spec', 'jobTemplate', 'spec', 'template', 'metadata'];

export const cronJobDefinition: ResourceFormDefinition = {
  kind: 'CronJob',
  sections: [
    {
      title: 'Metadata',
      fields: [
        {
          key: 'name',
          label: 'Name',
          path: ['metadata', 'name'],
          type: 'text',
          required: true,
          placeholder: 'cronjob-name',
          tooltip: 'Unique name for this CronJob within the namespace.',
        },
        {
          key: 'namespace',
          label: 'Namespace',
          path: ['metadata', 'namespace'],
          type: 'namespace-select',
          tooltip: 'The namespace this CronJob will be created in.',
        },
        {
          key: 'annotations',
          label: 'Annotations',
          path: ['metadata', 'annotations'],
          type: 'key-value-list',
          addLabel: 'Add Annotation',
          addGhostText: 'Add annotation',
          inlineLabels: true,
          leftAlignEmptyActions: true,
          blankNewKeys: true,
          tooltip: 'Arbitrary key-value metadata for tools, libraries, and external systems.',
        },
        {
          key: 'labels',
          label: 'Labels',
          path: ['metadata', 'labels'],
          type: 'key-value-list',
          addLabel: 'Add Label',
          addGhostText: 'Add label',
          inlineLabels: true,
          leftAlignEmptyActions: true,
          blankNewKeys: true,
          tooltip: 'Key-value pairs attached to this CronJob for organization and selection.',
        },
      ],
    },
    {
      title: 'Schedule & Job',
      fields: [
        {
          key: 'schedule',
          label: 'Schedule',
          path: ['spec', 'schedule'],
          type: 'text',
          required: true,
          placeholder: '0 * * * *',
          tooltip: 'Cron expression defining when the Job runs (minute hour day month weekday).',
        },
        {
          key: 'concurrencyPolicy',
          label: 'Concurrency',
          path: ['spec', 'concurrencyPolicy'],
          type: 'select',
          options: [
            { label: 'Allow', value: 'Allow' },
            { label: 'Forbid', value: 'Forbid' },
            { label: 'Replace', value: 'Replace' },
          ],
          tooltip:
            'How to handle concurrent Job runs. Allow runs them in parallel, Forbid skips new runs, Replace cancels the current run.',
        },
        {
          key: 'suspend',
          label: 'Suspend',
          path: ['spec', 'suspend'],
          type: 'boolean-toggle',
          tooltip: 'If true, subsequent runs are suspended. Does not affect already running Jobs.',
        },
        {
          key: 'startingDeadlineSeconds',
          label: 'Starting Deadline',
          path: ['spec', 'startingDeadlineSeconds'],
          type: 'number',
          min: 0,
          integer: true,
          inputWidth: '6ch',
          omitIfEmpty: true,
          tooltip: 'Seconds after the scheduled time within which the Job can still be started.',
        },
        {
          key: 'successfulJobsHistoryLimit',
          label: 'Success History',
          path: ['spec', 'successfulJobsHistoryLimit'],
          type: 'number',
          placeholder: '3',
          min: 0,
          integer: true,
          inputWidth: '6ch',
          tooltip: 'Number of successful finished Jobs to retain. Default is 3.',
        },
        {
          key: 'failedJobsHistoryLimit',
          label: 'Failure History',
          path: ['spec', 'failedJobsHistoryLimit'],
          type: 'number',
          placeholder: '1',
          min: 0,
          integer: true,
          inputWidth: '6ch',
          tooltip: 'Number of failed finished Jobs to retain. Default is 1.',
        },
        {
          key: 'backoffLimit',
          label: 'Backoff Limit',
          path: ['spec', 'jobTemplate', 'spec', 'backoffLimit'],
          type: 'number',
          placeholder: '6',
          min: 0,
          integer: true,
          inputWidth: '6ch',
          tooltip: 'Number of retries before marking each Job as failed. Default is 6.',
        },
        {
          key: 'restartPolicy',
          label: 'Restart Policy',
          path: [...podSpecPrefix, 'restartPolicy'],
          type: 'select',
          options: [
            { label: 'Never', value: 'Never' },
            { label: 'OnFailure', value: 'OnFailure' },
          ],
          tooltip: 'Restart policy for containers in the pod. Jobs support Never or OnFailure.',
        },
      ],
    },
    {
      title: 'Containers',
      fields: [
        {
          key: 'containers',
          label: 'Containers',
          path: [...podSpecPrefix, 'containers'],
          type: 'group-list',
          fullWidth: true,
          itemTitleField: 'name',
          itemTitleFallback: 'Container',
          fields: makeContainerSubFields(volumesPath),
          defaultValue: containerDefaultValue,
        },
      ],
    },
    {
      title: 'Init Containers',
      fields: [
        {
          key: 'initContainers',
          label: 'Init Containers',
          path: [...podSpecPrefix, 'initContainers'],
          type: 'group-list',
          fullWidth: true,
          itemTitleField: 'name',
          itemTitleFallback: 'Init Container',
          fields: makeContainerSubFields(volumesPath),
          defaultValue: containerDefaultValue,
        },
      ],
    },
    {
      title: 'Volumes',
      fields: [
        {
          key: 'volumes',
          label: 'Volumes',
          path: volumesPath,
          type: 'group-list',
          fullWidth: true,
          itemTitleField: 'name',
          itemTitleFallback: 'Volume',
          fields: volumeSubFields,
          defaultValue: volumeDefaultValue,
        },
      ],
    },
    {
      title: 'Advanced',
      labelWidth: '10rem',
      fields: [
        ...makeAdvancedPodSpecFields(podSpecPrefix),
        makePodAnnotationsField(podTemplatePrefix),
        makeImagePullSecretsField(podSpecPrefix),
      ],
    },
  ],
};
