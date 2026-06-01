import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';

import ConfirmationModal from '@shared/components/modals/ConfirmationModal';
import type { IconBarItem } from '@shared/components/IconBar/IconBar';
import { DeleteIcon } from '@shared/components/icons/SharedIcons';
import { RunCatalogQueryBulkAction } from '@wailsjs/go/backend/App';
import type { QueryBulkActionFailure } from '@core/refresh/types';
import {
  backendSelectionFromCatalogSelection,
  type CatalogQuerySelectionDescriptor,
} from '@modules/browse/querySelection';

const BULK_DELETE_FEEDBACK_RESET_MS = 750;
const BULK_DELETE_PAGE_LIMIT = 100;
const BULK_DELETE_FAILURE_PREVIEW_LIMIT = 5;

interface UseCatalogQueryBulkDeleteActionOptions {
  query: CatalogQuerySelectionDescriptor;
  totalCount: number;
  totalIsExact: boolean;
  pending?: boolean;
  disableWhenUnscoped?: boolean;
  onComplete?: () => void;
}

interface BulkDeleteSummary {
  processed: number;
  succeeded: number;
  failed: number;
  failures: QueryBulkActionFailure[];
}

const formatFailureRef = (failure: QueryBulkActionFailure): string => {
  const ref = failure.ref;
  const namespace = ref.namespace ? `${ref.namespace}/` : '';
  return `${ref.kind} ${namespace}${ref.name}`;
};

const formatBulkDeleteFailureDetails = (failures: QueryBulkActionFailure[]): string => {
  if (failures.length === 0) {
    return '';
  }
  const visible = failures.slice(0, BULK_DELETE_FAILURE_PREVIEW_LIMIT);
  const lines = visible.map((failure) => `${formatFailureRef(failure)}: ${failure.message}`);
  const remaining = failures.length - visible.length;
  if (remaining > 0) {
    lines.push(`${remaining} more failure${remaining === 1 ? '' : 's'} not shown.`);
  }
  return lines.join('\n');
};

export function useCatalogQueryBulkDeleteAction({
  query,
  totalCount,
  totalIsExact,
  pending = false,
  disableWhenUnscoped = false,
  onComplete,
}: UseCatalogQueryBulkDeleteActionOptions): { action: IconBarItem; modal: React.ReactNode } {
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState<BulkDeleteSummary | null>(null);
  const [running, setRunning] = useState(false);
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
    running ||
    totalCount === 0 ||
    (disableWhenUnscoped && !query.hasUserNamespaceScope);

  const handleConfirm = useCallback(async () => {
    if (
      !query.clusterId ||
      pending ||
      running ||
      totalCount === 0 ||
      (disableWhenUnscoped && !query.hasUserNamespaceScope)
    ) {
      setOpen(false);
      setFeedback('error');
      scheduleReset();
      return;
    }
    try {
      let continueToken: string | undefined;
      const nextSummary: BulkDeleteSummary = {
        processed: 0,
        succeeded: 0,
        failed: 0,
        failures: [],
      };
      setRunning(true);
      do {
        const result = await RunCatalogQueryBulkAction({
          selection: backendSelectionFromCatalogSelection(query),
          action: 'delete',
          confirmed: true,
          limit: BULK_DELETE_PAGE_LIMIT,
          continue: continueToken,
        });
        nextSummary.processed += result?.processed ?? 0;
        nextSummary.succeeded += result?.succeeded ?? 0;
        nextSummary.failed += result?.failed ?? 0;
        if (Array.isArray(result?.failures)) {
          nextSummary.failures.push(...result.failures);
        }
        continueToken = result?.continue || undefined;
      } while (continueToken);
      setSummary(nextSummary);
      setFeedback(nextSummary.failed > 0 ? 'error' : 'success');
      onComplete?.();
    } catch (error) {
      console.error('Failed to delete all matching Browse rows', error);
      setFeedback('error');
    } finally {
      setRunning(false);
      setOpen(false);
      scheduleReset();
    }
  }, [disableWhenUnscoped, onComplete, pending, query, running, scheduleReset, totalCount]);

  const action = useMemo<IconBarItem>(
    () => ({
      type: 'action',
      id: 'delete-browse-query',
      icon: <DeleteIcon width={18} height={18} />,
      onClick: () => setOpen(true),
      title: running ? 'Deleting matching rows' : 'Delete all matching rows',
      ariaLabel: running ? 'Deleting matching rows' : 'Delete all matching rows',
      disabled,
      feedback,
    }),
    [disabled, feedback, running]
  );

  const modal = (
    <>
      <ConfirmationModal
        isOpen={open}
        title="Delete all matching rows"
        message={`Delete ${totalIsExact ? totalCount : `about ${totalCount}`} matching objects from this Browse query?`}
        warning="This runs against the backend query, not only the visible page."
        confirmText={running ? 'Deleting...' : 'Delete'}
        cancelText="Cancel"
        confirmButtonClass="danger"
        onConfirm={() => {
          if (!running) {
            void handleConfirm();
          }
        }}
        onCancel={() => {
          if (!running) {
            setOpen(false);
          }
        }}
      />
      <ConfirmationModal
        isOpen={summary !== null}
        title={summary?.failed ? 'Delete completed with failures' : 'Delete completed'}
        message={
          summary
            ? `Processed ${summary.processed} matching objects. Deleted ${summary.succeeded}. Failed ${summary.failed}.`
            : ''
        }
        warning={summary ? formatBulkDeleteFailureDetails(summary.failures) : undefined}
        confirmText="Close"
        cancelText="Close"
        confirmButtonClass={summary?.failed ? 'danger' : 'save'}
        onConfirm={() => setSummary(null)}
        onCancel={() => setSummary(null)}
      />
    </>
  );

  return { action, modal };
}
