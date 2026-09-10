import type { ObjectMapReference } from '@core/refresh/types';
import { Dropdown } from '@shared/components/dropdowns/Dropdown';
import type { PositionedNode } from './objectMapLayout';

export const objectMapNodeLabel = (node: PositionedNode): string =>
  `${node.ref.kind} ${node.ref.name}${node.ref.namespace ? ` (${node.ref.namespace})` : ''}`;

export function ObjectMapObjectControls({
  nodes,
  activeId,
  onSelect,
  onActions,
}: {
  nodes: PositionedNode[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onActions: (request: { ref: ObjectMapReference; position: { x: number; y: number } }) => void;
}) {
  const selected = nodes.find((node) => node.id === activeId);
  return (
    <div className="object-map__object-controls">
      <Dropdown
        ariaLabel="Choose map object"
        placeholder="Choose object"
        searchable
        size="compact"
        value={selected?.id ?? ''}
        disabled={nodes.length === 0}
        options={nodes.map((node) => ({ value: node.id, label: objectMapNodeLabel(node) }))}
        onChange={(value) => {
          if (typeof value === 'string') {
            onSelect(value);
          }
        }}
      />
      <button
        type="button"
        className="object-map__object-actions"
        aria-label="Selected object actions"
        aria-haspopup="menu"
        disabled={!selected}
        onClick={(event) => {
          if (!selected) {
            return;
          }
          const rect = event.currentTarget.getBoundingClientRect();
          onActions({ ref: selected.ref, position: { x: rect.left, y: rect.bottom } });
        }}
      >
        Object actions
      </button>
    </div>
  );
}
