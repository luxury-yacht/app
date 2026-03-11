import type { ResourceFormDefinition } from './types';

export const serviceDefinition: ResourceFormDefinition = {
  kind: 'Service',
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
          placeholder: 'service-name',
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
      title: 'Spec',
      fields: [
        {
          key: 'type',
          label: 'Type',
          path: ['spec', 'type'],
          type: 'select',
          options: [
            { label: 'ClusterIP', value: 'ClusterIP' },
            { label: 'NodePort', value: 'NodePort' },
            { label: 'LoadBalancer', value: 'LoadBalancer' },
          ],
        },
        { key: 'selector', label: 'Selector', path: ['spec', 'selector'], type: 'key-value-list' },
        {
          key: 'ports',
          label: 'Ports',
          path: ['spec', 'ports'],
          type: 'group-list',
          fields: [
            {
              key: 'name',
              label: 'Name',
              path: ['name'],
              type: 'text',
              placeholder: 'optional',
              omitIfEmpty: true,
            },
            { key: 'port', label: 'Port', path: ['port'], type: 'number', placeholder: '80' },
            {
              key: 'targetPort',
              label: 'Target Port',
              path: ['targetPort'],
              type: 'number',
              placeholder: '80',
            },
            {
              key: 'protocol',
              label: 'Protocol',
              path: ['protocol'],
              type: 'select',
              includeEmptyOption: false,
              implicitDefault: 'TCP',
              options: [
                { label: 'TCP', value: 'TCP' },
                { label: 'UDP', value: 'UDP' },
                { label: 'SCTP', value: 'SCTP' },
              ],
            },
          ],
          defaultValue: { port: 80, targetPort: 80, protocol: 'TCP' },
        },
      ],
    },
  ],
};
