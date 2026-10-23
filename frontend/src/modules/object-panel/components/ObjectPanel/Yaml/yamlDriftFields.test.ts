/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Yaml/yamlDriftFields.test.ts
 *
 * The YAML edit session's field-by-field view of drift: which fields someone
 * else changed since the edit began, what the draft holds for each, which of
 * them conflict with the user's own edits, and copying their value into the
 * draft. Server-owned fields (the field policy's semantic compare) never count.
 */

import { describe, expect, it } from 'vitest';
import * as YAML from 'yaml';
import { compareDriftFields, copyDriftField } from './yamlDriftFields';

const deployment = ({
  resourceVersion = '1',
  replicas = 3,
  image = '1.4.2',
  sidecar = 'proxy:1.0',
  team,
  status,
}: {
  resourceVersion?: string;
  replicas?: number;
  image?: string;
  sidecar?: string;
  team?: string;
  status?: string;
} = {}) =>
  YAML.stringify({
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: {
      name: 'api',
      namespace: 'payments',
      resourceVersion,
      labels: { app: 'api', ...(team ? { team } : {}) },
    },
    spec: {
      replicas,
      template: {
        spec: {
          containers: [
            { name: 'proxy', image: sidecar },
            { name: 'api', image: `registry.example.com/api:${image}` },
          ],
        },
      },
    },
    ...(status ? { status: { phase: status } } : {}),
  });

const IMAGE = 'spec.template.spec.containers[api].image';

describe('compareDriftFields', () => {
  it('lists the fields someone else changed, with the draft’s value for each', () => {
    const fields = compareDriftFields({
      baselineYaml: deployment(),
      liveYaml: deployment({ resourceVersion: '7', replicas: 5, team: 'payments' }),
      draftYaml: deployment({ image: '1.5.0' }),
    });

    expect(fields).toEqual([
      expect.objectContaining({
        key: 'metadata.labels.team',
        started: undefined,
        now: 'payments',
        draft: undefined,
        edited: false,
        conflict: false,
      }),
      // The draft still holds the original value: you did not edit it.
      expect.objectContaining({
        key: 'spec.replicas',
        started: '3',
        now: '5',
        draft: '3',
        edited: false,
        conflict: false,
      }),
    ]);
  });

  it('flags a field the draft also changed to another value, keyed by container name', () => {
    const fields = compareDriftFields({
      baselineYaml: deployment(),
      // The field is named by the container's name, not its list index.
      liveYaml: deployment({ image: '1.4.3' }),
      draftYaml: deployment({ image: '1.5.0' }),
    });

    expect(fields).toEqual([
      expect.objectContaining({
        key: IMAGE,
        started: 'registry.example.com/api:1.4.2',
        now: 'registry.example.com/api:1.4.3',
        draft: 'registry.example.com/api:1.5.0',
        edited: true,
        conflict: true,
      }),
    ]);
  });

  it('does not flag a field the draft changed to the same value', () => {
    const [field] = compareDriftFields({
      baselineYaml: deployment(),
      liveYaml: deployment({ image: '1.5.0' }),
      draftYaml: deployment({ image: '1.5.0' }),
    });

    expect(field).toEqual(expect.objectContaining({ key: IMAGE, conflict: false }));
  });

  it('ignores status and server-owned metadata', () => {
    expect(
      compareDriftFields({
        baselineYaml: deployment(),
        liveYaml: deployment({ resourceVersion: '9', status: 'Running' }),
        draftYaml: deployment({ image: '1.5.0' }),
      })
    ).toEqual([]);
  });

  it('flags nothing while the draft is not valid YAML', () => {
    const fields = compareDriftFields({
      baselineYaml: deployment(),
      liveYaml: deployment({ image: '1.4.3' }),
      draftYaml: 'spec: [unclosed',
    });

    expect(fields).toEqual([expect.objectContaining({ key: IMAGE, conflict: false })]);
  });
});

describe('copyDriftField', () => {
  it('sets the draft’s field to the live value, finding containers by name', () => {
    const [field] = compareDriftFields({
      baselineYaml: deployment(),
      liveYaml: deployment({ image: '1.4.3' }),
      draftYaml: deployment({ image: '1.5.0', replicas: 4 }),
    });

    const draft = YAML.parse(
      copyDriftField(
        deployment({ image: '1.5.0', replicas: 4 }),
        deployment({ image: '1.4.3' }),
        field.path
      )
    );

    expect(draft.spec.template.spec.containers).toEqual([
      { name: 'proxy', image: 'proxy:1.0' },
      { name: 'api', image: 'registry.example.com/api:1.4.3' },
    ]);
    // The draft’s other edits stay.
    expect(draft.spec.replicas).toBe(4);
  });

  // A named list item (an environment variable) one side deleted and the
  // other changed: the copy adds or removes the whole item.
  const ENV_PATH = ['spec', 'containers', { name: 'api' }, 'env', { name: 'MODE' }, 'value'];
  const podWithEnv = (...env: Array<{ name: string; value: string }>) =>
    YAML.stringify({ spec: { containers: [{ name: 'api', env }] } });
  const MODE_B = { name: 'MODE', value: 'b' };
  const KEEP = { name: 'KEEP', value: '1' };

  // Kubernetes expands $(BASE) only from variables listed before it (and runs
  // init containers in list order), so a restored item keeps its position
  // among the items the draft still has.
  const envVar = (name: string) => ({
    name,
    value: name === 'DERIVED' ? '$(BASE)' : name.toLowerCase(),
  });
  it.each([
    { live: ['BASE', 'DERIVED'], draft: ['DERIVED'], restored: ['BASE', 'DERIVED'] },
    { live: ['A', 'BASE', 'DERIVED'], draft: ['A', 'DERIVED'], restored: ['A', 'BASE', 'DERIVED'] },
    {
      live: ['A', 'B', 'BASE', 'DERIVED'],
      draft: ['A', 'DERIVED'],
      restored: ['A', 'BASE', 'DERIVED'],
    },
  ])(
    'restores a named item the draft deleted at its live position: $live into $draft',
    ({ live, draft, restored }) => {
      const result = YAML.parse(
        copyDriftField(podWithEnv(...draft.map(envVar)), podWithEnv(...live.map(envVar)), [
          'spec',
          'containers',
          { name: 'api' },
          'env',
          { name: 'BASE' },
          'value',
        ])
      );

      expect(result.spec.containers[0].env).toEqual(restored.map(envVar));
    }
  );

  it('removes the whole named item, not only its field, when the source has no such item', () => {
    const draft = YAML.parse(copyDriftField(podWithEnv(MODE_B, KEEP), podWithEnv(KEEP), ENV_PATH));

    expect(draft.spec.containers[0].env).toEqual([KEEP]);
  });

  it('removes the draft’s field when the live object no longer has it', () => {
    const [field] = compareDriftFields({
      baselineYaml: deployment({ team: 'payments' }),
      liveYaml: deployment(),
      draftYaml: deployment({ team: 'billing' }),
    });

    const draft = YAML.parse(
      copyDriftField(deployment({ team: 'billing' }), deployment(), field.path)
    );

    expect(draft.metadata.labels).toEqual({ app: 'api' });
  });
});
