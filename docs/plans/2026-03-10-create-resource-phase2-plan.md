# Phase 2: Create Resource Form — Simple Missing Features — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add missing fields to Deployment (startupProbe, imagePullSecrets, pod annotations, minReadySeconds, progressDeadlineSeconds, revisionHistoryLimit), bring Job/CronJob to full container and structural parity with Deployment, and add resource-specific fields for Job (completions, parallelism, activeDeadlineSeconds, ttlSecondsAfterFinished) and CronJob (concurrencyPolicy, suspend, history limits, startingDeadlineSeconds). Extract shared field definitions to eliminate duplication.

**Architecture:** Create a new `shared.ts` module exporting factory functions (`makeContainerSubFields`, `makeAdvancedPodSpecFields`, `makePodAnnotationsField`, `makeImagePullSecretsField`) and constants (`containerDefaultValue`, `volumeSubFields`, `volumeDefaultValue`) that the three pod-template definitions (Deployment, Job, CronJob) compose into their declarative form structures. Each definition file imports shared fragments and adds resource-specific fields.

**Tech Stack:** TypeScript, React, vitest

**Design doc:** `docs/plans/2026-03-10-create-resource-phase2-design.md`

---

## Context for implementers

### Project conventions

- **Form definitions** are declarative TypeScript objects in `frontend/src/ui/modals/create-resource/formDefinitions/`. Each resource kind has its own file.
- **Field types** are defined in `types.ts` — the `FormFieldDefinition` interface.
- **Tests** use vitest. Form definition tests are in `formDefinitions.test.ts` (one level up from the `formDefinitions/` directory).
- **No new components** are needed — all work is in the declarative definitions.

### Key files

| File | Role |
|------|------|
| `formDefinitions/shared.ts` | **NEW** — shared field fragments and factory functions |
| `formDefinitions/deployment.ts` | Refactor to use shared imports, add 6 new fields |
| `formDefinitions/job.ts` | Full rewrite with shared imports, new sections, new fields |
| `formDefinitions/cronJob.ts` | Full rewrite with shared imports, new sections, new fields |
| `formDefinitions.test.ts` | Extend with structural tests for new fields |
| `formDefinitions/types.ts` | No changes needed |
| `formDefinitions/index.ts` | No changes needed |

### Important rules

- **DO NOT remove `mirrorPaths` from `serviceAccountName`** — user explicitly requires it.
- `backoffLimit` placeholder changes from `'3'` to `'6'` to match the Kubernetes API default. This is intentional.
- `imagePullPolicy` is intentionally omitted from `containerDefaultValue` — absence lets Kubernetes apply its own default.
- `omitIfEmpty: true` is used on optional number fields like `activeDeadlineSeconds`, `ttlSecondsAfterFinished`, and `startingDeadlineSeconds` to prevent emitting a `0` default. Most number fields don't need it.
- Image placeholder normalizes from `busybox:latest` (old Job/CronJob) to `repo/image:tag` (shared). This is intentional — all container definitions now use the same generic placeholder.

---

## Chunk 1: Shared module and Deployment refactor

### Task 1: Create `formDefinitions/shared.ts`

**Files:**
- Create: `frontend/src/ui/modals/create-resource/formDefinitions/shared.ts`

- [ ] **Step 1: Create the shared module**

Create `frontend/src/ui/modals/create-resource/formDefinitions/shared.ts` with the complete contents below.

This file exports:
- `makeContainerSubFields(volumesPath)` — factory returning container inner fields (function because volumeMount `dynamicOptionsPath` differs per resource)
- `containerDefaultValue` — constant
- `volumeSubFields` — constant (inner fields use only relative paths)
- `volumeDefaultValue` — constant
- `makeAdvancedPodSpecFields(podSpecPrefix)` — factory returning pod-spec-level fields
- `makePodAnnotationsField(podTemplatePrefix)` — factory returning pod template annotations field
- `makeImagePullSecretsField(podSpecPrefix)` — factory returning imagePullSecrets field

```ts
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
      tooltip:
        'Assigns a priority class to the pod, affecting scheduling and preemption order.',
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
```

- [ ] **Step 2: Verify the file compiles**

Run: `npx tsc --noEmit`
Expected: No errors related to shared.ts.

---

### Task 2: Refactor `deployment.ts` to use shared imports and add new fields

**Files:**
- Modify: `frontend/src/ui/modals/create-resource/formDefinitions/deployment.ts`

This task replaces the inline container, volume, and pod-spec field definitions with shared imports, and adds 6 new fields: startupProbe (via shared containers), minReadySeconds, progressDeadlineSeconds, revisionHistoryLimit, podAnnotations, imagePullSecrets.

- [ ] **Step 1: Rewrite `deployment.ts`**

Replace the entire contents of `deployment.ts` with:

```ts
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
          tooltip:
            'Label selectors that determine which pods belong to this Deployment. Automatically mirrored to pod template labels.',
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
          tooltip:
            'Additional key-value pairs attached to this Deployment for organization and selection. Selector labels are excluded.',
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
```

- [ ] **Step 2: Verify compilation and existing tests pass**

Run: `npx tsc --noEmit && npx vitest run src/ui/modals/create-resource/formDefinitions.test.ts src/ui/modals/create-resource/ResourceForm.test.tsx`
Expected: No TypeScript errors. All existing tests pass.

---

### Task 3: Overhaul `job.ts`

**Files:**
- Modify: `frontend/src/ui/modals/create-resource/formDefinitions/job.ts`

Full rewrite: Metadata slimmed (labels added, backoffLimit/restartPolicy moved out), new Spec section with Job-specific fields, shared container/volume/advanced sections added.

- [ ] **Step 1: Rewrite `job.ts`**

Replace the entire contents of `job.ts` with:

```ts
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
          required: true,
          placeholder: 'job-name',
          tooltip: 'Unique name for this Job within the namespace.',
        },
        {
          key: 'namespace',
          label: 'Namespace',
          path: ['metadata', 'namespace'],
          type: 'namespace-select',
          tooltip: 'The namespace this Job will be created in.',
        },
        {
          key: 'labels',
          label: 'Labels',
          path: ['metadata', 'labels'],
          type: 'key-value-list',
          addLabel: 'Add Label',
          addGhostText: 'Add label',
          inlineLabels: true,
          leftAlignEmptyActions: true,
          blankNewKeys: true,
          tooltip: 'Key-value pairs attached to this Job for organization and selection.',
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
          tooltip: 'Arbitrary key-value metadata for tools, libraries, and external systems.',
        },
      ],
    },
    {
      title: 'Spec',
      fields: [
        {
          key: 'backoffLimit',
          label: 'Backoff Limit',
          path: ['spec', 'backoffLimit'],
          type: 'number',
          placeholder: '6',
          min: 0,
          integer: true,
          inputWidth: '6ch',
          tooltip: 'Number of retries before marking the Job as failed. Default is 6.',
        },
        {
          key: 'completions',
          label: 'Completions',
          path: ['spec', 'completions'],
          type: 'number',
          placeholder: '1',
          min: 1,
          integer: true,
          inputWidth: '6ch',
          tooltip: 'Number of successful pod completions required. Default is 1.',
        },
        {
          key: 'parallelism',
          label: 'Parallelism',
          path: ['spec', 'parallelism'],
          type: 'number',
          placeholder: '1',
          min: 0,
          integer: true,
          inputWidth: '6ch',
          tooltip: 'Maximum number of pods running at the same time. Default is 1.',
        },
        {
          key: 'activeDeadlineSeconds',
          label: 'Active Deadline',
          path: ['spec', 'activeDeadlineSeconds'],
          type: 'number',
          min: 1,
          integer: true,
          inputWidth: '6ch',
          omitIfEmpty: true,
          tooltip: 'Maximum seconds the Job can run before it is terminated.',
        },
        {
          key: 'ttlSecondsAfterFinished',
          label: 'TTL After Finished',
          path: ['spec', 'ttlSecondsAfterFinished'],
          type: 'number',
          min: 0,
          integer: true,
          inputWidth: '6ch',
          omitIfEmpty: true,
          tooltip: 'Seconds to keep the Job after it finishes, before automatic cleanup.',
        },
        {
          key: 'restartPolicy',
          label: 'Restart Policy',
          path: [...podSpecPrefix, 'restartPolicy'],
          type: 'select',
          options: [
            { label: 'Never', value: 'Never' },
            { label: 'OnFailure', value: 'OnFailure' },
          ],
          tooltip: 'Restart policy for containers in the pod. Jobs support Never or OnFailure.',
        },
      ],
    },
    {
      title: 'Containers',
      fields: [
        {
          key: 'containers',
          label: 'Containers',
          path: [...podSpecPrefix, 'containers'],
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
        ...makeAdvancedPodSpecFields(podSpecPrefix),
        makePodAnnotationsField(podTemplatePrefix),
        makeImagePullSecretsField(podSpecPrefix),
      ],
    },
  ],
};
```

- [ ] **Step 2: Verify compilation and existing tests pass**

Run: `npx tsc --noEmit && npx vitest run src/ui/modals/create-resource/formDefinitions.test.ts`
Expected: No TypeScript errors. All existing tests pass.

---

### Task 4: Overhaul `cronJob.ts`

**Files:**
- Modify: `frontend/src/ui/modals/create-resource/formDefinitions/cronJob.ts`

Full rewrite: Metadata slimmed, new "Schedule & Job" section with CronJob-specific fields, shared container/volume/advanced sections added.

- [ ] **Step 1: Rewrite `cronJob.ts`**

Replace the entire contents of `cronJob.ts` with:

```ts
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

// Path constants for this resource type (extra nesting via jobTemplate).
const volumesPath = ['spec', 'jobTemplate', 'spec', 'template', 'spec', 'volumes'];
const podSpecPrefix = ['spec', 'jobTemplate', 'spec', 'template', 'spec'];
const podTemplatePrefix = ['spec', 'jobTemplate', 'spec', 'template', 'metadata'];

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
          tooltip: 'Unique name for this CronJob within the namespace.',
        },
        {
          key: 'namespace',
          label: 'Namespace',
          path: ['metadata', 'namespace'],
          type: 'namespace-select',
          tooltip: 'The namespace this CronJob will be created in.',
        },
        {
          key: 'labels',
          label: 'Labels',
          path: ['metadata', 'labels'],
          type: 'key-value-list',
          addLabel: 'Add Label',
          addGhostText: 'Add label',
          inlineLabels: true,
          leftAlignEmptyActions: true,
          blankNewKeys: true,
          tooltip: 'Key-value pairs attached to this CronJob for organization and selection.',
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
          tooltip: 'Arbitrary key-value metadata for tools, libraries, and external systems.',
        },
      ],
    },
    {
      title: 'Schedule & Job',
      fields: [
        {
          key: 'schedule',
          label: 'Schedule',
          path: ['spec', 'schedule'],
          type: 'text',
          required: true,
          placeholder: '0 * * * *',
          tooltip: 'Cron expression defining when the Job runs (minute hour day month weekday).',
        },
        {
          key: 'concurrencyPolicy',
          label: 'Concurrency',
          path: ['spec', 'concurrencyPolicy'],
          type: 'select',
          options: [
            { label: 'Allow', value: 'Allow' },
            { label: 'Forbid', value: 'Forbid' },
            { label: 'Replace', value: 'Replace' },
          ],
          tooltip:
            'How to handle concurrent Job runs. Allow runs them in parallel, Forbid skips new runs, Replace cancels the current run.',
        },
        {
          key: 'suspend',
          label: 'Suspend',
          path: ['spec', 'suspend'],
          type: 'boolean-toggle',
          tooltip: 'If true, subsequent runs are suspended. Does not affect already running Jobs.',
        },
        {
          key: 'startingDeadlineSeconds',
          label: 'Starting Deadline',
          path: ['spec', 'startingDeadlineSeconds'],
          type: 'number',
          min: 0,
          integer: true,
          inputWidth: '6ch',
          omitIfEmpty: true,
          tooltip: 'Seconds after the scheduled time within which the Job can still be started.',
        },
        {
          key: 'successfulJobsHistoryLimit',
          label: 'Success History',
          path: ['spec', 'successfulJobsHistoryLimit'],
          type: 'number',
          placeholder: '3',
          min: 0,
          integer: true,
          inputWidth: '6ch',
          tooltip: 'Number of successful finished Jobs to retain. Default is 3.',
        },
        {
          key: 'failedJobsHistoryLimit',
          label: 'Failure History',
          path: ['spec', 'failedJobsHistoryLimit'],
          type: 'number',
          placeholder: '1',
          min: 0,
          integer: true,
          inputWidth: '6ch',
          tooltip: 'Number of failed finished Jobs to retain. Default is 1.',
        },
        {
          key: 'backoffLimit',
          label: 'Backoff Limit',
          path: ['spec', 'jobTemplate', 'spec', 'backoffLimit'],
          type: 'number',
          placeholder: '6',
          min: 0,
          integer: true,
          inputWidth: '6ch',
          tooltip: 'Number of retries before marking each Job as failed. Default is 6.',
        },
        {
          key: 'restartPolicy',
          label: 'Restart Policy',
          path: [...podSpecPrefix, 'restartPolicy'],
          type: 'select',
          options: [
            { label: 'Never', value: 'Never' },
            { label: 'OnFailure', value: 'OnFailure' },
          ],
          tooltip: 'Restart policy for containers in the pod. Jobs support Never or OnFailure.',
        },
      ],
    },
    {
      title: 'Containers',
      fields: [
        {
          key: 'containers',
          label: 'Containers',
          path: [...podSpecPrefix, 'containers'],
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
        ...makeAdvancedPodSpecFields(podSpecPrefix),
        makePodAnnotationsField(podTemplatePrefix),
        makeImagePullSecretsField(podSpecPrefix),
      ],
    },
  ],
};
```

- [ ] **Step 2: Verify compilation and existing tests pass**

Run: `npx tsc --noEmit && npx vitest run src/ui/modals/create-resource/formDefinitions.test.ts`
Expected: No TypeScript errors. All existing tests pass.

---

## Chunk 2: Tests and final verification

### Task 5: Add structural tests for new fields

**Files:**
- Modify: `frontend/src/ui/modals/create-resource/formDefinitions.test.ts`

Add tests verifying the new fields and structural changes are present in all relevant definitions.

- [ ] **Step 1: Add test helpers and shared field coverage tests**

Append the following to `formDefinitions.test.ts`, after the existing `describe('formDefinitions', ...)` block:

```ts
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type FieldDef = ResourceFormDefinition['sections'][0]['fields'][0];

/** Find a top-level field by key across all sections of a definition. */
const findField = (def: ResourceFormDefinition, key: string): FieldDef | undefined => {
  for (const section of def.sections) {
    for (const field of section.fields) {
      if (field.key === key) return field;
    }
  }
  return undefined;
};

/** Find a sub-field inside a group-list field. */
const findSubField = (field: FieldDef, key: string): FieldDef | undefined => {
  return field.fields?.find((f) => f.key === key);
};

/** Find a sub-sub-field (two levels deep, e.g. containers → volumeMounts → name). */
const findNestedSubField = (field: FieldDef, subKey: string, nestedKey: string): FieldDef | undefined => {
  const sub = findSubField(field, subKey);
  return sub?.fields?.find((f) => f.key === nestedKey);
};

// ---------------------------------------------------------------------------
// Shared field coverage (Deployment, Job, CronJob)
// ---------------------------------------------------------------------------

const podTemplateKinds = ['Deployment', 'Job', 'CronJob'];

describe('shared field coverage across pod-template definitions', () => {
  for (const kind of podTemplateKinds) {
    describe(kind, () => {
      const def = getFormDefinition(kind)!;

      it('has containers with all probe types', () => {
        const containers = findField(def, 'containers')!;
        expect(findSubField(containers, 'readinessProbe')).toBeDefined();
        expect(findSubField(containers, 'livenessProbe')).toBeDefined();
        expect(findSubField(containers, 'startupProbe')).toBeDefined();
      });

      it('has containers with env, ports, and volumeMounts', () => {
        const containers = findField(def, 'containers')!;
        expect(findSubField(containers, 'env')).toBeDefined();
        expect(findSubField(containers, 'ports')).toBeDefined();
        expect(findSubField(containers, 'volumeMounts')).toBeDefined();
      });

      it('has volumeMount name sub-field with correct dynamicOptionsPath', () => {
        const containers = findField(def, 'containers')!;
        const volumeMountName = findNestedSubField(containers, 'volumeMounts', 'name');
        expect(volumeMountName).toBeDefined();
        // dynamicOptionsPath must point to the same path as the volumes field.
        const volumes = findField(def, 'volumes')!;
        expect(volumeMountName!.dynamicOptionsPath).toEqual(volumes.path);
      });

      it('has a Volumes section with volumes field', () => {
        expect(findField(def, 'volumes')).toBeDefined();
      });

      it('has imagePullSecrets', () => {
        expect(findField(def, 'imagePullSecrets')).toBeDefined();
      });

      it('has podAnnotations', () => {
        expect(findField(def, 'podAnnotations')).toBeDefined();
      });

      it('has serviceAccountName', () => {
        expect(findField(def, 'serviceAccountName')).toBeDefined();
      });
    });
  }
});

// ---------------------------------------------------------------------------
// Deployment-specific fields
// ---------------------------------------------------------------------------

describe('Deployment-specific fields', () => {
  const def = getFormDefinition('Deployment')!;

  it('has minReadySeconds at spec.minReadySeconds', () => {
    const field = findField(def, 'minReadySeconds');
    expect(field).toBeDefined();
    expect(field!.path).toEqual(['spec', 'minReadySeconds']);
  });

  it('has progressDeadlineSeconds at spec.progressDeadlineSeconds', () => {
    const field = findField(def, 'progressDeadlineSeconds');
    expect(field).toBeDefined();
    expect(field!.path).toEqual(['spec', 'progressDeadlineSeconds']);
  });

  it('has revisionHistoryLimit at spec.revisionHistoryLimit', () => {
    const field = findField(def, 'revisionHistoryLimit');
    expect(field).toBeDefined();
    expect(field!.path).toEqual(['spec', 'revisionHistoryLimit']);
  });
});

// ---------------------------------------------------------------------------
// Job-specific fields
// ---------------------------------------------------------------------------

describe('Job-specific fields', () => {
  const def = getFormDefinition('Job')!;

  it('has labels in Metadata section', () => {
    const metadataSection = def.sections.find((s) => s.title === 'Metadata')!;
    expect(metadataSection.fields.find((f) => f.key === 'labels')).toBeDefined();
  });

  it('has backoffLimit at spec.backoffLimit with placeholder 6', () => {
    const field = findField(def, 'backoffLimit');
    expect(field).toBeDefined();
    expect(field!.path).toEqual(['spec', 'backoffLimit']);
    expect(field!.placeholder).toBe('6');
  });

  it('has restartPolicy at spec.template.spec.restartPolicy', () => {
    const field = findField(def, 'restartPolicy');
    expect(field).toBeDefined();
    expect(field!.path).toEqual(['spec', 'template', 'spec', 'restartPolicy']);
  });

  it('has completions', () => {
    expect(findField(def, 'completions')).toBeDefined();
  });

  it('has parallelism', () => {
    expect(findField(def, 'parallelism')).toBeDefined();
  });

  it('has activeDeadlineSeconds', () => {
    expect(findField(def, 'activeDeadlineSeconds')).toBeDefined();
  });

  it('has ttlSecondsAfterFinished', () => {
    expect(findField(def, 'ttlSecondsAfterFinished')).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// CronJob-specific fields
// ---------------------------------------------------------------------------

describe('CronJob-specific fields', () => {
  const def = getFormDefinition('CronJob')!;

  it('has labels in Metadata section', () => {
    const metadataSection = def.sections.find((s) => s.title === 'Metadata')!;
    expect(metadataSection.fields.find((f) => f.key === 'labels')).toBeDefined();
  });

  it('has schedule at spec.schedule with required flag', () => {
    const field = findField(def, 'schedule');
    expect(field).toBeDefined();
    expect(field!.path).toEqual(['spec', 'schedule']);
    expect(field!.required).toBe(true);
  });

  it('has concurrencyPolicy as a select', () => {
    const field = findField(def, 'concurrencyPolicy');
    expect(field).toBeDefined();
    expect(field!.type).toBe('select');
  });

  it('has suspend as a boolean-toggle', () => {
    const field = findField(def, 'suspend');
    expect(field).toBeDefined();
    expect(field!.type).toBe('boolean-toggle');
  });

  it('has startingDeadlineSeconds', () => {
    expect(findField(def, 'startingDeadlineSeconds')).toBeDefined();
  });

  it('has successfulJobsHistoryLimit', () => {
    expect(findField(def, 'successfulJobsHistoryLimit')).toBeDefined();
  });

  it('has failedJobsHistoryLimit', () => {
    expect(findField(def, 'failedJobsHistoryLimit')).toBeDefined();
  });

  it('has backoffLimit with placeholder 6', () => {
    const field = findField(def, 'backoffLimit');
    expect(field).toBeDefined();
    expect(field!.placeholder).toBe('6');
  });

  it('has containers at correct CronJob path', () => {
    const field = findField(def, 'containers');
    expect(field!.path).toEqual(['spec', 'jobTemplate', 'spec', 'template', 'spec', 'containers']);
  });

  it('has volumes at correct CronJob path', () => {
    const field = findField(def, 'volumes');
    expect(field!.path).toEqual(['spec', 'jobTemplate', 'spec', 'template', 'spec', 'volumes']);
  });

  it('has podAnnotations at correct CronJob path', () => {
    const field = findField(def, 'podAnnotations');
    expect(field!.path).toEqual(['spec', 'jobTemplate', 'spec', 'template', 'metadata', 'annotations']);
  });

  it('has imagePullSecrets at correct CronJob path', () => {
    const field = findField(def, 'imagePullSecrets');
    expect(field!.path).toEqual(['spec', 'jobTemplate', 'spec', 'template', 'spec', 'imagePullSecrets']);
  });
});
```

- [ ] **Step 2: Run the new tests**

Run: `npx vitest run src/ui/modals/create-resource/formDefinitions.test.ts`
Expected: All tests pass (existing + new).

---

### Task 6: Final verification

- [ ] **Step 1: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass with no regressions.

- [ ] **Step 2: Run TypeScript check**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Run linter**

Run: `npx eslint src/`
Expected: No errors.
