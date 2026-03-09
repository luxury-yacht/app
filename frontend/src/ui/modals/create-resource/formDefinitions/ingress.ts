import type { ResourceFormDefinition } from './types';

export const ingressDefinition: ResourceFormDefinition = {
  kind: 'Ingress',
  sections: [
    {
      title: 'Metadata',
      fields: [
        {
          key: 'name',
          label: 'Name',
          path: ['metadata', 'name'],
          type: 'text',
          placeholder: 'ingress-name',
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
          key: 'ingressClassName',
          label: 'Ingress Class',
          path: ['spec', 'ingressClassName'],
          type: 'text',
          placeholder: 'nginx',
        },
      ],
    },
    {
      title: 'Rules',
      fields: [
        {
          key: 'rules',
          label: 'Rules',
          path: ['spec', 'rules'],
          type: 'group-list',
          fields: [
            {
              key: 'host',
              label: 'Host',
              path: ['host'],
              type: 'text',
              placeholder: 'app.example.com',
            },
            {
              key: 'paths',
              label: 'Paths',
              path: ['http', 'paths'],
              type: 'group-list',
              fields: [
                { key: 'path', label: 'Path', path: ['path'], type: 'text', placeholder: '/' },
                {
                  key: 'pathType',
                  label: 'Path Type',
                  path: ['pathType'],
                  type: 'select',
                  options: [
                    { label: 'Prefix', value: 'Prefix' },
                    { label: 'Exact', value: 'Exact' },
                    { label: 'ImplementationSpecific', value: 'ImplementationSpecific' },
                  ],
                },
                {
                  key: 'serviceName',
                  label: 'Service',
                  path: ['backend', 'service', 'name'],
                  type: 'text',
                  placeholder: 'service-name',
                },
                {
                  key: 'servicePort',
                  label: 'Port',
                  path: ['backend', 'service', 'port', 'number'],
                  type: 'number',
                  placeholder: '80',
                },
              ],
              defaultValue: {
                path: '/',
                pathType: 'Prefix',
                backend: { service: { name: '', port: { number: 80 } } },
              },
            },
          ],
          defaultValue: { host: '', http: { paths: [] } },
        },
      ],
    },
  ],
};
