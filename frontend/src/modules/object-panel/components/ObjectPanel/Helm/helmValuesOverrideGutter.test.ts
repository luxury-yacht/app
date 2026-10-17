/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Helm/helmValuesOverrideGutter.test.ts
 *
 * Renders the override marks in a real CodeMirror view: overridden lines get a
 * gutter marker naming the chart default, and a key a null override removed is
 * shown as a row that is not part of the document text.
 */

import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';
import { helmValuesOverrideGutter, helmValuesOverrideTooltip } from './helmValuesOverrideGutter';
import {
  computeHelmValuesOverrideMarks,
  type HelmValuesOverrideSource,
  stringifyHelmValues,
} from './helmValuesOverrideMarks';

const VALUES: HelmValuesOverrideSource = {
  defaults: {
    image: { repository: 'nginx', tag: 'chart-stable' },
    testFramework: { enabled: true },
    zeta: 1,
  },
  overrides: { image: { tag: 'v2' }, team: 'web', testFramework: null, zeta: 1 },
  merged: { image: { repository: 'nginx', tag: 'v2' }, team: 'web', zeta: 1 },
  subchartPaths: null,
};

let mounted: EditorView | null = null;

const render = () => {
  const text = stringifyHelmValues(VALUES.merged);
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  mounted = new EditorView({
    parent,
    state: EditorState.create({
      doc: text,
      extensions: [
        helmValuesOverrideGutter(computeHelmValuesOverrideMarks(text, VALUES, 'merged')),
      ],
    }),
  });
  return { parent, view: mounted };
};

afterEach(() => {
  mounted?.destroy();
  mounted = null;
  document.body.textContent = '';
});

describe('helmValuesOverrideGutter', () => {
  it('marks overridden lines in the gutter with the chart default they replaced', () => {
    const { parent } = render();

    const changed = parent.querySelectorAll('.helm-values-override-marker--changed');
    const added = parent.querySelectorAll('.helm-values-override-marker--added');
    const same = parent.querySelectorAll('.helm-values-override-marker--same');
    expect(changed).toHaveLength(1);
    expect(added).toHaveLength(1);
    expect(same).toHaveLength(1);
    // Diff-style symbols: > changed, + new, = equal to the chart default.
    expect(changed[0].textContent).toBe('>');
    expect(added[0].textContent).toBe('+');
    expect(same[0].textContent).toBe('=');
    expect(changed[0].getAttribute('title')).toContain('chart-stable');
    // Only each overridden key is colored; values keep their syntax colors.
    const labels = [...parent.querySelectorAll('.helm-values-override-label')];
    expect(labels.map((label) => label.textContent)).toEqual(['tag', 'team', 'zeta']);
  });

  it('shows a removed key beside its siblings without adding it to the document', () => {
    const { parent, view } = render();

    const ghost = parent.querySelector('.helm-values-removed-key');
    expect(ghost?.textContent).toContain('testFramework');
    expect(ghost?.getAttribute('title')).toContain('enabled: true');
    expect(ghost?.nextElementSibling?.textContent).toBe('zeta: 1');
    expect(view.state.doc.toString()).not.toContain('testFramework');
    const removed = parent.querySelectorAll('.helm-values-override-marker--removed');
    expect(removed).toHaveLength(1);
    expect(removed[0].textContent).toBe('-');
  });

  it('names the chart default, or the global override a subchart copied, on hover', () => {
    const longDefault = Object.fromEntries(
      Array.from({ length: 20 }, (_, index) => [`key${index}`, index])
    );
    const values: HelmValuesOverrideSource = {
      defaults: {
        config: longDefault,
        global: { region: 'us' },
        redis: { global: { region: 'us' } },
        replicaCount: 1,
      },
      overrides: { config: 'inline', global: { region: 'eu' }, replicaCount: 3 },
      merged: {
        config: 'inline',
        global: { region: 'eu' },
        redis: { global: { region: 'eu' } },
        replicaCount: 3,
      },
      subchartPaths: [['redis']],
    };
    const text = stringifyHelmValues(values.merged);
    const tooltipAt = helmValuesOverrideTooltip(
      computeHelmValuesOverrideMarks(text, values, 'merged')
    );
    const view = new EditorView({ state: EditorState.create({ doc: text }) });
    mounted = view;
    const hover = (content: string) => {
      const tooltip = tooltipAt(view, text.indexOf(content));
      return tooltip ? tooltip.create(view).dom : null;
    };
    const defaultShown = (dom: HTMLElement | null) =>
      dom?.querySelector('.helm-values-override-tooltip__value')?.textContent;

    expect(defaultShown(hover('replicaCount: 3'))).toBe('1');
    const copied = hover('    region: eu');
    expect(copied?.textContent).toContain('global.region');
    expect(defaultShown(copied)).toBe('us');
    // A long chart default is cut short so the tooltip stays readable.
    const truncated = defaultShown(hover('config: inline'))?.split('\n');
    expect(truncated?.[0]).toBe('key0: 0');
    expect(truncated?.length).toBeLessThan(20);
    expect(hover('redis:')).toBeNull();
  });

  it('marks a null override in the Overrides view with the chart default it removed', () => {
    const text = stringifyHelmValues(VALUES.overrides);
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    mounted = new EditorView({
      parent,
      state: EditorState.create({
        doc: text,
        extensions: [
          helmValuesOverrideGutter(computeHelmValuesOverrideMarks(text, VALUES, 'overrides')),
        ],
      }),
    });

    const removed = parent.querySelectorAll('.helm-values-override-marker--removed');
    expect(removed).toHaveLength(1);
    expect(removed[0].getAttribute('title')).toContain('enabled: true');
    expect(parent.querySelector('.helm-values-removed-key')).toBeNull();
  });
});
