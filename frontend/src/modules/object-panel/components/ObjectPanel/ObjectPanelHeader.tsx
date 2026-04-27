/**
 * frontend/src/modules/object-panel/components/ObjectPanel/ObjectPanelHeader.tsx
 *
 * In-body toolbar showing the kind badge and object name.
 * Navigation arrows have been removed — tabs replace the navigation UX.
 */

import { getKindColorClass } from '@shared/utils/kindBadgeColors';

interface ObjectPanelHeaderProps {
  kind: string | null;
  kindAlias: string | null;
  name: string | null;
}

export function ObjectPanelHeader({ kind, kindAlias, name }: ObjectPanelHeaderProps) {
  const colorClass = getKindColorClass(kind);

  const displayKind = kindAlias || kind || 'Object';
  const kindTitle = kindAlias && kind && kindAlias !== kind ? kind : undefined;

  return (
    <div className="object-panel-header">
      <div className="object-panel-info">
        <span className={`kind-badge ${colorClass}`.trim()} title={kindTitle}>
          {displayKind}
        </span>
        <span className="object-name">{name}</span>
      </div>
    </div>
  );
}
