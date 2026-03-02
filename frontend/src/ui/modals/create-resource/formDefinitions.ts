/**
 * frontend/src/ui/modals/create-resource/formDefinitions.ts
 *
 * Declarative form definitions for the guided resource creation mode.
 * Each definition describes which YAML paths map to which form fields.
 * The generic ResourceForm renderer uses these definitions to render
 * the appropriate inputs.
 */

// --- Types ---

export interface FormFieldOption {
  label: string;
  value: string;
}

export interface FormFieldDefinition {
  /** Unique field identifier within the definition. */
  key: string;
  /** Display label shown next to the input. */
  label: string;
  /** YAML path to read/write this field's value, e.g. ['spec', 'replicas']. */
  path: string[];
  /** Input type. */
  type: 'text' | 'number' | 'select' | 'textarea' | 'key-value-list' | 'group-list';
  /** Placeholder text for text/number inputs. */
  placeholder?: string;
  /** Options for 'select' type fields. */
  options?: FormFieldOption[];
  /** Sub-field definitions for 'group-list' type fields. */
  fields?: FormFieldDefinition[];
  /** Default value for the field when creating a new list item. */
  defaultValue?: unknown;
}

export interface FormSectionDefinition {
  /** Section heading displayed above the fields. */
  title: string;
  /** Fields in this section. */
  fields: FormFieldDefinition[];
}

export interface ResourceFormDefinition {
  /** Kubernetes kind this form applies to. */
  kind: string;
  /** Sections of the form, rendered top-to-bottom. */
  sections: FormSectionDefinition[];
}

// --- Definitions ---

const deploymentDefinition: ResourceFormDefinition = {
  kind: 'Deployment',
  sections: [
    {
      title: 'Metadata',
      fields: [
        { key: 'name', label: 'Name', path: ['metadata', 'name'], type: 'text', placeholder: 'my-app' },
        { key: 'replicas', label: 'Replicas', path: ['spec', 'replicas'], type: 'number', placeholder: '1' },
        { key: 'labels', label: 'Labels', path: ['metadata', 'labels'], type: 'key-value-list' },
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
          fields: [
            { key: 'name', label: 'Name', path: ['name'], type: 'text', placeholder: 'my-container' },
            { key: 'image', label: 'Image', path: ['image'], type: 'text', placeholder: 'nginx:latest' },
            {
              key: 'ports',
              label: 'Ports',
              path: ['ports'],
              type: 'group-list',
              fields: [
                { key: 'containerPort', label: 'Port', path: ['containerPort'], type: 'number', placeholder: '80' },
                {
                  key: 'protocol',
                  label: 'Protocol',
                  path: ['protocol'],
                  type: 'select',
                  options: [
                    { label: 'TCP', value: 'TCP' },
                    { label: 'UDP', value: 'UDP' },
                  ],
                },
              ],
              defaultValue: { containerPort: 80, protocol: 'TCP' },
            },
            {
              key: 'env',
              label: 'Environment Variables',
              path: ['env'],
              type: 'group-list',
              fields: [
                { key: 'name', label: 'Name', path: ['name'], type: 'text', placeholder: 'ENV_VAR' },
                { key: 'value', label: 'Value', path: ['value'], type: 'text', placeholder: 'value' },
              ],
              defaultValue: { name: '', value: '' },
            },
          ],
          defaultValue: { name: '', image: '', ports: [], env: [] },
        },
      ],
    },
  ],
};

const serviceDefinition: ResourceFormDefinition = {
  kind: 'Service',
  sections: [
    {
      title: 'Metadata',
      fields: [
        { key: 'name', label: 'Name', path: ['metadata', 'name'], type: 'text', placeholder: 'my-service' },
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
            { key: 'port', label: 'Port', path: ['port'], type: 'number', placeholder: '80' },
            { key: 'targetPort', label: 'Target Port', path: ['targetPort'], type: 'number', placeholder: '80' },
            {
              key: 'protocol',
              label: 'Protocol',
              path: ['protocol'],
              type: 'select',
              options: [
                { label: 'TCP', value: 'TCP' },
                { label: 'UDP', value: 'UDP' },
              ],
            },
          ],
          defaultValue: { port: 80, targetPort: 80, protocol: 'TCP' },
        },
      ],
    },
  ],
};

const configMapDefinition: ResourceFormDefinition = {
  kind: 'ConfigMap',
  sections: [
    {
      title: 'Metadata',
      fields: [
        { key: 'name', label: 'Name', path: ['metadata', 'name'], type: 'text', placeholder: 'my-config' },
      ],
    },
    {
      title: 'Data',
      fields: [
        { key: 'data', label: 'Data', path: ['data'], type: 'key-value-list' },
      ],
    },
  ],
};

const secretDefinition: ResourceFormDefinition = {
  kind: 'Secret',
  sections: [
    {
      title: 'Metadata',
      fields: [
        { key: 'name', label: 'Name', path: ['metadata', 'name'], type: 'text', placeholder: 'my-secret' },
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

const jobDefinition: ResourceFormDefinition = {
  kind: 'Job',
  sections: [
    {
      title: 'Metadata',
      fields: [
        { key: 'name', label: 'Name', path: ['metadata', 'name'], type: 'text', placeholder: 'my-job' },
        { key: 'backoffLimit', label: 'Backoff Limit', path: ['spec', 'backoffLimit'], type: 'number', placeholder: '3' },
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
          fields: [
            { key: 'name', label: 'Name', path: ['name'], type: 'text', placeholder: 'worker' },
            { key: 'image', label: 'Image', path: ['image'], type: 'text', placeholder: 'busybox:latest' },
            { key: 'command', label: 'Command', path: ['command'], type: 'text', placeholder: 'echo,Hello' },
          ],
          defaultValue: { name: '', image: '', command: [] },
        },
      ],
    },
  ],
};

const cronJobDefinition: ResourceFormDefinition = {
  kind: 'CronJob',
  sections: [
    {
      title: 'Metadata',
      fields: [
        { key: 'name', label: 'Name', path: ['metadata', 'name'], type: 'text', placeholder: 'my-cronjob' },
        { key: 'schedule', label: 'Schedule', path: ['spec', 'schedule'], type: 'text', placeholder: '0 * * * *' },
        { key: 'backoffLimit', label: 'Backoff Limit', path: ['spec', 'jobTemplate', 'spec', 'backoffLimit'], type: 'number', placeholder: '3' },
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
          fields: [
            { key: 'name', label: 'Name', path: ['name'], type: 'text', placeholder: 'worker' },
            { key: 'image', label: 'Image', path: ['image'], type: 'text', placeholder: 'busybox:latest' },
            { key: 'command', label: 'Command', path: ['command'], type: 'text', placeholder: 'echo,Hello' },
          ],
          defaultValue: { name: '', image: '', command: [] },
        },
      ],
    },
  ],
};

const ingressDefinition: ResourceFormDefinition = {
  kind: 'Ingress',
  sections: [
    {
      title: 'Metadata',
      fields: [
        { key: 'name', label: 'Name', path: ['metadata', 'name'], type: 'text', placeholder: 'my-ingress' },
        { key: 'ingressClassName', label: 'Ingress Class', path: ['spec', 'ingressClassName'], type: 'text', placeholder: 'nginx' },
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
            { key: 'host', label: 'Host', path: ['host'], type: 'text', placeholder: 'my-app.example.com' },
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
                { key: 'serviceName', label: 'Service', path: ['backend', 'service', 'name'], type: 'text', placeholder: 'my-service' },
                { key: 'servicePort', label: 'Port', path: ['backend', 'service', 'port', 'number'], type: 'number', placeholder: '80' },
              ],
              defaultValue: { path: '/', pathType: 'Prefix', backend: { service: { name: '', port: { number: 80 } } } },
            },
          ],
          defaultValue: { host: '', http: { paths: [] } },
        },
      ],
    },
  ],
};

// --- Registry ---

export const allFormDefinitions: ResourceFormDefinition[] = [
  deploymentDefinition,
  serviceDefinition,
  configMapDefinition,
  secretDefinition,
  jobDefinition,
  cronJobDefinition,
  ingressDefinition,
];

const definitionsByKind = new Map<string, ResourceFormDefinition>(
  allFormDefinitions.map((d) => [d.kind, d])
);

/**
 * Look up a form definition by Kubernetes kind.
 * Returns undefined if no handcrafted form exists for this kind.
 */
export function getFormDefinition(kind: string): ResourceFormDefinition | undefined {
  return definitionsByKind.get(kind);
}
