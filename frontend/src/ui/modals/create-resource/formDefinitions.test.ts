import { describe, expect, it } from 'vitest';
import {
  getFormDefinition,
  allFormDefinitions,
  type ResourceFormDefinition,
} from './formDefinitions';

describe('formDefinitions', () => {
  it('returns a definition for each supported kind', () => {
    const supportedKinds = [
      'Deployment',
      'Service',
      'ConfigMap',
      'Secret',
      'Job',
      'CronJob',
      'Ingress',
    ];
    for (const kind of supportedKinds) {
      const def = getFormDefinition(kind);
      expect(def, `missing form definition for ${kind}`).toBeDefined();
      expect(def!.kind).toBe(kind);
    }
  });

  it('returns undefined for unsupported kinds', () => {
    expect(getFormDefinition('Pod')).toBeUndefined();
    expect(getFormDefinition('DaemonSet')).toBeUndefined();
    expect(getFormDefinition('')).toBeUndefined();
  });

  it('has no duplicate field keys within a definition', () => {
    for (const def of allFormDefinitions) {
      const allKeys = new Set<string>();
      const collectKeys = (fields: ResourceFormDefinition['sections'][0]['fields']) => {
        for (const field of fields) {
          expect(allKeys.has(field.key), `duplicate key "${field.key}" in ${def.kind}`).toBe(false);
          allKeys.add(field.key);
          if (field.fields) {
            // Group-list sub-fields are scoped — only check within their parent.
            const subKeys = new Set<string>();
            for (const sub of field.fields) {
              expect(
                subKeys.has(sub.key),
                `duplicate sub-key "${sub.key}" in ${def.kind}/${field.key}`
              ).toBe(false);
              subKeys.add(sub.key);
            }
          }
        }
      };
      for (const section of def.sections) {
        collectKeys(section.fields);
      }
    }
  });

  it('every field has a non-empty path', () => {
    for (const def of allFormDefinitions) {
      for (const section of def.sections) {
        for (const field of section.fields) {
          expect(field.path.length, `empty path for ${def.kind}/${field.key}`).toBeGreaterThan(0);
        }
      }
    }
  });

  it('every select field has at least one option', () => {
    for (const def of allFormDefinitions) {
      for (const section of def.sections) {
        for (const field of section.fields) {
          if (field.type === 'select') {
            expect(
              field.options?.length,
              `no options for select ${def.kind}/${field.key}`
            ).toBeGreaterThan(0);
          }
        }
      }
    }
  });

  it('all definitions mark name as required', () => {
    for (const def of allFormDefinitions) {
      const nameField = def.sections
        .flatMap((s) => s.fields)
        .find((f) => f.key === 'name' && f.path.join('.') === 'metadata.name');
      expect(nameField, `${def.kind} should have a name field`).toBeDefined();
      expect(nameField!.required, `${def.kind} name field should be required`).toBe(true);
    }
  });
});

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
const findNestedSubField = (
  field: FieldDef,
  subKey: string,
  nestedKey: string
): FieldDef | undefined => {
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

      it('has containers with envFrom field of type env-from', () => {
        const containers = findField(def, 'containers')!;
        const envFrom = findSubField(containers, 'envFrom');
        expect(envFrom).toBeDefined();
        expect(envFrom!.type).toBe('env-from');
      });

      it('has containers with env field of type env-var', () => {
        const containers = findField(def, 'containers')!;
        const env = findSubField(containers, 'env');
        expect(env).toBeDefined();
        expect(env!.type).toBe('env-var');
      });

      it('has initContainers with env field of type env-var', () => {
        const initContainers = findField(def, 'initContainers')!;
        const env = findSubField(initContainers, 'env');
        expect(env).toBeDefined();
        expect(env!.type).toBe('env-var');
      });

      it('has initContainers section with correct path and properties', () => {
        const initContainers = findField(def, 'initContainers')!;
        expect(initContainers).toBeDefined();
        expect(initContainers.type).toBe('group-list');
        expect(initContainers.fullWidth).toBe(true);
        expect(initContainers.itemTitleField).toBe('name');
        expect(initContainers.itemTitleFallback).toBe('Init Container');
      });

      it('initContainers has key sub-fields matching containers', () => {
        const initContainers = findField(def, 'initContainers')!;
        expect(findSubField(initContainers, 'readinessProbe')).toBeDefined();
        expect(findSubField(initContainers, 'livenessProbe')).toBeDefined();
        expect(findSubField(initContainers, 'startupProbe')).toBeDefined();
        expect(findSubField(initContainers, 'env')).toBeDefined();
        expect(findSubField(initContainers, 'ports')).toBeDefined();
        expect(findSubField(initContainers, 'volumeMounts')).toBeDefined();
        expect(findSubField(initContainers, 'envFrom')).toBeDefined();
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

      it('has container securityContext fields', () => {
        const containers = findField(def, 'containers')!;
        // Number fields.
        const runAsUser = findSubField(containers, 'secRunAsUser');
        expect(runAsUser).toBeDefined();
        expect(runAsUser!.type).toBe('number');
        expect(runAsUser!.path).toEqual(['securityContext', 'runAsUser']);
        const runAsGroup = findSubField(containers, 'secRunAsGroup');
        expect(runAsGroup).toBeDefined();
        expect(runAsGroup!.type).toBe('number');
        // Tri-state booleans.
        const runAsNonRoot = findSubField(containers, 'secRunAsNonRoot');
        expect(runAsNonRoot).toBeDefined();
        expect(runAsNonRoot!.type).toBe('tri-state-boolean');
        const privileged = findSubField(containers, 'secPrivileged');
        expect(privileged).toBeDefined();
        expect(privileged!.type).toBe('tri-state-boolean');
        const allowPrivEsc = findSubField(containers, 'secAllowPrivEsc');
        expect(allowPrivEsc).toBeDefined();
        expect(allowPrivEsc!.type).toBe('tri-state-boolean');
        const readOnlyRoot = findSubField(containers, 'secReadOnlyRoot');
        expect(readOnlyRoot).toBeDefined();
        expect(readOnlyRoot!.type).toBe('tri-state-boolean');
        // Capabilities.
        const cap = findSubField(containers, 'secCapabilities');
        expect(cap).toBeDefined();
        expect(cap!.type).toBe('capabilities');
      });

      it('has initContainers securityContext fields', () => {
        const initContainers = findField(def, 'initContainers')!;
        expect(findSubField(initContainers, 'secRunAsUser')).toBeDefined();
        expect(findSubField(initContainers, 'secRunAsNonRoot')).toBeDefined();
        expect(findSubField(initContainers, 'secCapabilities')).toBeDefined();
      });

      it('has pod securityContext fields in Advanced', () => {
        const podRunAsUser = findField(def, 'podSecRunAsUser');
        expect(podRunAsUser).toBeDefined();
        expect(podRunAsUser!.type).toBe('number');
        const podRunAsNonRoot = findField(def, 'podSecRunAsNonRoot');
        expect(podRunAsNonRoot).toBeDefined();
        expect(podRunAsNonRoot!.type).toBe('tri-state-boolean');
        const fsGroup = findField(def, 'podSecFsGroup');
        expect(fsGroup).toBeDefined();
        expect(fsGroup!.type).toBe('number');
      });

      it('has tolerations field as group-list', () => {
        const tolerations = findField(def, 'tolerations');
        expect(tolerations).toBeDefined();
        expect(tolerations!.type).toBe('group-list');
        expect(tolerations!.fullWidth).toBe(true);
        // Check sub-fields.
        const key = findSubField(tolerations!, 'key');
        expect(key).toBeDefined();
        expect(key!.type).toBe('text');
        const operator = findSubField(tolerations!, 'operator');
        expect(operator).toBeDefined();
        expect(operator!.type).toBe('select');
        const effect = findSubField(tolerations!, 'effect');
        expect(effect).toBeDefined();
        expect(effect!.type).toBe('select');
      });

      it('has affinity field of type affinity', () => {
        const affinity = findField(def, 'affinity');
        expect(affinity).toBeDefined();
        expect(affinity!.type).toBe('affinity');
        expect(affinity!.fullWidth).toBe(true);
      });

      it('has topologySpreadConstraints field as group-list', () => {
        const tsc = findField(def, 'topologySpreadConstraints');
        expect(tsc).toBeDefined();
        expect(tsc!.type).toBe('group-list');
        expect(tsc!.fullWidth).toBe(true);
        // Check sub-fields.
        const topoKey = findSubField(tsc!, 'topologyKey');
        expect(topoKey).toBeDefined();
        expect(topoKey!.type).toBe('text');
        const maxSkew = findSubField(tsc!, 'maxSkew');
        expect(maxSkew).toBeDefined();
        expect(maxSkew!.type).toBe('number');
        const whenUnsatisfiable = findSubField(tsc!, 'whenUnsatisfiable');
        expect(whenUnsatisfiable).toBeDefined();
        expect(whenUnsatisfiable!.type).toBe('select');
        const matchLabels = findSubField(tsc!, 'matchLabels');
        expect(matchLabels).toBeDefined();
        expect(matchLabels!.type).toBe('key-value-list');
      });
    });
  }
});

// ---------------------------------------------------------------------------
// Deployment-specific fields
// ---------------------------------------------------------------------------

describe('Deployment-specific fields', () => {
  const def = getFormDefinition('Deployment')!;

  it('initContainers uses Deployment path', () => {
    const initContainers = findField(def, 'initContainers')!;
    expect(initContainers.path).toEqual(['spec', 'template', 'spec', 'initContainers']);
  });

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

  it('initContainers uses Job path', () => {
    const initContainers = findField(def, 'initContainers')!;
    expect(initContainers.path).toEqual(['spec', 'template', 'spec', 'initContainers']);
  });

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

  it('initContainers uses CronJob path', () => {
    const initContainers = findField(def, 'initContainers')!;
    expect(initContainers.path).toEqual([
      'spec',
      'jobTemplate',
      'spec',
      'template',
      'spec',
      'initContainers',
    ]);
  });

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
    expect(field!.path).toEqual([
      'spec',
      'jobTemplate',
      'spec',
      'template',
      'metadata',
      'annotations',
    ]);
  });

  it('has imagePullSecrets at correct CronJob path', () => {
    const field = findField(def, 'imagePullSecrets');
    expect(field!.path).toEqual([
      'spec',
      'jobTemplate',
      'spec',
      'template',
      'spec',
      'imagePullSecrets',
    ]);
  });
});
