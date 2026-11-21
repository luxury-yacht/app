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
import { type FieldExplanationState, useKindExplain } from './useKindExplain';
import './ExplainTab.css';

interface ExplainTabProps {
  /** The kind to explain. */
  kind: KindReadTarget;
  isActive?: boolean;
}

interface FieldTreeState {
  expanded: ReadonlySet<string>;
  selectedPath: string | null;
  onSelect: (path: string, hasChildren: boolean) => void;
}

interface FieldTreeProps extends FieldTreeState {
  fields: apiresources.SchemaField[];
  parentPath: string;
}

const fieldPath = (parentPath: string, name: string) =>
  parentPath ? `${parentPath}.${name}` : name;

// The caret of a field with nested fields; a leaf field has none.
const caretFor = (hasChildren: boolean, open: boolean) => {
  if (!hasChildren) {
    return '';
  }
  return open ? '▾' : '▸';
};

/** One field's row and, while it is open, the fields nested under it. */
function FieldRow({
  field,
  path,
  ...tree
}: Readonly<FieldTreeState & { field: apiresources.SchemaField; path: string }>) {
  const children = field.fields ?? [];
  const hasChildren = children.length > 0;
  const open = hasChildren && tree.expanded.has(path);
  return (
    <li>
      <button
        type="button"
        className="explain-tree-row"
        data-explain-field={path}
        aria-current={tree.selectedPath === path ? 'true' : undefined}
        aria-expanded={hasChildren ? open : undefined}
        onClick={() => tree.onSelect(path, hasChildren)}
      >
        <span className="explain-tree-caret" aria-hidden="true">
          {caretFor(hasChildren, open)}
        </span>
        <span>{field.name}</span>
        <span className="explain-type">{`<${field.type}>`}</span>
        {field.required ? <span className="explain-required">required</span> : null}
      </button>
      {open ? <FieldTree fields={children} parentPath={path} {...tree} /> : null}
    </li>
  );
}

function FieldTree({ fields, parentPath, ...tree }: Readonly<FieldTreeProps>) {
  return (
    <ul className="explain-tree-list">
      {fields.map((field) => {
        const path = fieldPath(parentPath, field.name);
        return <FieldRow key={path} field={field} path={path} {...tree} />;
      })}
    </ul>
  );
}

function SelectedField({
  path,
  state,
}: Readonly<{ path: string; state: FieldExplanationState | null }>) {
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
        <span>{path}</span>
        {state?.status === 'ready' && state.explanation.type ? (
          <span className="explain-type">{`<${state.explanation.type}>`}</span>
        ) : null}
      </div>
      {body}
    </div>
  );
}

export default function ExplainTab({ kind, isActive = true }: Readonly<ExplainTabProps>) {
  const { schema, selectedPath, selectedExplanation, selectField } = useKindExplain(kind, isActive);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const handleSelect = useCallback(
    (path: string, hasChildren: boolean) => {
      selectField(path);
      if (!hasChildren) {
        return;
      }
      setExpanded((current) => {
        const next = new Set(current);
        if (next.has(path)) {
          next.delete(path);
        } else {
          next.add(path);
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
  if (schema.status === 'missing') {
    return (
      <div className="object-panel-tab-content explain-notice">
        <p>No schema is published for this kind.</p>
      </div>
    );
  }
  if (schema.status === 'error') {
    return (
      <div className="object-panel-tab-content explain-notice">
        <div className="error-message" role="alert">
          Error loading schema: <ErrorSurface kind="reported" message={schema.message} />
        </div>
      </div>
    );
  }

  const fields = schema.schema.fields ?? [];
  return (
    <div className="object-panel-tab-content explain-tab">
      <div className="explain-tree">
        <FieldTree
          fields={fields}
          parentPath=""
          expanded={expanded}
          selectedPath={selectedPath}
          onSelect={handleSelect}
        />
      </div>
      {selectedPath === null ? (
        <p className="explain-description">{schema.schema.description}</p>
      ) : (
        <SelectedField path={selectedPath} state={selectedExplanation} />
      )}
    </div>
  );
}
