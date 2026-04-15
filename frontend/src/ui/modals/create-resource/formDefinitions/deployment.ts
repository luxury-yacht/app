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

export const deploymentDefinition: ResourceFormDefinition = {
  kind: 'Deployment',
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
          placeholder: 'deployment-name',
          tooltip: 'Unique name for this Deployment within the namespace.',
        },
        {
          key: 'namespace',
          label: 'Namespace',
          path: ['metadata', 'namespace'],
          type: 'namespace-select',
          tooltip: 'The namespace this Deployment will be created in.',
        },
        {
          key: 'replicas',
          label: 'Replicas',
          path: ['spec', 'replicas'],
          type: 'number',
          placeholder: '1',
          min: 0,
          max: 999,
          integer: true,
          inputWidth: '6ch',
          tooltip: 'Number of desired pod instances to run.',
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
          tooltip:
            'Arbitrary key-value metadata for tools, libraries, and external systems. Not used for selection.',
        },
        {
          key: 'labels',
          label: 'Labels',
          path: ['metadata', 'labels'],
          type: 'labels-with-selectors',
          selectorPaths: [
            ['spec', 'selector', 'matchLabels'],
            ['spec', 'template', 'metadata', 'labels'],
          ],
          tooltip:
            'Key-value pairs attached to this Deployment. Drag a label into the Selectors group to use it for pod selection — selectors are mirrored to the pod template so they match managed pods.',
        },
      ],
    },
    {
      title: 'Containers',
      fields: [
        {
          key: 'containers',
          label: 'Containers',
          path: ['spec', 'template', 'spec', 'containers'],
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
          path: ['spec', 'template', 'spec', 'initContainers'],
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
        // --- Deployment-level strategy ---
        {
          key: 'strategyType',
          label: 'Strategy',
          path: ['spec', 'strategy', 'type'],
          type: 'select',
          dropdownWidth: 'calc(11ch + 40px)',
          tooltip:
            'RollingUpdate gradually replaces pods. Recreate kills all existing pods before creating new ones.',
          clearPaths: [['spec', 'strategy']],
          clearPathsOnValues: {
            Recreate: [['spec', 'strategy', 'rollingUpdate']],
          },
          options: [
            { label: 'RollingUpdate', value: 'RollingUpdate' },
            { label: 'Recreate', value: 'Recreate' },
          ],
          groupWithNext: true,
        },
        {
          key: 'maxSurge',
          label: 'Max Surge',
          path: ['spec', 'strategy', 'rollingUpdate', 'maxSurge'],
          type: 'text',
          placeholder: '25%',
          omitIfEmpty: true,
          inputWidth: 'calc(6ch + 20px)',
          groupWithNext: true,
          visibleWhen: { path: ['spec', 'strategy', 'type'], values: ['RollingUpdate'] },
          tooltip:
            'Maximum number of pods that can be created above the desired count during a rolling update. Can be a number or percentage.',
        },
        {
          key: 'maxUnavailable',
          label: 'Max Unavailable',
          path: ['spec', 'strategy', 'rollingUpdate', 'maxUnavailable'],
          type: 'text',
          placeholder: '25%',
          omitIfEmpty: true,
          inputWidth: 'calc(6ch + 20px)',
          visibleWhen: { path: ['spec', 'strategy', 'type'], values: ['RollingUpdate'] },
          tooltip:
            'Maximum number of pods that can be unavailable during a rolling update. Can be a number or percentage.',
        },
        // --- Deployment-level numbers ---
        {
          key: 'minReadySeconds',
          label: 'Min Ready Secs',
          path: ['spec', 'minReadySeconds'],
          type: 'number',
          placeholder: '0',
          min: 0,
          integer: true,
          inputWidth: '6ch',
          tooltip:
            'Minimum seconds a new pod must be ready without crashing before it is considered available.',
        },
        {
          key: 'progressDeadlineSeconds',
          label: 'Progress Deadline',
          path: ['spec', 'progressDeadlineSeconds'],
          type: 'number',
          placeholder: '600',
          min: 0,
          integer: true,
          inputWidth: '6ch',
          tooltip:
            'Maximum seconds for a deployment to make progress before it is considered failed.',
        },
        {
          key: 'revisionHistoryLimit',
          label: 'Revision History',
          path: ['spec', 'revisionHistoryLimit'],
          type: 'number',
          placeholder: '10',
          min: 0,
          integer: true,
          inputWidth: '6ch',
          tooltip: 'Number of old ReplicaSets to retain for rollback. Set to 0 to disable.',
        },
        // --- Pod-spec-level fields ---
        ...makeAdvancedPodSpecFields(podSpecPrefix),
        {
          key: 'restartPolicy',
          label: 'Restart Policy',
          path: [...podSpecPrefix, 'restartPolicy'],
          type: 'select',
          options: [{ label: 'Always', value: 'Always' }],
          tooltip: 'Restart policy for containers in the pod. Deployments require Always.',
        },
        makePodAnnotationsField(podTemplatePrefix),
        makeImagePullSecretsField(podSpecPrefix),
      ],
    },
  ],
};
