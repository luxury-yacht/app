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

// Path constants for this resource type.
const volumesPath = ['spec', 'template', 'spec', 'volumes'];
const podSpecPrefix = ['spec', 'template', 'spec'];
const podTemplatePrefix = ['spec', 'template', 'metadata'];

export const jobDefinition: ResourceFormDefinition = {
  kind: 'Job',
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
          placeholder: 'job-name',
          tooltip: 'Unique name for this Job within the namespace.',
        },
        {
          key: 'namespace',
          label: 'Namespace',
          path: ['metadata', 'namespace'],
          type: 'namespace-select',
          tooltip: 'The namespace this Job will be created in.',
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
          tooltip: 'Key-value pairs attached to this Job for organization and selection.',
        },
      ],
    },
    {
      title: 'Spec',
      fields: [
        {
          key: 'backoffLimit',
          label: 'Backoff Limit',
          path: ['spec', 'backoffLimit'],
          type: 'number',
          placeholder: '6',
          min: 0,
          integer: true,
          inputWidth: '6ch',
          tooltip: 'Number of retries before marking the Job as failed. Default is 6.',
        },
        {
          key: 'completions',
          label: 'Completions',
          path: ['spec', 'completions'],
          type: 'number',
          placeholder: '1',
          min: 1,
          integer: true,
          inputWidth: '6ch',
          tooltip: 'Number of successful pod completions required. Default is 1.',
        },
        {
          key: 'parallelism',
          label: 'Parallelism',
          path: ['spec', 'parallelism'],
          type: 'number',
          placeholder: '1',
          min: 0,
          integer: true,
          inputWidth: '6ch',
          tooltip: 'Maximum number of pods running at the same time. Default is 1.',
        },
        {
          key: 'activeDeadlineSeconds',
          label: 'Active Deadline',
          path: ['spec', 'activeDeadlineSeconds'],
          type: 'number',
          min: 1,
          integer: true,
          inputWidth: '6ch',
          omitIfEmpty: true,
          tooltip: 'Maximum seconds the Job can run before it is terminated.',
        },
        {
          key: 'ttlSecondsAfterFinished',
          label: 'TTL After Finished',
          path: ['spec', 'ttlSecondsAfterFinished'],
          type: 'number',
          min: 0,
          integer: true,
          inputWidth: '6ch',
          omitIfEmpty: true,
          tooltip: 'Seconds to keep the Job after it finishes, before automatic cleanup.',
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
