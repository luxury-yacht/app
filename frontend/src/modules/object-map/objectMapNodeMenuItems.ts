import type { ContextMenuItem } from '@shared/components/ContextMenu';
import { objectMapNodeLabel } from './ObjectMapObjectControls';
import type { ObjectMapLayout, PositionedNode } from './objectMapLayout';
import type { ObjectMapNodeBadge } from './objectMapRendererTypes';

export function objectMapNodeMenuItems({
  layout,
  node,
  badge,
  onSelect,
  onToggleGroup,
  onMove,
}: {
  layout: ObjectMapLayout;
  node: PositionedNode;
  badge: ObjectMapNodeBadge | null;
  onSelect: (id: string) => void;
  onToggleGroup: (id: string) => void;
  onMove: (id: string, dx: number, dy: number) => void;
}): ContextMenuItem[] {
  const items: ContextMenuItem[] = [];
  if (badge) {
    items.push({
      label: badge.expanded ? 'Collapse older ReplicaSets' : 'Expand older ReplicaSets',
      onClick: () => onToggleGroup(badge.deploymentId),
    });
  }
  const directions = [
    { name: 'left', dx: -24, dy: 0 },
    { name: 'right', dx: 24, dy: 0 },
    { name: 'up', dx: 0, dy: -24 },
    { name: 'down', dx: 0, dy: 24 },
  ];
  items.push(
    ...directions.map(({ name, dx, dy }) => ({
      label: `Move object ${name}`,
      onClick: () => onMove(node.id, dx, dy),
    }))
  );
  const nodes = new Map(layout.nodes.map((item) => [item.id, item]));
  const connections = layout.edges.filter(
    (edge) => edge.sourceId === node.id || edge.targetId === node.id
  );
  for (const edge of connections) {
    const source = nodes.get(edge.sourceId);
    const target = nodes.get(edge.targetId);
    if (!source || !target) {
      continue;
    }
    const other = source.id === node.id ? target : source;
    items.push({
      label: `${objectMapNodeLabel(source)} — ${edge.label} → ${objectMapNodeLabel(target)}`,
      onClick: () => onSelect(other.id),
    });
  }
  return items;
}
