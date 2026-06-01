import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';

import ConfirmationModal from '@shared/components/modals/ConfirmationModal';
import type { IconBarItem } from '@shared/components/IconBar/IconBar';
import { DeleteIcon } from '@shared/components/icons/SharedIcons';
import { RunCatalogQueryBulkAction } from '@wailsjs/go/backend/App';
import {
  backendSelectionFromCatalogSelection,
  type CatalogQuerySelectionDescriptor,
} from '@modules/browse/querySelection';

const BULK_DELETE_FEEDBACK_RESET_MS = 750;
const BULK_DELETE_PAGE_LIMIT = 100;

interface UseCatalogQueryBulkDeleteActionOptions {
  query: CatalogQuerySelectionDescriptor;
  totalCount: number;
  totalIsExact: boolean;
  pending?: boolean;
  disableWhenUnscoped?: boolean;
  onComplete?: () => void;
}

export function useCatalogQueryBulkDeleteAction({
  query,
  totalCount,
  totalIsExact,
  pending = false,
  disableWhenUnscoped = false,
  onComplete,
}: UseCatalogQueryBulkDeleteActionOptions): { action: IconBarItem; modal: React.ReactNode } {
  const [open, setOpen] = useState(false);
  const [feedback, setFeedback] = useState<'success' | 'error' | null>(null);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleReset = useCallback(() => {
    if (resetTimerRef.current) {
      clearTimeout(resetTimerRef.current);
    }
    resetTimerRef.current = setTimeout(() => {
      setFeedback(null);
    }, BULK_DELETE_FEEDBACK_RESET_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (resetTimerRef.current) {
        clearTimeout(resetTimerRef.current);
      }
    };
  }, []);

  const disabled =
    !query.clusterId ||
    pending ||
    totalCount === 0 ||
    (disableWhenUnscoped && !query.hasUserNamespaceScope);

  const handleConfirm = useCallback(async () => {
    if (!query.clusterId) {
      setOpen(false);
      setFeedback('error');
      scheduleReset();
      return;
    }
    try {
      let continueToken: string | undefined;
      let failed = 0;
      do {
        const result = await RunCatalogQueryBulkAction({
          selection: backendSelectionFromCatalogSelection(query),
          action: 'delete',
          confirmed: true,
          limit: BULK_DELETE_PAGE_LIMIT,
          continue: continueToken,
        });
        failed += result?.failed ?? 0;
        continueToken = result?.continue || undefined;
      } while (continueToken);
      setFeedback(failed > 0 ? 'error' : 'success');
      onComplete?.();
    } catch (error) {
      console.error('Failed to delete all matching Browse rows', error);
      setFeedback('error');
    } finally {
      setOpen(false);
      scheduleReset();
    }
  }, [onComplete, query, scheduleReset]);

  const action = useMemo<IconBarItem>(
    () => ({
      type: 'action',
      id: 'delete-browse-query',
      icon: <DeleteIcon width={18} height={18} />,
      onClick: () => setOpen(true),
      title: 'Delete all matching rows',
      ariaLabel: 'Delete all matching rows',
      disabled,
      feedback,
    }),
    [disabled, feedback]
  );

  const modal = (
    <ConfirmationModal
      isOpen={open}
      title="Delete all matching rows"
      message={`Delete ${totalIsExact ? totalCount : `about ${totalCount}`} matching objects from this Browse query?`}
      warning="This runs against the backend query, not only the visible page."
      confirmText="Delete"
      cancelText="Cancel"
      confirmButtonClass="danger"
      onConfirm={() => {
        void handleConfirm();
      }}
      onCancel={() => setOpen(false)}
    />
  );

  return { action, modal };
}
