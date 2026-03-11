import type { ResourceFormDefinition } from './types';

export const configMapDefinition: ResourceFormDefinition = {
  kind: 'ConfigMap',
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
          placeholder: 'configmap-name',
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
      ],
    },
    {
      title: 'Data',
      fields: [{ key: 'data', label: 'Data', path: ['data'], type: 'key-value-list' }],
    },
  ],
};
