/**
 * frontend/src/modules/object-panel/components/ObjectPanel/ObjectPanelHeader.tsx
 *
 * Module source for ObjectPanelHeader.
 */
interface ObjectPanelHeaderProps {
  navigationIndex: number;
  navigationCount: number;
  onNavigate: (index: number) => void;
  kind: string | null;
  kindAlias: string | null;
  name: string | null;
}

export function ObjectPanelHeader({
  navigationIndex,
  navigationCount,
  onNavigate,
  kind,
  kindAlias,
  name,
}: ObjectPanelHeaderProps) {
  const canNavigateBackward = navigationIndex > 0;
  const canNavigateForward = navigationIndex < navigationCount - 1;

  const sanitizedKindClass = (kind || '').toLowerCase().replace(/[^a-z0-9]/g, '');

  const displayKind = kindAlias || kind || 'Object';
  const kindTitle = kindAlias && kind && kindAlias !== kind ? kind : undefined;

  return (
    <div className="object-panel-header">
      <div className="object-panel-navigation">
        <button
          className="nav-button"
          type="button"
          disabled={!canNavigateBackward}
          onClick={() => {
            if (canNavigateBackward) {
              onNavigate(navigationIndex - 1);
            }
          }}
          title="Previous object (←)"
          data-object-panel-focusable="true"
          tabIndex={-1}
        >
          ←
        </button>
        <button
          className="nav-button"
          type="button"
          disabled={!canNavigateForward}
          onClick={() => {
            if (canNavigateForward) {
              onNavigate(navigationIndex + 1);
            }
          }}
          title="Next object (→)"
          data-object-panel-focusable="true"
          tabIndex={-1}
        >
          →
        </button>
      </div>
      <div className="object-panel-info">
        <span className={`kind-badge ${sanitizedKindClass}`} title={kindTitle}>
          {displayKind}
        </span>
        <span className="object-name">{name}</span>
      </div>
    </div>
  );
}
