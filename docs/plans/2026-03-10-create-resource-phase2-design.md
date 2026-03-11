# Phase 2: Create Resource Form — Simple Missing Features

**Date:** 2026-03-10
**Scope:** Add missing fields to Deployment, bring Job/CronJob to structural and container parity, add resource-specific fields for Job/CronJob. Extract shared field fragments to eliminate duplication.
**Phase context:** This is Phase 2 of 3. Phase 1 (bugs + tests) is complete. Phase 3 covers complex features (envFrom/valueFrom, securityContext, affinity/tolerations, initContainers).

---

## Shared Field Fragments (`formDefinitions/shared.ts`)

New file exporting reusable field fragments and factory functions.

### `makeContainerSubFields(volumesPath)` and `containerDefaultValue`

Factory function `makeContainerSubFields(volumesPath: string[]): FormFieldDefinition[]` — returns the inner fields array for a container group-list. Must be a function (not a constant) because the volumeMount `name` sub-field has `dynamicOptionsPath` pointing to the volumes array, which differs per resource type (e.g., `['spec', 'template', 'spec', 'volumes']` for Deployment/Job vs `['spec', 'jobTemplate', 'spec', 'template', 'spec', 'volumes']` for CronJob). Fields:
- name (text), image (text), imagePullPolicy (select: Always/IfNotPresent/Never)
- command (command-input), args (command-input)
- env (nested group-list: name/value text pairs)
- ports (nested group-list: name/containerPort/protocol)
- resources (container-resources)
- readinessProbe (probe), livenessProbe (probe), startupProbe (probe)
- volumeMounts (nested group-list: name select with dynamicOptionsPath, mountPath, readOnly toggle, subPath with alternatePath)

Exported constant `containerDefaultValue`: `{ name: '', image: '', ports: [], env: [], volumeMounts: [] }`

Note: `imagePullPolicy` is intentionally omitted from defaultValue — absence lets Kubernetes apply its own default (`Always` for `:latest`, `IfNotPresent` otherwise).

### `volumeSubFields` and `volumeDefaultValue`

Exported constant `volumeSubFields: FormFieldDefinition[]` — the inner fields array for a volume group-list:
- name (text), source (volume-source)

Exported constant `volumeDefaultValue`: `{}`

### Path strategy

**Container and volume fields** use relative sub-field paths (e.g., `['name']`, `['image']`). Each definition wraps them in a group-list field with the correct outer `path`:
- Deployment: `['spec', 'template', 'spec', 'containers']`
- Job: `['spec', 'template', 'spec', 'containers']`
- CronJob: `['spec', 'jobTemplate', 'spec', 'template', 'spec', 'containers']`

**Pod-spec-level fields** (advanced fields, pod annotations, imagePullSecrets) require absolute paths that differ per resource. These are exported as **factory functions** that accept a pod-spec path prefix and return `FormFieldDefinition[]` with correct paths:

```ts
// Signature:
function makeContainerSubFields(volumesPath: string[]): FormFieldDefinition[]
function makeAdvancedPodSpecFields(podSpecPrefix: string[]): FormFieldDefinition[]
function makePodAnnotationsField(podTemplatePrefix: string[]): FormFieldDefinition
function makeImagePullSecretsField(podSpecPrefix: string[]): FormFieldDefinition

// Usage in deployment.ts:
...makeAdvancedPodSpecFields(['spec', 'template', 'spec']),
makePodAnnotationsField(['spec', 'template', 'metadata']),
makeImagePullSecretsField(['spec', 'template', 'spec']),

// Usage in cronJob.ts:
...makeAdvancedPodSpecFields(['spec', 'jobTemplate', 'spec', 'template', 'spec']),
makePodAnnotationsField(['spec', 'jobTemplate', 'spec', 'template', 'metadata']),
makeImagePullSecretsField(['spec', 'jobTemplate', 'spec', 'template', 'spec']),
```

### `makeAdvancedPodSpecFields(podSpecPrefix)`

Returns fields with paths prefixed by `podSpecPrefix`:
- serviceAccountName (text, with mirrorPaths to deprecated `serviceAccount` — kept per user instruction)
- terminationGracePeriodSeconds (number, placeholder `30`, integer)
- nodeSelector (key-value-list)
- priorityClassName (text, omitIfEmpty)
- dnsPolicy (select: ClusterFirst/Default/ClusterFirstWithHostNet/None)

### `makePodAnnotationsField(podTemplatePrefix)`

Returns a single key-value-list field at `[...podTemplatePrefix, 'annotations']`, label "Pod Annotations".

### `makeImagePullSecretsField(podSpecPrefix)`

Returns a single group-list field at `[...podSpecPrefix, 'imagePullSecrets']` with a single `name` text sub-field. Default value: `{ name: '' }`.

---

## Deployment Changes

### Containers section

Replace inline container fields with `makeContainerSubFields`. Adds `startupProbe` (new). Otherwise identical to current.

### Volumes section

Replace inline volume fields with `volumeSubFields`. No functional change.

### Advanced section

Restructured to combine Deployment-level and pod-spec-level fields:

**Deployment-level (existing + new):**
- strategyType (existing), maxSurge (existing), maxUnavailable (existing)
- `minReadySeconds` — number, placeholder `0`, integer, `spec.minReadySeconds`
- `progressDeadlineSeconds` — number, placeholder `600`, integer, `spec.progressDeadlineSeconds`
- `revisionHistoryLimit` — number, placeholder `10`, integer, `spec.revisionHistoryLimit`

**Pod-spec-level (shared + resource-specific):**
- `...makeAdvancedPodSpecFields(['spec', 'template', 'spec'])` (serviceAccountName, terminationGracePeriod, nodeSelector, priorityClassName, dnsPolicy)
- restartPolicy — select (Always only), Deployment-specific
- `makePodAnnotationsField(['spec', 'template', 'metadata'])` — key-value-list, label "Pod Annotations"
- `makeImagePullSecretsField(['spec', 'template', 'spec'])` — group-list, single `name` text sub-field

---

## Job Overhaul

### Metadata section (slimmed)

- name (text, required), namespace (namespace-select), labels (key-value-list, **new**), annotations (key-value-list)
- `backoffLimit` and `restartPolicy` moved out to new Spec section

### Spec section (new)

- `backoffLimit` — number, placeholder `6`, integer, `spec.backoffLimit` (corrected from `3` to match Kubernetes default)
- `completions` — number, placeholder `1`, integer, `spec.completions`
- `parallelism` — number, placeholder `1`, integer, `spec.parallelism`
- `activeDeadlineSeconds` — number, integer, `spec.activeDeadlineSeconds`, omitIfEmpty
- `ttlSecondsAfterFinished` — number, integer, `spec.ttlSecondsAfterFinished`, omitIfEmpty

Note: `completions` and `parallelism` do not need `omitIfEmpty` — number fields produce no YAML output when left empty. `omitIfEmpty` is only needed for text fields where an empty string would otherwise persist as `key: ""`.
- `restartPolicy` — select (Never/OnFailure), `spec.template.spec.restartPolicy`

### Containers section

Replace minimal 4-field definition with `makeContainerSubFields`. Path: `spec.template.spec.containers`. Adds imagePullPolicy, args, env, ports, all 3 probes, volumeMounts.

### Volumes section (new)

`volumeSubFields` at `spec.template.spec.volumes`.

### Advanced section (new)

- `...makeAdvancedPodSpecFields(['spec', 'template', 'spec'])`
- `makePodAnnotationsField(['spec', 'template', 'metadata'])`
- `makeImagePullSecretsField(['spec', 'template', 'spec'])`

---

## CronJob Overhaul

### Metadata section (slimmed)

- name (text, required), namespace (namespace-select), labels (key-value-list, **new**), annotations (key-value-list)
- `schedule`, `backoffLimit`, `restartPolicy` moved out to new section

### Schedule & Job section (new)

- `schedule` — text, required, placeholder `0 * * * *`, `spec.schedule`
- `concurrencyPolicy` — select (Allow/Forbid/Replace), `spec.concurrencyPolicy`
- `suspend` — boolean-toggle, `spec.suspend`
- `startingDeadlineSeconds` — number, integer, `spec.startingDeadlineSeconds`, omitIfEmpty
- `successfulJobsHistoryLimit` — number, placeholder `3`, integer, `spec.successfulJobsHistoryLimit`
- `failedJobsHistoryLimit` — number, placeholder `1`, integer, `spec.failedJobsHistoryLimit`
- `backoffLimit` — number, placeholder `6`, integer, `spec.jobTemplate.spec.backoffLimit` (corrected from `3` to match Kubernetes default)
- `restartPolicy` — select (Never/OnFailure), `spec.jobTemplate.spec.template.spec.restartPolicy`

### Containers section

`makeContainerSubFields` at `spec.jobTemplate.spec.template.spec.containers`.

### Volumes section (new)

`volumeSubFields` at `spec.jobTemplate.spec.template.spec.volumes`.

### Advanced section (new)

- `...makeAdvancedPodSpecFields(['spec', 'jobTemplate', 'spec', 'template', 'spec'])`
- `makePodAnnotationsField(['spec', 'jobTemplate', 'spec', 'template', 'metadata'])`
- `makeImagePullSecretsField(['spec', 'jobTemplate', 'spec', 'template', 'spec'])`

---

## Testing

No new components are being built — all changes are declarative form definitions using existing field types. Testing focuses on:

1. **formDefinitions.test.ts** — extend existing test file:
   - All definitions with containers include startupProbe
   - Job/CronJob have volumes section
   - Job/CronJob have advanced pod-spec fields
   - Shared fields are structurally correct (no missing keys, paths resolve)
   - Job-specific and CronJob-specific fields are present

2. **Existing ResourceForm.test.tsx** — must continue passing (no regressions)

3. **No new component tests needed** — startupProbe uses the already-tested `probe` type, imagePullSecrets uses existing `group-list`, etc.
