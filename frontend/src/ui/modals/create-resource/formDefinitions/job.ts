import type { ResourceFormDefinition } from './types';

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
          placeholder: 'job-name',
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
          key: 'backoffLimit',
          label: 'Backoff Limit',
          path: ['spec', 'backoffLimit'],
          type: 'number',
          placeholder: '3',
        },
        {
          key: 'restartPolicy',
          label: 'Restart Policy',
          path: ['spec', 'template', 'spec', 'restartPolicy'],
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
          path: ['spec', 'template', 'spec', 'containers'],
          type: 'group-list',
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
              type: 'text',
              placeholder: 'echo,Hello',
            },
          ],
          defaultValue: { name: '', image: '', command: [] },
        },
      ],
    },
  ],
};
