/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Helm/helmValuesOverrideGutter.ts
 *
 * Shows override marks in the Values tab's Merged and Overrides views: a gutter
 * marker on each overridden line and a hover tooltip with the chart default.
 * Merged also gets a row for each key a null override removed; those rows are
 * widgets, not document text, so copying and searching are unaffected.
 */

import { type EditorState, type Extension, StateField } from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  EditorView,
  GutterMarker,
  gutter,
  hoverTooltip,
  type Tooltip,
  WidgetType,
} from '@codemirror/view';
import {
  type HelmValuesOverride,
  type HelmValuesOverrideKind,
  type HelmValuesOverrideMarks,
  type HelmValuesRemovedKey,
  stringifyHelmValues,
} from './helmValuesOverrideMarks';

const MAX_DEFAULT_LINES = 12;

// Diff-style gutter symbols. A subchart copy of a global override is a
// changed value; its tooltip names the global override.
const OVERRIDE_SYMBOLS: Record<HelmValuesOverrideKind, string> = {
  changed: '>',
  added: '+',
  same: '=',
  global: '>',
  removed: '-',
};

const OVERRIDE_TITLES: Record<HelmValuesOverrideKind, string> = {
  changed: 'Override',
  added: 'Added by override · not in chart defaults',
  same: 'Override · same as chart default',
  global: 'Override',
  removed: 'Removed by override',
};

interface OverrideDescription {
  title: string;
  chartDefault: string | null;
}

const formatChartDefault = (value: unknown): string => {
  const lines = stringifyHelmValues(value).trimEnd().split('\n');
  return lines.length > MAX_DEFAULT_LINES
    ? `${lines.slice(0, MAX_DEFAULT_LINES).join('\n')}\n…`
    : lines.join('\n');
};

const describeOverride = (mark: HelmValuesOverride): OverrideDescription => {
  const showDefault = mark.kind === 'changed' || mark.kind === 'global' || mark.kind === 'removed';
  return {
    title:
      mark.kind === 'global'
        ? `From override of ${mark.source.join('.')}`
        : OVERRIDE_TITLES[mark.kind],
    chartDefault:
      showDefault && mark.chartDefault ? formatChartDefault(mark.chartDefault.value) : null,
  };
};

const describeRemoved = (removed: HelmValuesRemovedKey): OverrideDescription => ({
  title: OVERRIDE_TITLES.removed,
  chartDefault: formatChartDefault(removed.chartDefault),
});

const plainText = ({ title, chartDefault }: OverrideDescription) => {
  if (chartDefault === null) {
    return title;
  }
  return chartDefault.includes('\n')
    ? `${title}\nChart default:\n${chartDefault}`
    : `${title}\nChart default: ${chartDefault}`;
};

class OverrideMarker extends GutterMarker {
  readonly kind: HelmValuesOverrideKind;
  readonly label: string;

  constructor(kind: HelmValuesOverrideKind, label: string) {
    super();
    this.kind = kind;
    this.label = label;
  }

  eq(other: GutterMarker) {
    return (
      other instanceof OverrideMarker && other.kind === this.kind && other.label === this.label
    );
  }

  toDOM() {
    const marker = document.createElement('div');
    marker.className = `helm-values-override-marker helm-values-override-marker--${this.kind}`;
    marker.textContent = OVERRIDE_SYMBOLS[this.kind];
    marker.title = this.label;
    return marker;
  }
}

class RemovedKeyWidget extends WidgetType {
  readonly removed: HelmValuesRemovedKey;

  constructor(removed: HelmValuesRemovedKey) {
    super();
    this.removed = removed;
  }

  eq(other: RemovedKeyWidget) {
    return other.removed === this.removed;
  }

  toDOM() {
    const { path } = this.removed;
    const row = document.createElement('div');
    row.className = 'helm-values-removed-key';
    row.title = plainText(describeRemoved(this.removed));
    const name = document.createElement('span');
    name.className = 'helm-values-removed-key__name';
    name.textContent = `${path[path.length - 1]}:`;
    row.append('  '.repeat(path.length - 1), name, ' removed by override');
    return row;
  }
}

const tooltipContent = ({ title, chartDefault }: OverrideDescription) => {
  const dom = document.createElement('div');
  dom.className = 'helm-values-override-tooltip';
  const heading = document.createElement('div');
  heading.className = 'helm-values-override-tooltip__title';
  heading.textContent = title;
  dom.append(heading);
  if (chartDefault !== null) {
    const label = document.createElement('div');
    label.className = 'helm-values-override-tooltip__label';
    label.textContent = 'Chart default';
    const value = document.createElement('pre');
    value.className = 'helm-values-override-tooltip__value';
    value.textContent = chartDefault;
    dom.append(label, value);
  }
  return dom;
};

// Marks were computed for one rendering of the values; skip any that fall
// outside the current document until the caller supplies fresh marks. Each
// labeled key takes its marker's color; removed keys become widget rows.
const overrideDecorations = (marks: HelmValuesOverrideMarks, state: EditorState): DecorationSet => {
  const labels = [...new Set(marks.lines.values())].flatMap(({ kind, labels: keys }) =>
    keys
      .filter(({ from, to }) => from < to && to <= state.doc.length)
      .map(({ from, to }) =>
        Decoration.mark({
          class: `helm-values-override-label helm-values-override-label--${kind}`,
        }).range(from, to)
      )
  );
  const rows = marks.removed
    .filter((removed) => removed.line <= state.doc.lines)
    .map((removed) => {
      const line = state.doc.line(removed.line);
      const before = removed.side === 'before';
      return Decoration.widget({
        widget: new RemovedKeyWidget(removed),
        block: true,
        side: before ? -1 : 1,
      }).range(before ? line.from : line.to);
    });
  return Decoration.set([...labels, ...rows], true);
};

const markAt = (marks: HelmValuesOverrideMarks, state: EditorState, pos: number) =>
  marks.lines.get(state.doc.lineAt(pos).number) ?? null;

/** Hover source: a marked line's tooltip names the chart default it replaced. */
export const helmValuesOverrideTooltip =
  (marks: HelmValuesOverrideMarks) =>
  (view: EditorView, pos: number): Tooltip | null => {
    const mark = markAt(marks, view.state, pos);
    if (!mark) {
      return null;
    }
    const line = view.state.doc.lineAt(pos);
    return {
      pos: line.from,
      end: line.to,
      above: true,
      create: () => ({ dom: tooltipContent(describeOverride(mark)) }),
    };
  };

/** CodeMirror extension that renders `marks` for the document they describe. */
export function helmValuesOverrideGutter(marks: HelmValuesOverrideMarks): Extension {
  const markers = new Map<HelmValuesOverride, OverrideMarker>();
  const markerFor = (mark: HelmValuesOverride) => {
    let marker = markers.get(mark);
    if (!marker) {
      marker = new OverrideMarker(mark.kind, plainText(describeOverride(mark)));
      markers.set(mark, marker);
    }
    return marker;
  };
  const decorations = StateField.define<DecorationSet>({
    create: (state) => overrideDecorations(marks, state),
    update: (value, transaction) =>
      transaction.docChanged ? overrideDecorations(marks, transaction.state) : value,
    provide: (field) => EditorView.decorations.from(field),
  });

  return [
    decorations,
    gutter({
      class: 'helm-values-override-gutter',
      lineMarker: (view, block) => {
        const mark = markAt(marks, view.state, block.from);
        return mark ? markerFor(mark) : null;
      },
      widgetMarker: (_view, widget) =>
        widget instanceof RemovedKeyWidget
          ? new OverrideMarker('removed', plainText(describeRemoved(widget.removed)))
          : null,
      lineMarkerChange: (update) => update.docChanged,
    }),
    hoverTooltip(helmValuesOverrideTooltip(marks)),
  ];
}
