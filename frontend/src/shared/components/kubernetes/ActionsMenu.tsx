/**
 * frontend/src/shared/components/kubernetes/ActionsMenu.tsx
 *
 * Actions menu for the Object Panel. Renders a dropdown of the available
 * actions for the current object and delegates ALL execution, permission
 * gating, and modal handling to the shared object action controller — the
 * same path grid/map surfaces use. The panel supplies only object-panel
 * lifecycle callbacks (close after delete, refetch after a mutating action)
 * and the Node cordon/drain openers.
 */

import { useObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';
import ContextMenu from '@shared/components/ContextMenu';
import { useObjectActionController } from '@shared/hooks/useObjectActionController';
import type { ObjectActionData } from '@shared/hooks/useObjectActions';
import React, { useMemo, useState } from 'react';
import './ActionsMenu.css';

const clampReplicas = (value: number): number => Math.max(0, Math.min(9999, value));

const parseDesiredReplicas = (value?: string | null): number | null => {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  const segments = trimmed.split('/');
  const candidate = Number.parseInt(segments[segments.length - 1]?.trim() ?? '', 10);
  return Number.isFinite(candidate) ? clampReplicas(candidate) : null;
};

interface ActionsMenuProps {
  object: ObjectActionData | null;
  currentReplicas?: number;
  actionLoading?: boolean;
  // Whether a HorizontalPodAutoscaler manages this workload. Null means unknown.
  hpaManaged?: boolean | null;
  /** Called after a successful delete so the panel can close. */
  onAfterDelete?: () => void;
  /** Called after a successful restart/scale/trigger/suspend so the panel can refetch. */
  onAfterAction?: () => void;
  /** Node-only: open the cordon/drain modals owned by the caller. */
  onCordon?: () => void;
  onDrain?: () => void;
}

export const ActionsMenu = React.memo<ActionsMenuProps>(
  ({
    object,
    currentReplicas,
    actionLoading = false,
    hpaManaged = null,
    onAfterDelete,
    onAfterAction,
    onCordon,
    onDrain,
  }) => {
    const { openWithObject } = useObjectPanel();
    const [isOpen, setIsOpen] = useState(false);
    const [menuPosition, setMenuPosition] = useState({ x: 0, y: 0 });

    const resolvedCurrentReplicas = useMemo(() => {
      if (typeof currentReplicas === 'number' && Number.isFinite(currentReplicas)) {
        return clampReplicas(currentReplicas);
      }
      return parseDesiredReplicas(object?.ready) ?? 0;
    }, [currentReplicas, object?.ready]);

    // Merge the resolved replica count and HPA-ownership flag into the object
    // the controller reasons about. Unknown HPA ownership must stay unknown so
    // scale actions fail closed.
    const actionObject = useMemo(
      () =>
        object
          ? {
              ...object,
              desiredReplicas: resolvedCurrentReplicas,
              hpaManaged: hpaManaged ?? object.hpaManaged ?? null,
            }
          : null,
      [object, hpaManaged, resolvedCurrentReplicas]
    );

    const objectActions = useObjectActionController({
      context: 'object-panel',
      actionLoading,
      onAfterDelete: onAfterDelete ? () => onAfterDelete() : undefined,
      onAfterAction: onAfterAction ? () => onAfterAction() : undefined,
      onOpenObjectMap: (target) => {
        setIsOpen(false);
        openWithObject(target, { initialTab: 'map' });
      },
      perObjectHandlers: {
        onCordon: onCordon ? () => onCordon() : undefined,
        onDrain: onDrain ? () => onDrain() : undefined,
      },
    });

    // Menu items from the centralized controller (permission-gated; execution +
    // modals owned by the controller).
    const menuItems = useMemo(
      () => objectActions.getMenuItems(actionObject),
      [actionObject, objectActions]
    );

    // Don't render if no actions available
    if (menuItems.length === 0) {
      return null;
    }

    return (
      <>
        <div className="actions-menu">
          <button
            type="button"
            className="actions-menu-button"
            onClick={(event) => {
              if (isOpen) {
                setIsOpen(false);
                return;
              }

              const buttonRect = event.currentTarget.getBoundingClientRect();
              setMenuPosition({ x: buttonRect.left, y: buttonRect.bottom + 4 });
              setIsOpen(true);
            }}
            disabled={actionLoading}
            title="Actions"
            aria-label="Actions menu"
          >
            <span className="actions-menu-icon">⋯</span>
          </button>
        </div>

        {!!isOpen && (
          <ContextMenu items={menuItems} position={menuPosition} onClose={() => setIsOpen(false)} />
        )}

        {/* All action modals (confirm/scale/scale-to-zero/port-forward/rollback)
            are owned by the shared controller. */}
        {objectActions.modals}
      </>
    );
  }
);

ActionsMenu.displayName = 'ActionsMenu';
