/**
 * Unified labels + selectors editor.
 *
 * Renders two visual groups — "Selectors" and "Labels" — inside a single
 * Labels field. Selectors are promoted labels: they also participate in
 * spec.selector.matchLabels (and any mirror paths like the pod template
 * labels). All entries — whether marked as selector or not — live in
 * metadata.labels.
 *
 * Drag a row between the two groups to promote/demote it. Inside each
 * group, rows are the same labeled key/value layout used for annotations
 * and plain labels.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormFieldDefinition } from './formDefinitions';
import { FormKeyValueListField } from './FormKeyValueListField';
import { arePersistedMapsEqual, toPersistedMap, toStringMap } from './formUtils';
import { getFieldValue, setFieldValue } from './yamlSync';

type LabelEntry = { key: string; value: string; isSelector: boolean };

// Payload written to dataTransfer so only our own drags are treated as moves.
const DRAG_MIME = 'application/x-luxury-yacht-label-drag';
type DragPayload = { kind: 'selectors' | 'labels'; index: number };

interface FormLabelsFieldProps {
  field: FormFieldDefinition;
  yamlContent: string;
  onYamlChange: (yaml: string) => void;
}

/**
 * Build the draft entries array by merging metadata.labels and the
 * selector map (at selectorPaths[0]). Keys that appear in the selector
 * map are promoted to isSelector=true; their values always come from
 * metadata.labels when present (metadata.labels is authoritative).
 */
function buildEntries(
  labelsMap: Record<string, string>,
  selectorMap: Record<string, string>
): LabelEntry[] {
  const entries: LabelEntry[] = [];
  const seen = new Set<string>();
  for (const [key, value] of Object.entries(labelsMap)) {
    entries.push({ key, value, isSelector: key in selectorMap });
    seen.add(key);
  }
  for (const [key, value] of Object.entries(selectorMap)) {
    if (seen.has(key)) continue;
    entries.push({ key, value, isSelector: true });
  }
  return entries;
}

export function FormLabelsField({
  field,
  yamlContent,
  onYamlChange,
}: FormLabelsFieldProps): React.ReactElement {
  // Stabilize the selectorPaths reference so downstream memos/effects
  // don't re-run every render when the caller inlines the array.
  const selectorPaths = useMemo<string[][]>(() => field.selectorPaths ?? [], [field.selectorPaths]);
  const primarySelectorPath = selectorPaths[0];
  const labelsPath = field.path;

  // Authoritative maps from YAML.
  const entriesFromYaml = useMemo(() => {
    const labelsMap = toStringMap(getFieldValue(yamlContent, labelsPath));
    const selectorMap = primarySelectorPath
      ? toStringMap(getFieldValue(yamlContent, primarySelectorPath))
      : {};
    return buildEntries(labelsMap, selectorMap);
  }, [yamlContent, labelsPath, primarySelectorPath]);

  const syncKey = useMemo(
    () => [labelsPath.join('.'), ...selectorPaths.map((p) => p.join('.'))].join('|'),
    [labelsPath, selectorPaths]
  );
  const [draft, setDraft] = useState<LabelEntry[]>(entriesFromYaml);
  const lastSyncRef = useRef(`${syncKey}|${yamlContent}`);

  // Resync when upstream YAML changes (not from our own writes).
  useEffect(() => {
    const key = `${syncKey}|${yamlContent}`;
    if (key === lastSyncRef.current) return;
    lastSyncRef.current = key;
    setDraft((prev) => {
      const prevTuples = prev.map((e) => [e.key, e.value] as [string, string]);
      const nextTuples = entriesFromYaml.map((e) => [e.key, e.value] as [string, string]);
      const prevSelTuples = prev
        .filter((e) => e.isSelector)
        .map((e) => [e.key, e.value] as [string, string]);
      const nextSelTuples = entriesFromYaml
        .filter((e) => e.isSelector)
        .map((e) => [e.key, e.value] as [string, string]);
      if (
        arePersistedMapsEqual(prevTuples, nextTuples) &&
        arePersistedMapsEqual(prevSelTuples, nextSelTuples)
      ) {
        return prev;
      }
      return entriesFromYaml;
    });
  }, [entriesFromYaml, syncKey, yamlContent]);

  /** Persist the draft to YAML. */
  const persist = useCallback(
    (nextDraft: LabelEntry[]) => {
      setDraft(nextDraft);
      const labelsMap = toPersistedMap(nextDraft.map((e) => [e.key, e.value] as [string, string]));
      const selectorMap = toPersistedMap(
        nextDraft.filter((e) => e.isSelector).map((e) => [e.key, e.value] as [string, string])
      );
      let nextYaml = yamlContent;
      const labelsUpdated = setFieldValue(nextYaml, labelsPath, labelsMap);
      if (labelsUpdated !== null) nextYaml = labelsUpdated;
      for (const selPath of selectorPaths) {
        const updated = setFieldValue(nextYaml, selPath, selectorMap);
        if (updated !== null) nextYaml = updated;
      }
      onYamlChange(nextYaml);
      lastSyncRef.current = `${syncKey}|${nextYaml}`;
    },
    [yamlContent, labelsPath, selectorPaths, onYamlChange, syncKey]
  );

  // Partition draft into the two groups, remembering each entry's
  // original draft index so edits map back correctly.
  const selectorRows: Array<{ entry: LabelEntry; draftIndex: number }> = [];
  const labelRows: Array<{ entry: LabelEntry; draftIndex: number }> = [];
  draft.forEach((entry, draftIndex) => {
    const target = entry.isSelector ? selectorRows : labelRows;
    target.push({ entry, draftIndex });
  });

  const updateAt = (draftIndex: number, next: LabelEntry) => {
    const nextDraft = draft.map((e, i) => (i === draftIndex ? next : e));
    persist(nextDraft);
  };

  const removeAt = (draftIndex: number) => {
    persist(draft.filter((_, i) => i !== draftIndex));
  };

  const addRow = (isSelector: boolean) => {
    persist([...draft, { key: '', value: '', isSelector }]);
  };

  /** Move a row between groups (toggle isSelector). */
  const moveRow = (from: 'selectors' | 'labels', groupIndex: number) => {
    const rows = from === 'selectors' ? selectorRows : labelRows;
    const row = rows[groupIndex];
    if (!row) return;
    const nextDraft = draft.map((e, i) =>
      i === row.draftIndex ? { ...e, isSelector: !e.isSelector } : e
    );
    persist(nextDraft);
  };

  // ── Drag handlers ────────────────────────────────────────────────────
  const [dropTarget, setDropTarget] = useState<'selectors' | 'labels' | null>(null);

  const onDragStart = (payload: DragPayload) => (event: React.DragEvent) => {
    event.dataTransfer.setData(DRAG_MIME, JSON.stringify(payload));
    event.dataTransfer.effectAllowed = 'move';
  };
  const onDragEnd = () => setDropTarget(null);

  const onDragOver = (zone: 'selectors' | 'labels') => (event: React.DragEvent) => {
    if (!event.dataTransfer.types.includes(DRAG_MIME)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    if (dropTarget !== zone) setDropTarget(zone);
  };
  const onDragLeave = (zone: 'selectors' | 'labels') => () => {
    if (dropTarget === zone) setDropTarget(null);
  };
  const onDrop = (zone: 'selectors' | 'labels') => (event: React.DragEvent) => {
    const raw = event.dataTransfer.getData(DRAG_MIME);
    setDropTarget(null);
    if (!raw) return;
    event.preventDefault();
    let payload: DragPayload;
    try {
      payload = JSON.parse(raw);
    } catch {
      return;
    }
    // No-op if dropped back onto the same group.
    if (payload.kind === zone) return;
    moveRow(payload.kind, payload.index);
  };

  return (
    <div data-field-key={field.key} className="resource-form-labels-field">
      <LabelsGroup
        dataFieldKey={`${field.key}-plain`}
        rows={labelRows}
        addLabel="Add Label"
        removeLabel="Remove Label"
        addGhostText="Add label"
        onAdd={() => addRow(false)}
        onKeyChange={(groupIndex, newKey) => {
          const draftIndex = labelRows[groupIndex]?.draftIndex;
          if (draftIndex === undefined) return;
          updateAt(draftIndex, { ...draft[draftIndex], key: newKey });
        }}
        onValueChange={(groupIndex, newValue) => {
          const draftIndex = labelRows[groupIndex]?.draftIndex;
          if (draftIndex === undefined) return;
          updateAt(draftIndex, { ...draft[draftIndex], value: newValue });
        }}
        onRemove={(groupIndex) => {
          const draftIndex = labelRows[groupIndex]?.draftIndex;
          if (draftIndex === undefined) return;
          removeAt(draftIndex);
        }}
        draggingTo={dropTarget === 'labels'}
        onGroupDragOver={onDragOver('labels')}
        onGroupDragLeave={onDragLeave('labels')}
        onGroupDrop={onDrop('labels')}
        rowDragProps={(groupIndex) => ({
          draggable: true,
          onDragStart: onDragStart({ kind: 'labels', index: groupIndex }),
          onDragEnd,
        })}
      />
      <LabelsGroup
        title="Selectors (drag labels in or out)"
        dataFieldKey={`${field.key}-selectors`}
        rows={selectorRows}
        addLabel="Add Selector"
        removeLabel="Remove Selector"
        addGhostText="Add selector"
        onAdd={() => addRow(true)}
        onKeyChange={(groupIndex, newKey) => {
          const draftIndex = selectorRows[groupIndex]?.draftIndex;
          if (draftIndex === undefined) return;
          updateAt(draftIndex, { ...draft[draftIndex], key: newKey });
        }}
        onValueChange={(groupIndex, newValue) => {
          const draftIndex = selectorRows[groupIndex]?.draftIndex;
          if (draftIndex === undefined) return;
          updateAt(draftIndex, { ...draft[draftIndex], value: newValue });
        }}
        onRemove={(groupIndex) => {
          const draftIndex = selectorRows[groupIndex]?.draftIndex;
          if (draftIndex === undefined) return;
          removeAt(draftIndex);
        }}
        draggingTo={dropTarget === 'selectors'}
        onGroupDragOver={onDragOver('selectors')}
        onGroupDragLeave={onDragLeave('selectors')}
        onGroupDrop={onDrop('selectors')}
        rowDragProps={(groupIndex) => ({
          draggable: true,
          onDragStart: onDragStart({ kind: 'selectors', index: groupIndex }),
          onDragEnd,
        })}
      />
    </div>
  );
}

// ─── Group sub-component ────────────────────────────────────────────────

interface LabelsGroupProps {
  /** Group subheader; omit to render the group with no header row. */
  title?: string;
  dataFieldKey: string;
  rows: Array<{ entry: LabelEntry; draftIndex: number }>;
  addLabel: string;
  removeLabel: string;
  addGhostText: string;
  onAdd: () => void;
  onKeyChange: (groupIndex: number, newKey: string) => void;
  onValueChange: (groupIndex: number, newValue: string) => void;
  onRemove: (groupIndex: number) => void;
  draggingTo: boolean;
  onGroupDragOver: (event: React.DragEvent) => void;
  onGroupDragLeave: (event: React.DragEvent) => void;
  onGroupDrop: (event: React.DragEvent) => void;
  rowDragProps: (groupIndex: number) => {
    draggable: true;
    onDragStart: (event: React.DragEvent) => void;
    onDragEnd: () => void;
  };
}

function LabelsGroup({
  title,
  dataFieldKey,
  rows,
  addLabel,
  removeLabel,
  addGhostText,
  onAdd,
  onKeyChange,
  onValueChange,
  onRemove,
  draggingTo,
  onGroupDragOver,
  onGroupDragLeave,
  onGroupDrop,
  rowDragProps,
}: LabelsGroupProps): React.ReactElement {
  return (
    <div
      className={`resource-form-labels-group${draggingTo ? ' resource-form-labels-group--drag-over' : ''}`}
      onDragOver={onGroupDragOver}
      onDragLeave={onGroupDragLeave}
      onDrop={onGroupDrop}
      data-group={dataFieldKey}
    >
      {title ? <div className="resource-form-labels-group-title">{title}</div> : null}
      <RowDragWrapper rowDragProps={rowDragProps} count={rows.length}>
        <FormKeyValueListField
          dataFieldKey={dataFieldKey}
          entries={rows.map(({ entry }) => [entry.key, entry.value] as [string, string])}
          onKeyChange={onKeyChange}
          onValueChange={onValueChange}
          onRemove={onRemove}
          onAdd={onAdd}
          addButtonLabel={addLabel}
          removeButtonLabel={removeLabel}
          showInlineKeyValueLabels
          leftAlignEmptyStateActions
          addGhostText={addGhostText}
        />
      </RowDragWrapper>
    </div>
  );
}

/**
 * After FormKeyValueListField renders, attach `draggable`/`onDragStart` to
 * each rendered row. We do this via a ref + effect rather than forking the
 * shared component to keep the change minimal and local.
 */
function RowDragWrapper({
  rowDragProps,
  count,
  children,
}: {
  rowDragProps: (groupIndex: number) => {
    draggable: true;
    onDragStart: (event: React.DragEvent) => void;
    onDragEnd: () => void;
  };
  count: number;
  children: React.ReactNode;
}): React.ReactElement {
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const rowEls = wrapper.querySelectorAll<HTMLDivElement>('.resource-form-kv-row--labeled');
    // Attach to the first N actual rendered rows (empty state has no rows).
    const handlers: Array<{
      el: HTMLDivElement;
      dragStart: (e: DragEvent) => void;
      dragEnd: () => void;
    }> = [];
    rowEls.forEach((rowEl, i) => {
      if (i >= count) return;
      const props = rowDragProps(i);
      rowEl.setAttribute('draggable', 'true');
      rowEl.classList.add('resource-form-labels-row--draggable');
      const dragStart = (e: DragEvent) => props.onDragStart(e as unknown as React.DragEvent);
      const dragEnd = () => props.onDragEnd();
      rowEl.addEventListener('dragstart', dragStart);
      rowEl.addEventListener('dragend', dragEnd);
      handlers.push({ el: rowEl, dragStart, dragEnd });
    });
    return () => {
      for (const h of handlers) {
        h.el.removeAttribute('draggable');
        h.el.classList.remove('resource-form-labels-row--draggable');
        h.el.removeEventListener('dragstart', h.dragStart);
        h.el.removeEventListener('dragend', h.dragEnd);
      }
    };
  }, [rowDragProps, count]);

  return <div ref={wrapperRef}>{children}</div>;
}
