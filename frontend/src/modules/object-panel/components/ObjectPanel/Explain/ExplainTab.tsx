/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Explain/ExplainTab.tsx
 *
 * `kubectl explain` for a kind: the kind's schema as a collapsible field tree,
 * with the selected field's type and description below it. Shown by the kind
 * panel and, for a CustomResourceDefinition, for the kind it defines.
 */

import type { apiresources } from '@core/backend-api/models';
import ClusterDataPausedState from '@shared/components/ClusterDataPausedState';
import { ErrorSurface } from '@shared/components/errors/ErrorSurface';
import LoadingSpinner from '@shared/components/LoadingSpinner';
import { type ReactNode, useCallback, useState } from 'react';
import type { KindReadTarget } from '@/core/data-access';
import { type FieldExplanationState, fieldKey, KIND_PATH, useKindExplain } from './useKindExplain';
import './ExplainTab.css';

interface ExplainTabProps {
  /** The kind to explain. */
  kind: KindReadTarget;
  isActive?: boolean;
}

// Fields are identified by their path segments (see fieldKey): `expanded` and
// `selectedKey` hold field keys, never dotted strings. The kind is the empty path.
interface FieldTreeState {
  expanded: ReadonlySet<string>;
  selectedKey: string;
  onSelect: (path: readonly string[], toggles: boolean) => void;
}

interface FieldTreeProps extends FieldTreeState {
  fields: apiresources.SchemaField[];
  parentPath: readonly string[];
}

// The caret of a row that opens and closes; any other row has none.
const caretFor = (toggles: boolean, open: boolean) => {
  if (!toggles) {
    return '';
  }
  return open ? '▾' : '▸';
};

/** The selectable row of the kind or one of its fields. */
function TreeRowButton({
  path,
  toggles,
  open,
  selectedKey,
  onSelect,
  children,
}: Readonly<
  Omit<FieldTreeState, 'expanded'> & {
    path: readonly string[];
    toggles: boolean;
    open: boolean;
    children: ReactNode;
  }
>) {
  const key = fieldKey(path);
  return (
    <button
      type="button"
      className="explain-tree-row"
      data-explain-path={key}
      aria-current={selectedKey === key ? 'true' : undefined}
      aria-expanded={toggles ? open : undefined}
      onClick={() => onSelect(path, toggles)}
    >
      <span className="explain-tree-caret" aria-hidden="true">
        {caretFor(toggles, open)}
      </span>
      {children}
    </button>
  );
}

/** One field's row and, while it is open, the fields nested under it. */
function FieldRow({
  field,
  path,
  ...tree
}: Readonly<FieldTreeState & { field: apiresources.SchemaField; path: readonly string[] }>) {
  const children = field.fields ?? [];
  const hasChildren = children.length > 0;
  const open = hasChildren && tree.expanded.has(fieldKey(path));
  return (
    <li>
      <TreeRowButton {...tree} path={path} toggles={hasChildren} open={open}>
        <span>{field.name}</span>
        <span className="explain-type">{`<${field.type}>`}</span>
        {field.required ? <span className="explain-required">required</span> : null}
      </TreeRowButton>
      {open ? <FieldTree fields={children} parentPath={path} {...tree} /> : null}
    </li>
  );
}

function FieldTree({ fields, parentPath, ...tree }: Readonly<FieldTreeProps>) {
  return (
    <ul className="explain-tree-list">
      {fields.map((field) => {
        const path = [...parentPath, field.name];
        return <FieldRow key={fieldKey(path)} field={field} path={path} {...tree} />;
      })}
    </ul>
  );
}

function SelectedField({
  path,
  state,
}: Readonly<{ path: readonly string[]; state: FieldExplanationState | null }>) {
  let body: ReactNode = null;
  if (state?.status === 'error') {
    body = (
      <div className="error-message" role="alert">
        <ErrorSurface kind="reported" message={state.message} />
      </div>
    );
  } else if (state?.status === 'ready') {
    const { explanation } = state;
    body = (
      <>
        {explanation.enum?.length ? (
          <p className="explain-enum">
            <span className="explain-type">One of</span> {explanation.enum.join(', ')}
          </p>
        ) : null}
        <p className="explain-description">{explanation.description || 'No description.'}</p>
      </>
    );
  }
  return (
    <div className="explain-selected">
      <div className="explain-selected-path">
        <span>{path.join('.')}</span>
        {state?.status === 'ready' && state.explanation.type ? (
          <span className="explain-type">{`<${state.explanation.type}>`}</span>
        ) : null}
      </div>
      {body}
    </div>
  );
}

export default function ExplainTab({ kind, isActive = true }: Readonly<ExplainTabProps>) {
  const { schema, retrySchema, selectedPath, selectedExplanation, selectField } = useKindExplain(
    kind,
    isActive
  );
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const handleSelect = useCallback(
    (path: readonly string[], toggles: boolean) => {
      selectField(path);
      if (!toggles) {
        return;
      }
      const key = fieldKey(path);
      setExpanded((current) => {
        const next = new Set(current);
        if (next.has(key)) {
          next.delete(key);
        } else {
          next.add(key);
        }
        return next;
      });
    },
    [selectField]
  );

  if (schema.status === 'loading') {
    return (
      <div className="object-panel-tab-content">
        <LoadingSpinner message="Loading schema..." />
      </div>
    );
  }
  if (schema.status === 'paused') {
    return (
      <div className="object-panel-tab-content explain-notice">
        <ClusterDataPausedState />
      </div>
    );
  }
  if (schema.status === 'missing' || schema.status === 'error') {
    return (
      <div className="object-panel-tab-content explain-notice">
        {schema.status === 'error' ? (
          <div className="error-message" role="alert">
            Error loading schema: <ErrorSurface kind="reported" message={schema.message} />
          </div>
        ) : (
          <p>No schema is published for this kind.</p>
        )}
        <button type="button" className="button generic small" onClick={retrySchema}>
          Retry
        </button>
      </div>
    );
  }

  const { group, version, fields, description } = schema.schema;
  const apiVersion = group ? `${group}/${version}` : version;
  const selectedKey = fieldKey(selectedPath);
  return (
    <div className="object-panel-tab-content explain-tab">
      <div className="explain-toolbar">
        <p className="explain-api-version">
          API version <code>{apiVersion}</code>
        </p>
        <button type="button" className="button generic small" onClick={retrySchema}>
          Refresh schema
        </button>
      </div>
      <div className="explain-tree">
        <ul className="explain-tree-list">
          <li>
            {/* The kind's fields are always listed: closing it would empty the tree. */}
            <TreeRowButton
              path={KIND_PATH}
              toggles={false}
              open
              selectedKey={selectedKey}
              onSelect={handleSelect}
            >
              <span>{kind.kind}</span>
            </TreeRowButton>
            <FieldTree
              fields={fields ?? []}
              parentPath={KIND_PATH}
              expanded={expanded}
              selectedKey={selectedKey}
              onSelect={handleSelect}
            />
          </li>
        </ul>
      </div>
      {selectedPath.length === 0 ? (
        <p className="explain-description">{description}</p>
      ) : (
        <SelectedField path={selectedPath} state={selectedExplanation} />
      )}
    </div>
  );
}
