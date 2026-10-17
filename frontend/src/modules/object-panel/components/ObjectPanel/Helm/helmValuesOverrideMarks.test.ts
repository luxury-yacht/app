/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Helm/helmValuesOverrideMarks.test.ts
 *
 * The Merged view marks every line a user override set. Fixtures follow
 * Helm's merge: overrides win, null removes a key, lists are replaced whole,
 * and each subchart receives a copy of the parent's `global` values.
 */

import { describe, expect, it } from 'vitest';
import {
  computeHelmValuesOverrideMarks,
  type HelmValuesMarkedView,
  type HelmValuesOverrideSource,
  stringifyHelmValues,
} from './helmValuesOverrideMarks';

const marksFor = (source: HelmValuesOverrideSource, view: HelmValuesMarkedView = 'merged') => {
  const text = stringifyHelmValues(source[view]);
  const lines = text.split('\n');
  const lineOf = (content: string) => {
    const index = lines.indexOf(content);
    if (index < 0) {
      throw new Error(`fixture YAML has no line "${content}":\n${text}`);
    }
    return index + 1;
  };
  const marks = computeHelmValuesOverrideMarks(text, source, view);
  const byPath = new Map(
    [...marks.lines.values()].map((mark) => [mark.path.join('.'), mark] as const)
  );
  return { marks, lineOf, byPath, text };
};

describe('computeHelmValuesOverrideMarks', () => {
  it('marks each overridden value by line with how it relates to the chart default', () => {
    const { marks, lineOf, text } = marksFor({
      defaults: {
        image: { repository: 'nginx', tag: '' },
        ingress: { hosts: ['chart.local'] },
        replicaCount: 1,
        service: { type: 'ClusterIP' },
      },
      overrides: {
        image: { tag: 'v2' },
        ingress: { hosts: ['a.example.com', 'b.example.com'] },
        podLabels: { team: 'web' },
        replicaCount: 3,
        service: { type: 'ClusterIP' },
      },
      merged: {
        image: { repository: 'nginx', tag: 'v2' },
        ingress: { hosts: ['a.example.com', 'b.example.com'] },
        podLabels: { team: 'web' },
        replicaCount: 3,
        service: { type: 'ClusterIP' },
      },
      subchartPaths: null,
    });

    const kindAt = (content: string) => marks.lines.get(lineOf(content))?.kind;
    expect(kindAt('  tag: v2')).toBe('changed');
    expect(marks.lines.get(lineOf('  tag: v2'))?.chartDefault).toEqual({ value: '' });
    expect(kindAt('replicaCount: 3')).toBe('changed');
    expect(kindAt('  team: web')).toBe('added');
    expect(kindAt('  type: ClusterIP')).toBe('same');
    // A list override replaces the whole list, so every line of it is marked.
    expect(kindAt('  hosts:')).toBe('changed');
    expect(kindAt('    - a.example.com')).toBe('changed');
    expect(kindAt('    - b.example.com')).toBe('changed');
    // Chart values and the parents of overridden keys stay unmarked.
    for (const content of ['image:', '  repository: nginx', 'ingress:', 'podLabels:', 'service:']) {
      expect(kindAt(content), content).toBeUndefined();
    }
    expect(marks.overriddenCount).toBe(5);
    // The label is the overridden key alone, so its value keeps syntax colors.
    const labelOf = (content: string) => {
      const label = marks.lines.get(lineOf(content))?.label;
      return label && text.slice(label.from, label.to);
    };
    expect(labelOf('  tag: v2')).toBe('tag');
    expect(labelOf('    - b.example.com')).toBe('hosts');
  });

  it('marks subchart copies of global overrides only under reported subcharts', () => {
    const { marks, byPath } = marksFor({
      defaults: {
        global: { region: 'us' },
        postgresql: { global: { region: 'us', tier: 'standard' } },
        redis: {
          global: { region: 'us' },
          port: 6379,
          sentinel: { global: { region: 'us' } },
        },
        settings: { global: { region: 'us' } },
      },
      overrides: {
        global: { region: 'eu' },
        postgresql: { global: { tier: 'fast' } },
        // Helm lets the parent's global win over a subchart's own global.
        redis: { global: { region: 'ap' } },
      },
      merged: {
        global: { region: 'eu' },
        postgresql: { global: { region: 'eu', tier: 'fast' } },
        redis: {
          global: { region: 'eu' },
          port: 6379,
          sentinel: { global: { region: 'eu' } },
        },
        settings: { global: { region: 'us' } },
      },
      subchartPaths: [['redis'], ['redis', 'sentinel'], ['postgresql']],
    });

    const markAt = (path: string) => {
      const mark = byPath.get(path);
      return mark && { kind: mark.kind, source: mark.source.join('.') };
    };
    expect(markAt('global.region')).toEqual({ kind: 'changed', source: 'global.region' });
    expect(markAt('redis.global.region')).toEqual({ kind: 'global', source: 'global.region' });
    expect(markAt('redis.sentinel.global.region')).toEqual({
      kind: 'global',
      source: 'global.region',
    });
    expect(markAt('postgresql.global.region')).toEqual({
      kind: 'global',
      source: 'global.region',
    });
    expect(markAt('postgresql.global.tier')).toEqual({
      kind: 'changed',
      source: 'postgresql.global.tier',
    });
    expect(byPath.get('redis.global.region')?.chartDefault).toEqual({ value: 'us' });
    // `settings` is not a subchart, so Helm never copied globals into it.
    expect(byPath.has('settings.global.region')).toBe(false);
    // Only values the user set count; subchart copies do not.
    expect(marks.overriddenCount).toBe(2);
  });

  it('places each removed key where it would sort among its remaining siblings', () => {
    const { marks, lineOf } = marksFor({
      defaults: {
        alpha: 1,
        beta: { drop: 2, keep: 1 },
        onlyChild: { gone: 1 },
        testFramework: { enabled: true },
      },
      overrides: {
        beta: { drop: null },
        neverInChart: null,
        onlyChild: { gone: null },
        testFramework: null,
      },
      merged: { alpha: 1, beta: { keep: 1 }, onlyChild: {} },
      subchartPaths: null,
    });

    expect(marks.removed).toHaveLength(3);
    expect(marks.removedCount).toBe(3);
    expect(marks.removed).toEqual(
      expect.arrayContaining([
        {
          path: ['beta', 'drop'],
          chartDefault: 2,
          line: lineOf('  keep: 1'),
          side: 'before',
        },
        {
          path: ['onlyChild', 'gone'],
          chartDefault: 1,
          line: lineOf('onlyChild: {}'),
          side: 'after',
        },
        {
          path: ['testFramework'],
          chartDefault: { enabled: true },
          line: lineOf('onlyChild: {}'),
          side: 'after',
        },
      ])
    );
  });

  it('marks an empty-map override on its key line without claiming chart children', () => {
    const { marks, lineOf } = marksFor({
      defaults: { nodeSelector: {}, podAnnotations: { owner: 'chart' } },
      overrides: { nodeSelector: {}, podAnnotations: {} },
      merged: { nodeSelector: {}, podAnnotations: { owner: 'chart' } },
      subchartPaths: null,
    });

    expect(marks.lines.get(lineOf('nodeSelector: {}'))?.kind).toBe('same');
    expect(marks.lines.get(lineOf('podAnnotations:'))?.kind).toBe('same');
    expect(marks.lines.has(lineOf('  owner: chart'))).toBe(false);
  });

  it('marks every line the user set in the Overrides view, including null removals', () => {
    const { marks, lineOf } = marksFor(
      {
        defaults: {
          image: { repository: 'nginx', tag: '' },
          ingress: { hosts: ['chart.local'] },
          replicaCount: 1,
          service: { type: 'ClusterIP' },
          testFramework: { enabled: true },
        },
        overrides: {
          image: { tag: 'v2' },
          ingress: { hosts: ['a.example.com', 'b.example.com'] },
          podLabels: { team: 'web' },
          replicaCount: 3,
          service: { type: 'ClusterIP' },
          testFramework: null,
        },
        merged: {
          image: { repository: 'nginx', tag: 'v2' },
          ingress: { hosts: ['a.example.com', 'b.example.com'] },
          podLabels: { team: 'web' },
          replicaCount: 3,
          service: { type: 'ClusterIP' },
        },
        subchartPaths: null,
      },
      'overrides'
    );

    const kindAt = (content: string) => marks.lines.get(lineOf(content))?.kind;
    expect(kindAt('  tag: v2')).toBe('changed');
    expect(kindAt('replicaCount: 3')).toBe('changed');
    expect(kindAt('  team: web')).toBe('added');
    expect(kindAt('  type: ClusterIP')).toBe('same');
    expect(kindAt('    - b.example.com')).toBe('changed');
    // The null line is in the text here, so it is marked in place.
    expect(kindAt('testFramework: null')).toBe('removed');
    expect(marks.lines.get(lineOf('testFramework: null'))?.chartDefault).toEqual({
      value: { enabled: true },
    });
    for (const content of ['image:', 'ingress:', 'podLabels:', 'service:']) {
      expect(kindAt(content), content).toBeUndefined();
    }
    expect(marks.removed).toEqual([]);
    expect(marks.overriddenCount).toBe(5);
    expect(marks.removedCount).toBe(1);
  });
});
