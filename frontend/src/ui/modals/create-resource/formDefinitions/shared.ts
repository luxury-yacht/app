import type { FormFieldDefinition } from './types';

// ---------------------------------------------------------------------------
// Container sub-fields
// ---------------------------------------------------------------------------

/**
 * Returns the inner fields array for a container group-list.
 * Must be a function because the volumeMount name sub-field uses
 * dynamicOptionsPath, which is an absolute path that differs per resource.
 */
export function makeContainerSubFields(volumesPath: string[]): FormFieldDefinition[] {
  return [
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
      placeholder: 'repo/image:tag',
      groupWithNext: true,
    },
    {
      key: 'imagePullPolicy',
      label: 'Pull Policy',
      path: ['imagePullPolicy'],
      type: 'select',
      dropdownWidth: 'calc(10ch + 40px)',
      options: [
        { label: 'Always', value: 'Always' },
        { label: 'IfNotPresent', value: 'IfNotPresent' },
        { label: 'Never', value: 'Never' },
      ],
    },
    {
      key: 'command',
      label: 'Command',
      path: ['command'],
      type: 'command-input',
      placeholder: '/bin/sh -c',
      omitIfEmpty: false,
    },
    {
      key: 'args',
      label: 'Args',
      path: ['args'],
      type: 'command-input',
      placeholder: '--port=8080 --log-level=info',
      omitIfEmpty: false,
    },
    // env — individual env vars with optional valueFrom (configMapKeyRef/secretKeyRef).
    // Rendered by FormEnvVarField; handles source type switching internally.
    {
      key: 'env',
      label: 'Env Vars',
      path: ['env'],
      type: 'env-var',
    },
    // envFrom — bulk import env vars from ConfigMaps/Secrets.
    // Rendered by FormEnvFromField; handles configMapRef/secretRef switching internally.
    {
      key: 'envFrom',
      label: 'Env From',
      path: ['envFrom'],
      type: 'env-from',
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
            { label: 'SCTP', value: 'SCTP' },
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
      key: 'readinessProbe',
      label: 'Readiness',
      path: ['readinessProbe'],
      type: 'probe',
    },
    {
      key: 'livenessProbe',
      label: 'Liveness',
      path: ['livenessProbe'],
      type: 'probe',
    },
    {
      key: 'startupProbe',
      label: 'Startup',
      path: ['startupProbe'],
      type: 'probe',
    },
    {
      key: 'volumeMounts',
      label: 'Vol Mounts',
      path: ['volumeMounts'],
      type: 'group-list',
      leftAlignEmptyActions: true,
      addGhostText: 'Add volume mount',
      disabledGhostText: 'Add a Volume below to enable Volume Mounts',
      fieldGap: 'wide',
      wrapFields: true,
      rowAlign: 'start',
      fields: [
        {
          key: 'name',
          label: 'Name',
          path: ['name'],
          type: 'select',
          dynamicOptionsPath: volumesPath,
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
    // ── Container Security Context ──────────────────────────────────────
    {
      key: 'secRunAsUser',
      label: 'Run As User',
      path: ['securityContext', 'runAsUser'],
      type: 'number',
      placeholder: 'UID',
      omitIfEmpty: true,
      groupWithNext: true,
      inputWidth: '8ch',
    },
    {
      key: 'secRunAsGroup',
      label: 'Run As Group',
      path: ['securityContext', 'runAsGroup'],
      type: 'number',
      placeholder: 'GID',
      omitIfEmpty: true,
      inputWidth: '8ch',
    },
    {
      key: 'secRunAsNonRoot',
      label: 'Run As Non-Root',
      path: ['securityContext', 'runAsNonRoot'],
      type: 'tri-state-boolean',
    },
    {
      key: 'secPrivileged',
      label: 'Privileged',
      path: ['securityContext', 'privileged'],
      type: 'tri-state-boolean',
      groupWithNext: true,
    },
    {
      key: 'secAllowPrivEsc',
      label: 'Allow Privilege Escalation',
      path: ['securityContext', 'allowPrivilegeEscalation'],
      type: 'tri-state-boolean',
    },
    {
      key: 'secReadOnlyRoot',
      label: 'Read-Only Root FS',
      path: ['securityContext', 'readOnlyRootFilesystem'],
      type: 'tri-state-boolean',
    },
    {
      key: 'secCapAdd',
      label: 'Capabilities Add',
      path: ['securityContext', 'capabilities', 'add'],
      type: 'string-list',
      addLabel: 'Add Capability',
      placeholder: 'e.g. NET_BIND_SERVICE',
    },
    {
      key: 'secCapDrop',
      label: 'Capabilities Drop',
      path: ['securityContext', 'capabilities', 'drop'],
      type: 'string-list',
      addLabel: 'Add Capability',
      placeholder: 'e.g. ALL',
    },
  ];
}

/** Default value for a new container item in group-list. */
export const containerDefaultValue = { name: '', image: '', ports: [], env: [], volumeMounts: [] };

// ---------------------------------------------------------------------------
// Volume sub-fields
// ---------------------------------------------------------------------------

/** Inner fields array for a volume group-list. Uses only relative paths. */
export const volumeSubFields: FormFieldDefinition[] = [
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
];

/** Default value for a new volume item. */
export const volumeDefaultValue = {};

// ---------------------------------------------------------------------------
// Advanced pod-spec fields
// ---------------------------------------------------------------------------

/**
 * Returns pod-spec-level fields with paths prefixed by the given pod spec path.
 * @param podSpecPrefix e.g. ['spec', 'template', 'spec'] for Deployment/Job.
 */
export function makeAdvancedPodSpecFields(podSpecPrefix: string[]): FormFieldDefinition[] {
  return [
    {
      key: 'serviceAccountName',
      label: 'Service Account',
      path: [...podSpecPrefix, 'serviceAccountName'],
      mirrorPaths: [[...podSpecPrefix, 'serviceAccount']],
      type: 'text',
      placeholder: 'default',
      omitIfEmpty: true,
      tooltip: 'The service account the pod runs as. Controls API access and mounted secrets.',
    },
    {
      key: 'terminationGracePeriodSeconds',
      label: 'Term Grace Period',
      path: [...podSpecPrefix, 'terminationGracePeriodSeconds'],
      type: 'number',
      placeholder: '30',
      min: 0,
      integer: true,
      inputWidth: '6ch',
      tooltip:
        'Seconds to wait for a pod to shut down gracefully before it is forcefully killed. Default is 30.',
    },
    {
      key: 'nodeSelector',
      label: 'Node Selector',
      path: [...podSpecPrefix, 'nodeSelector'],
      type: 'key-value-list',
      addLabel: 'Add Selector',
      addGhostText: 'Add node selector',
      inlineLabels: true,
      leftAlignEmptyActions: true,
      blankNewKeys: true,
      tooltip: 'Key-value pairs that constrain which nodes the pod can be scheduled on.',
    },
    {
      key: 'priorityClassName',
      label: 'Priority Class',
      path: [...podSpecPrefix, 'priorityClassName'],
      type: 'text',
      placeholder: 'optional',
      omitIfEmpty: true,
      tooltip: 'Assigns a priority class to the pod, affecting scheduling and preemption order.',
    },
    {
      key: 'dnsPolicy',
      label: 'DNS Policy',
      path: [...podSpecPrefix, 'dnsPolicy'],
      type: 'select',
      options: [
        { label: 'ClusterFirst', value: 'ClusterFirst' },
        { label: 'Default', value: 'Default' },
        { label: 'ClusterFirstWithHostNet', value: 'ClusterFirstWithHostNet' },
        { label: 'None', value: 'None' },
      ],
      tooltip:
        'Controls how DNS resolution works inside the pod. ClusterFirst uses the cluster DNS service.',
    },
    // ── Pod Security Context ────────────────────────────────────────────
    {
      key: 'podSecRunAsUser',
      label: 'Pod Run As User',
      path: [...podSpecPrefix, 'securityContext', 'runAsUser'],
      type: 'number',
      placeholder: 'UID',
      omitIfEmpty: true,
      groupWithNext: true,
      inputWidth: '8ch',
    },
    {
      key: 'podSecRunAsGroup',
      label: 'Pod Run As Group',
      path: [...podSpecPrefix, 'securityContext', 'runAsGroup'],
      type: 'number',
      placeholder: 'GID',
      omitIfEmpty: true,
      inputWidth: '8ch',
    },
    {
      key: 'podSecRunAsNonRoot',
      label: 'Pod Run As Non-Root',
      path: [...podSpecPrefix, 'securityContext', 'runAsNonRoot'],
      type: 'tri-state-boolean',
    },
    {
      key: 'podSecFsGroup',
      label: 'FS Group',
      path: [...podSpecPrefix, 'securityContext', 'fsGroup'],
      type: 'number',
      placeholder: 'GID',
      omitIfEmpty: true,
      inputWidth: '8ch',
    },
    // ── Tolerations ─────────────────────────────────────────────────────
    {
      key: 'tolerations',
      label: 'Tolerations',
      path: [...podSpecPrefix, 'tolerations'],
      type: 'group-list',
      fullWidth: true,
      itemTitleField: 'key',
      itemTitleFallback: 'Toleration',
      addLabel: 'Add Toleration',
      defaultValue: { operator: 'Equal' },
      fields: [
        {
          key: 'key',
          label: 'Key',
          path: ['key'],
          type: 'text',
          placeholder: 'e.g. node-role.kubernetes.io/master',
          fieldFlex: '1 1 auto',
        },
        {
          key: 'operator',
          label: 'Operator',
          path: ['operator'],
          type: 'select',
          options: [
            { value: 'Equal', label: 'Equal' },
            { value: 'Exists', label: 'Exists' },
          ],
          includeEmptyOption: false,
          implicitDefault: 'Equal',
          fieldFlex: '0 0 auto',
          dropdownWidth: 'calc(8ch + 40px)',
        },
        {
          key: 'value',
          label: 'Value',
          path: ['value'],
          type: 'text',
          placeholder: 'value',
          fieldFlex: '1 1 auto',
          // Note: always visible. When operator is Exists, Kubernetes ignores the value.
        },
        {
          key: 'effect',
          label: 'Effect',
          path: ['effect'],
          type: 'select',
          options: [
            { value: 'NoSchedule', label: 'NoSchedule' },
            { value: 'PreferNoSchedule', label: 'PreferNoSchedule' },
            { value: 'NoExecute', label: 'NoExecute' },
          ],
          fieldFlex: '0 0 auto',
          dropdownWidth: 'calc(16ch + 40px)',
        },
        {
          key: 'tolerationSeconds',
          label: 'Seconds',
          path: ['tolerationSeconds'],
          type: 'number',
          omitIfEmpty: true,
          placeholder: 'toleration seconds',
          fieldFlex: '0 0 auto',
          inputWidth: 'calc(8ch + 20px)',
        },
      ],
    },
    // ── Affinity ────────────────────────────────────────────────────────
    {
      key: 'affinity',
      label: 'Affinity',
      path: [...podSpecPrefix, 'affinity'],
      type: 'affinity',
      fullWidth: true,
    },
  ];
}

// ---------------------------------------------------------------------------
// Pod template annotations
// ---------------------------------------------------------------------------

/**
 * Returns a key-value-list field for pod template annotations.
 * @param podTemplatePrefix e.g. ['spec', 'template', 'metadata'] for Deployment/Job.
 */
export function makePodAnnotationsField(podTemplatePrefix: string[]): FormFieldDefinition {
  return {
    key: 'podAnnotations',
    label: 'Pod Annotations',
    path: [...podTemplatePrefix, 'annotations'],
    type: 'key-value-list',
    addLabel: 'Add Annotation',
    addGhostText: 'Add pod annotation',
    inlineLabels: true,
    leftAlignEmptyActions: true,
    blankNewKeys: true,
    tooltip:
      'Key-value metadata attached to the pod template. Used by tools like Prometheus, Vault, and Datadog.',
  };
}

// ---------------------------------------------------------------------------
// Image pull secrets
// ---------------------------------------------------------------------------

/**
 * Returns a group-list field for imagePullSecrets.
 * @param podSpecPrefix e.g. ['spec', 'template', 'spec'] for Deployment/Job.
 */
export function makeImagePullSecretsField(podSpecPrefix: string[]): FormFieldDefinition {
  return {
    key: 'imagePullSecrets',
    label: 'Image Pull Secrets',
    path: [...podSpecPrefix, 'imagePullSecrets'],
    type: 'group-list',
    leftAlignEmptyActions: true,
    addGhostText: 'Add image pull secret',
    fieldGap: 'wide',
    fields: [
      {
        key: 'name',
        label: 'Name',
        path: ['name'],
        type: 'text',
        placeholder: 'secret-name',
        fieldFlex: '0 0 auto',
        inputWidth: 'calc(25ch + 20px)',
      },
    ],
    defaultValue: { name: '' },
  };
}
