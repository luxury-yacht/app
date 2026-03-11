import type { ResourceFormDefinition } from './types';

export const secretDefinition: ResourceFormDefinition = {
  kind: 'Secret',
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
          placeholder: 'secret-name',
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
          key: 'type',
          label: 'Type',
          path: ['type'],
          type: 'select',
          options: [
            { label: 'Opaque', value: 'Opaque' },
            { label: 'kubernetes.io/tls', value: 'kubernetes.io/tls' },
            { label: 'kubernetes.io/dockerconfigjson', value: 'kubernetes.io/dockerconfigjson' },
            { label: 'kubernetes.io/basic-auth', value: 'kubernetes.io/basic-auth' },
          ],
        },
      ],
    },
    {
      title: 'Data',
      fields: [
        { key: 'stringData', label: 'String Data', path: ['stringData'], type: 'key-value-list' },
      ],
    },
  ],
};
