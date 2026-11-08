/**
 * frontend/src/shared/components/modals/RollbackModal.tsx
 *
 * Modal for viewing revision history and rolling back a workload or Helm release.
 * The current revision sits above the left side of a side-by-side diff and a
 * picker for the rollback target above the right side. The diff compares what
 * each revision applies (a workload's pod template, a release's manifest), with
 * history loaded from a full object ref.
 */

import type { backend } from '@core/backend-api/models';
import { buildObjectActionTarget, runObjectRollback } from '@shared/actions/objectActionClient';
import DiffViewer from '@shared/components/diff/DiffViewer';
import { ROLLBACK_DIFF_BUDGETS } from '@shared/components/diff/diffBudgets';
import {
  countVisibleDiffRows,
  type DisplayDiffLine,
  getDiffTooLargeMessage,
  mergeDiffLines,
} from '@shared/components/diff/diffUtils';
import { computeBudgetedLineDiff } from '@shared/components/diff/lineDiff';
import Dropdown from '@shared/components/dropdowns/Dropdown/Dropdown';
import type { DropdownOption } from '@shared/components/dropdowns/Dropdown/types';
import { normalizeDropdownValue } from '@shared/components/dropdowns/dropdownValue';
import { ErrorSurface } from '@shared/components/errors/ErrorSurface';
import { RollbackIcon } from '@shared/components/icons/SharedIcons';
import { errorHandler } from '@utils/errorHandler';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { readRevisionHistoryForRef, requestData } from '@/core/data-access';
import ConfirmationModal from './ConfirmationModal';
import ModalHeader from './ModalHeader';
import ModalSurface from './ModalSurface';
import { useModalFocusTrap } from './useModalFocusTrap';
import './RollbackModal.css';

interface RollbackModalProps {
  isOpen: boolean;
  onClose: () => void;
  clusterId: string;
  namespace: string;
  group: string;
  version: string;
  name: string;
  kind: string; // "Deployment" | "StatefulSet" | "DaemonSet" | "HelmRelease"
  onMutationChange?: (inFlight: boolean) => void;
}

const ROLLBACK_DIFF_TOO_LARGE_MESSAGE = 'This diff is too large to display in the current view.';

interface RollbackDiffState {
  lines: DisplayDiffLine[];
  leftText: string;
  rightText: string;
  tooLarge: boolean;
  tooLargeReason: 'input' | 'compute' | null;
  leftLineCount: number;
  rightLineCount: number;
}

/**
 * Format an ISO timestamp as a human-readable relative age string.
 */
const formatAge = (isoString: string): string => {
  const date = new Date(isoString);
  const diffMs = Date.now() - date.getTime();
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) {
    return 'just now';
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
};

type RevisionOption = DropdownOption<backend.RevisionEntry>;

const renderRevisionOption = (option: RevisionOption) => (
  <span className="rollback-revision-option">
    <span>{option.label}</span>
    {!!option.metadata?.changeCause && (
      <span className="rollback-revision-option-cause">{option.metadata.changeCause}</span>
    )}
  </span>
);

const RevisionCause = ({ entry }: { entry: backend.RevisionEntry | null }) => (
  <div className="rollback-comparison-cause" title={entry?.changeCause || undefined}>
    {entry?.changeCause}
  </div>
);

interface RollbackComparisonProps {
  currentEntry: backend.RevisionEntry | null;
  selectedEntry: backend.RevisionEntry | null;
  targets: backend.RevisionEntry[];
  onSelectRevision: (revision: number) => void;
}

/** Names the two revisions being compared, each above its side of the diff. */
const RollbackComparison = ({
  currentEntry,
  selectedEntry,
  targets,
  onSelectRevision,
}: RollbackComparisonProps) => {
  const options = useMemo<RevisionOption[]>(
    () =>
      targets.map((entry) => ({
        value: String(entry.revision),
        label: `Revision ${entry.revision} · ${formatAge(entry.createdAt)}`,
        metadata: entry,
      })),
    [targets]
  );

  return (
    <div className="rollback-comparison">
      <div className="rollback-comparison-side" data-testid="rollback-current">
        <span className="rollback-role rollback-role--current">Current</span>
        <div className="rollback-comparison-revision">
          {currentEntry ? (
            <>
              Revision {currentEntry.revision}
              <span className="rollback-comparison-age">{formatAge(currentEntry.createdAt)}</span>
            </>
          ) : (
            'Not available'
          )}
        </div>
        <RevisionCause entry={currentEntry} />
      </div>
      <div className="rollback-comparison-side" data-testid="rollback-target">
        <span className="rollback-role rollback-role--target">Rollback to</span>
        <Dropdown
          options={options}
          value={String(selectedEntry?.revision ?? '')}
          onChange={(value) => {
            const [revision] = normalizeDropdownValue(value);
            if (revision) {
              onSelectRevision(Number(revision));
            }
          }}
          renderOption={renderRevisionOption}
          ariaLabel="Revision to roll back to"
        />
        <RevisionCause entry={selectedEntry} />
      </div>
    </div>
  );
};

interface RollbackDiffProps {
  currentEntry: backend.RevisionEntry | null;
  selectedEntry: backend.RevisionEntry | null;
  diffOnly: boolean;
}

/** Diffs what the current revision applies (left) against the rollback target (right). */
const RollbackDiff = ({ currentEntry, selectedEntry, diffOnly }: RollbackDiffProps) => {
  const diffResult = useMemo(() => {
    if (!currentEntry || !selectedEntry) {
      return null;
    }
    const raw = computeBudgetedLineDiff(
      currentEntry.content,
      selectedEntry.content,
      ROLLBACK_DIFF_BUDGETS
    );

    return {
      lines: raw.tooLarge ? [] : mergeDiffLines(raw.lines),
      leftText: currentEntry.content,
      rightText: selectedEntry.content,
      tooLarge: raw.tooLarge,
      tooLargeReason: raw.tooLargeReason,
      leftLineCount: raw.leftLineCount,
      rightLineCount: raw.rightLineCount,
    } satisfies RollbackDiffState;
  }, [currentEntry, selectedEntry]);

  const visibleDiffRows = useMemo(
    () => (diffResult ? countVisibleDiffRows(diffResult.lines, diffOnly) : 0),
    [diffOnly, diffResult]
  );

  if (!diffResult) {
    return null;
  }
  if (diffResult.tooLarge || visibleDiffRows > ROLLBACK_DIFF_BUDGETS.maxRenderableRows) {
    return (
      <div className="rollback-diff-warning" data-testid="rollback-diff-warning">
        {getDiffTooLargeMessage(
          diffResult,
          visibleDiffRows,
          ROLLBACK_DIFF_BUDGETS,
          ROLLBACK_DIFF_TOO_LARGE_MESSAGE
        )}
      </div>
    );
  }
  return (
    <DiffViewer
      lines={diffResult.lines}
      leftText={diffResult.leftText}
      rightText={diffResult.rightText}
      showDiffOnly={diffOnly}
    />
  );
};

const RollbackModal = ({
  isOpen,
  onClose,
  clusterId,
  namespace,
  group,
  version,
  name,
  kind,
  onMutationChange,
}: RollbackModalProps) => {
  // Revision history state.
  const [revisions, setRevisions] = useState<backend.RevisionEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Selected revision number (null when nothing is selected yet).
  const [selectedRevision, setSelectedRevision] = useState<number | null>(null);

  // Diff display options.
  const [diffOnly, setDiffOnly] = useState(false);

  // Rollback state.
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [rollbackLoading, setRollbackLoading] = useState(false);
  const [rollbackError, setRollbackError] = useState<string | null>(null);

  // Ref for focus trap within the modal.
  const modalRef = useRef<HTMLDivElement>(null);

  // Fetch revision history when the modal opens.
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    let cancelled = false;
    setLoading(true);
    setFetchError(null);
    setRevisions([]);
    setSelectedRevision(null);
    setRollbackError(null);
    setDiffOnly(false);

    requestData({
      resource: 'revision-history',
      reason: 'user',
      read: () => readRevisionHistoryForRef({ clusterId, namespace, group, version, kind, name }),
    })
      .then((result) => {
        if (cancelled) {
          return;
        }
        const entries = result.status === 'executed' ? (result.data ?? []) : [];
        const sorted = [...entries].sort((a, b) => b.revision - a.revision);
        setRevisions(sorted);
        setSelectedRevision(sorted.find((entry) => !entry.current)?.revision ?? null);
      })
      .catch((err) => {
        if (cancelled) {
          return;
        }
        const details = errorHandler.handleInline(err, {
          action: 'loadRevisionHistory',
          source: 'RollbackModal',
          clusterId,
        });
        setFetchError(details.message);
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, clusterId, namespace, group, version, name, kind]);

  useModalFocusTrap({
    ref: modalRef,
    disabled: !isOpen,
    onEscape: () => {
      onClose();
      return true;
    },
  });

  // Derive the current revision entry and the selected entry.
  const currentEntry = useMemo(() => revisions.find((r) => r.current) ?? null, [revisions]);
  const selectedEntry = useMemo(
    () => revisions.find((r) => r.revision === selectedRevision) ?? null,
    [revisions, selectedRevision]
  );

  // The revisions a rollback can target.
  const targets = useMemo(() => revisions.filter((r) => !r.current), [revisions]);
  const showComparison = !loading && !fetchError && targets.length > 0;

  // Handle rollback confirmation.
  const handleRollback = useCallback(async () => {
    if (selectedRevision === null) {
      return;
    }
    setRollbackLoading(true);
    onMutationChange?.(true);
    setRollbackError(null);

    try {
      await runObjectRollback(
        buildObjectActionTarget({ clusterId, namespace, group, version, kind, name }, 'rollback'),
        selectedRevision
      );
      setConfirmOpen(false);
      onClose();
    } catch (err) {
      const details = errorHandler.handleInline(err, {
        action: 'rollbackWorkload',
        source: 'RollbackModal',
        clusterId,
      });
      setRollbackError(details.message);
      setConfirmOpen(false);
    } finally {
      setRollbackLoading(false);
      onMutationChange?.(false);
    }
  }, [
    clusterId,
    namespace,
    group,
    version,
    name,
    kind,
    selectedRevision,
    onClose,
    onMutationChange,
  ]);

  // Return null when the modal is not open.
  if (!isOpen) {
    return null;
  }

  return (
    <ModalSurface
      modalRef={modalRef}
      labelledBy="rollback-modal-title"
      onClose={onClose}
      containerClassName="rollback-modal"
      closeOnBackdrop={false}
    >
      <ModalHeader
        title={`Rollback ${kind} - ${name}`}
        titleId="rollback-modal-title"
        icon={RollbackIcon}
        onClose={onClose}
      />

      {/* Body */}
      {!!loading && (
        <div className="rollback-loading" data-testid="rollback-loading">
          <div className="loading-spinner">
            <div className="spinner" />
            <p>Loading revisions...</p>
          </div>
        </div>
      )}

      {!loading && fetchError && (
        <div className="rollback-error" data-testid="rollback-error">
          <ErrorSurface kind="reported" message={fetchError} />
        </div>
      )}

      {!loading && !fetchError && targets.length === 0 && (
        <div className="rollback-empty" data-testid="rollback-empty">
          No previous revisions available for rollback
        </div>
      )}

      {!!showComparison && (
        <div className="rollback-body">
          <RollbackComparison
            currentEntry={currentEntry}
            selectedEntry={selectedEntry}
            targets={targets}
            onSelectRevision={setSelectedRevision}
          />
          <div className="rollback-diff-content">
            <RollbackDiff
              currentEntry={currentEntry}
              selectedEntry={selectedEntry}
              diffOnly={diffOnly}
            />
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="rollback-modal-footer">
        {!!showComparison && (
          <label className="rollback-diff-only-toggle">
            <input
              type="checkbox"
              checked={diffOnly}
              onChange={(e) => setDiffOnly(e.target.checked)}
            />
            {'Diff only'}
          </label>
        )}
        {!!rollbackError && (
          <span className="rollback-modal-footer-error" title={rollbackError}>
            <ErrorSurface kind="reported" message={rollbackError} />
          </span>
        )}
        <button
          type="button"
          className="button cancel"
          onClick={onClose}
          disabled={rollbackLoading}
        >
          Cancel
        </button>
        <button
          type="button"
          className="button warning"
          disabled={selectedRevision === null || rollbackLoading || loading}
          onClick={() => setConfirmOpen(true)}
        >
          {rollbackLoading ? 'Rolling back...' : `Rollback to Revision ${selectedRevision ?? ''}`}
        </button>
      </div>

      {/* Confirmation dialog before performing rollback */}
      <ConfirmationModal
        isOpen={confirmOpen}
        title="Confirm Rollback"
        message={`Are you sure you want to roll back ${kind} "${name}" to revision ${selectedRevision}? This action cannot be undone.`}
        confirmText="Rollback"
        cancelText="Cancel"
        confirmButtonClass="warning"
        onConfirm={handleRollback}
        onCancel={() => setConfirmOpen(false)}
      />
    </ModalSurface>
  );
};

export default RollbackModal;
