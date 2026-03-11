import type { ResourceFormDefinition } from './types';

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
        },
        {
          key: 'namespace',
          label: 'Namespace',
          path: ['metadata', 'namespace'],
          type: 'namespace-select',
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
        },
        {
          key: 'schedule',
          label: 'Schedule',
          path: ['spec', 'schedule'],
          type: 'text',
          placeholder: '0 * * * *',
        },
        {
          key: 'backoffLimit',
          label: 'Backoff Limit',
          path: ['spec', 'jobTemplate', 'spec', 'backoffLimit'],
          type: 'number',
          placeholder: '3',
        },
        {
          key: 'restartPolicy',
          label: 'Restart Policy',
          path: ['spec', 'jobTemplate', 'spec', 'template', 'spec', 'restartPolicy'],
          type: 'select',
          options: [
            { label: 'Never', value: 'Never' },
            { label: 'OnFailure', value: 'OnFailure' },
          ],
        },
      ],
    },
    {
      title: 'Containers',
      fields: [
        {
          key: 'containers',
          label: 'Containers',
          path: ['spec', 'jobTemplate', 'spec', 'template', 'spec', 'containers'],
          type: 'group-list',
          fullWidth: true,
          itemTitleField: 'name',
          itemTitleFallback: 'Container',
          fields: [
            {
              key: 'name',
              label: 'Name',
              path: ['name'],
              type: 'text',
              placeholder: 'container-name',
            },
            {
              key: 'image',
              label: 'Image',
              path: ['image'],
              type: 'text',
              placeholder: 'busybox:latest',
            },
            {
              key: 'resources',
              label: 'Resources',
              path: ['resources'],
              type: 'container-resources',
            },
            {
              key: 'command',
              label: 'Command',
              path: ['command'],
              type: 'command-input',
              placeholder: 'echo Hello',
              omitIfEmpty: false,
            },
          ],
          defaultValue: { name: '', image: '' },
        },
      ],
    },
  ],
};
