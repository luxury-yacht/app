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
  type:
    | 'text'
    | 'number'
    | 'select'
    | 'namespace-select'
    | 'textarea'
    | 'key-value-list'
    | 'selector-list'
    | 'group-list'
    | 'container-resources'
    | 'volume-source'
    | 'tri-state-boolean'
    | 'boolean-toggle';
  /** Placeholder text for text/number inputs. */
  placeholder?: string;
  /** Optional minimum value for number inputs. */
  min?: number;
  /** Optional maximum value for number inputs. */
  max?: number;
  /** Whether number values must be integers. */
  integer?: boolean;
  /** Whether this field is required. */
  required?: boolean;
  /** Options for 'select' type fields. */
  options?: FormFieldOption[];
  /** Custom parser for the raw input value before persisting (e.g., string to integer). */
  parseValue?: (rawValue: string) => unknown;
  /** Custom formatter for converting the stored value to a display string. */
  formatValue?: (value: unknown) => string;
  /** Sub-field definitions for 'group-list' type fields. */
  fields?: FormFieldDefinition[];
  /** Default value for the field when creating a new list item. */
  defaultValue?: unknown;
  /** Additional map paths kept in sync with this field's map value. */
  mirrorPaths?: string[][];
  /** Map path whose keys should be excluded from this field's editable rows. */
  excludedKeysSourcePath?: string[];
  /** If true, empty string values are removed from YAML instead of persisted. */
  omitIfEmpty?: boolean;
  /**
   * Alternate YAML path for text fields with a toggle (e.g., subPath/subPathExpr).
   * When set, a toggle checkbox is shown that switches between path and alternatePath.
   */
  alternatePath?: string[];
  /** Label for the alternate path toggle checkbox (e.g., 'Use Expression'). */
  alternateLabel?: string;
  /**
   * YAML path to an array whose items provide dynamic options for select fields.
   * The renderer reads this path from the document root and extracts option values.
   */
  dynamicOptionsPath?: string[];
  /** Field name within each dynamic options item to use as value and label. */
  dynamicOptionsField?: string;

  // ─── Renderer configuration ───────────────────────────────────────────
  // These properties let the form definition control renderer behavior
  // that was previously hardcoded against specific field keys.

  /** Whether to include an empty "-----" option in select dropdowns. Defaults true. */
  includeEmptyOption?: boolean;
  /** Implicit default value for select fields when none is set in YAML (e.g., 'TCP'). */
  implicitDefault?: string;
  /** Sub-field key used as the group-list card header title (e.g., 'name' for containers). */
  itemTitleField?: string;
  /** Fallback title shown when itemTitleField value is empty (e.g., 'Container'). */
  itemTitleFallback?: string;
  /** Label for the add button in lists (e.g., 'Add Label'). */
  addLabel?: string;
  /** Ghost helper text shown next to empty-state add actions. */
  addGhostText?: string;
  /** Whether key-value rows render with inline "Key"/"Value" labels. */
  inlineLabels?: boolean;
  /** Whether empty-state add actions are left-aligned. */
  leftAlignEmptyActions?: boolean;
  /** Whether new entries use blank keys instead of auto-generated 'key-N' names. */
  blankNewKeys?: boolean;

  // ─── Tri-state boolean ──────────────────────────────────────────────
  // Used by 'tri-state-boolean' fields (e.g., volume source optional/readOnly).

  /** Label shown when value is undefined/null. */
  emptyLabel?: string;
  /** Label for the true option. */
  trueLabel?: string;
  /** Label for the false option. */
  falseLabel?: string;

  // ─── Layout / sizing ───────────────────────────────────────────────
  // Drive input widths and nested-list layout from the definition
  // instead of coupling CSS selectors to specific data-field-key values.

  /** Fixed CSS width for the input element (e.g., '6ch', 'calc(5ch + 20px)'). */
  inputWidth?: string;
  /** Fixed CSS width for the dropdown wrapper (e.g., 'calc(5ch + 40px)'). */
  dropdownWidth?: string;
  /** Flex shorthand for nested group-list field wrappers (e.g., '0 0 auto', '0 0 100%'). */
  fieldFlex?: string;
  /** Use wide gap between nested group-list fields (var(--spacing-xl) instead of default). */
  fieldGap?: 'wide';
  /** Wrap nested group-list fields to multiple lines. */
  wrapFields?: boolean;
  /** Align nested group-list rows to the start (top) instead of center. */
  rowAlign?: 'start';
  /** Minimum width for nested field labels (e.g., '4rem'). */
  labelWidth?: string;
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
        {
          key: 'name',
          label: 'Name',
          path: ['metadata', 'name'],
          type: 'text',
          placeholder: 'deployment-name',
        },
        {
          key: 'namespace',
          label: 'Namespace',
          path: ['metadata', 'namespace'],
          type: 'namespace-select',
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
        },
        {
          key: 'selectors',
          label: 'Selectors',
          path: ['spec', 'selector', 'matchLabels'],
          type: 'selector-list',
          mirrorPaths: [
            ['metadata', 'labels'],
            ['spec', 'template', 'metadata', 'labels'],
          ],
          addLabel: 'Add Selector',
          addGhostText: 'Add selector',
          inlineLabels: true,
          leftAlignEmptyActions: true,
        },
        {
          key: 'labels',
          label: 'Labels',
          path: ['metadata', 'labels'],
          type: 'key-value-list',
          excludedKeysSourcePath: ['spec', 'selector', 'matchLabels'],
          addLabel: 'Add Label',
          addGhostText: 'Add label',
          inlineLabels: true,
          leftAlignEmptyActions: true,
          blankNewKeys: true,
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
              placeholder: 'nginx:latest',
            },
            {
              key: 'env',
              label: 'Env Vars',
              path: ['env'],
              type: 'group-list',
              leftAlignEmptyActions: true,
              addGhostText: 'Add env var',
              fieldGap: 'wide',
              fields: [
                {
                  key: 'name',
                  label: 'Name',
                  path: ['name'],
                  type: 'text',
                  placeholder: 'name',
                  fieldFlex: '0 0 auto',
                  inputWidth: 'calc(25ch + 20px)',
                },
                {
                  key: 'value',
                  label: 'Value',
                  path: ['value'],
                  type: 'text',
                  placeholder: 'value',
                  fieldFlex: '0 0 auto',
                  inputWidth: 'calc(25ch + 20px)',
                },
              ],
              defaultValue: { name: '', value: '' },
            },
            {
              key: 'ports',
              label: 'Ports',
              path: ['ports'],
              type: 'group-list',
              leftAlignEmptyActions: true,
              addGhostText: 'Add port',
              fieldGap: 'wide',
              fields: [
                {
                  key: 'name',
                  label: 'Name',
                  path: ['name'],
                  type: 'text',
                  placeholder: 'optional',
                  omitIfEmpty: true,
                  fieldFlex: '0 0 auto',
                  inputWidth: 'calc(10ch + 20px)',
                },
                {
                  key: 'containerPort',
                  label: 'Port',
                  path: ['containerPort'],
                  type: 'number',
                  placeholder: '80',
                  min: 1,
                  max: 65535,
                  integer: true,
                  fieldFlex: '0 0 auto',
                  inputWidth: 'calc(5ch + 20px)',
                },
                {
                  key: 'protocol',
                  label: 'Protocol',
                  path: ['protocol'],
                  type: 'select',
                  includeEmptyOption: false,
                  implicitDefault: 'TCP',
                  fieldFlex: '0 0 auto',
                  options: [
                    { label: 'TCP', value: 'TCP' },
                    { label: 'UDP', value: 'UDP' },
                  ],
                },
              ],
              defaultValue: { protocol: 'TCP' },
            },
            {
              key: 'resources',
              label: 'Resources',
              path: ['resources'],
              type: 'container-resources',
            },
            {
              key: 'volumeMounts',
              label: 'Vol Mounts',
              path: ['volumeMounts'],
              type: 'group-list',
              leftAlignEmptyActions: true,
              addGhostText: 'Add volume mount',
              fieldGap: 'wide',
              wrapFields: true,
              rowAlign: 'start',
              fields: [
                {
                  key: 'name',
                  label: 'Name',
                  path: ['name'],
                  type: 'select',
                  dynamicOptionsPath: ['spec', 'template', 'spec', 'volumes'],
                  dynamicOptionsField: 'name',
                  fieldFlex: '0 0 100%',
                  inputWidth: 'calc(30ch + 20px)',
                },
                {
                  key: 'mountPath',
                  label: 'Path',
                  path: ['mountPath'],
                  type: 'text',
                  placeholder: '/mnt/data',
                  fieldFlex: '0 0 auto',
                  inputWidth: 'calc(30ch + 20px)',
                  labelWidth: '4rem',
                },
                {
                  key: 'readOnly',
                  label: 'Read Only',
                  path: ['readOnly'],
                  type: 'boolean-toggle',
                  fieldFlex: '0 0 auto',
                },
                {
                  key: 'subPath',
                  label: 'Sub Path',
                  path: ['subPath'],
                  type: 'text',
                  placeholder: 'optional',
                  alternatePath: ['subPathExpr'],
                  alternateLabel: 'Use Expression',
                  fieldFlex: '0 0 100%',
                  inputWidth: 'calc(30ch + 20px)',
                  labelWidth: '4rem',
                },
              ],
              defaultValue: { name: '', mountPath: '' },
            },
          ],
          defaultValue: { name: '', image: '', ports: [], env: [], volumeMounts: [] },
        },
      ],
    },
    {
      title: 'Volumes',
      fields: [
        {
          key: 'volumes',
          label: 'Volumes',
          path: ['spec', 'template', 'spec', 'volumes'],
          type: 'group-list',
          itemTitleField: 'name',
          itemTitleFallback: 'Volume',
          fields: [
            {
              key: 'name',
              label: 'Name',
              path: ['name'],
              type: 'text',
              placeholder: 'volume-name',
            },
            {
              key: 'source',
              label: 'Source',
              path: ['source'],
              type: 'volume-source',
            },
          ],
          defaultValue: {},
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
        {
          key: 'name',
          label: 'Name',
          path: ['metadata', 'name'],
          type: 'text',
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
        {
          key: 'name',
          label: 'Name',
          path: ['metadata', 'name'],
          type: 'text',
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

const secretDefinition: ResourceFormDefinition = {
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

const jobDefinition: ResourceFormDefinition = {
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

const cronJobDefinition: ResourceFormDefinition = {
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

const ingressDefinition: ResourceFormDefinition = {
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
