/**
 * frontend/src/shared/components/modals/RollbackModal.tsx
 *
 * Modal for viewing revision history and rolling back a workload.
 * Left panel shows a scrollable revision list; right panel shows a
 * side-by-side diff between the current and selected revision pod templates.
 */

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import * as app from '@wailsjs/go/backend/App';
import type { backend } from '@wailsjs/go/models';
import { computeLineDiff } from '@modules/object-panel/components/ObjectPanel/Yaml/yamlDiff';
import { mergeDiffLines } from '@shared/components/diff/diffUtils';
import DiffViewer from '@shared/components/diff/DiffViewer';
import ConfirmationModal from './ConfirmationModal';
import ModalSurface from './ModalSurface';
import { useModalFocusTrap } from './useModalFocusTrap';
import './RollbackModal.css';

interface RollbackModalProps {
  isOpen: boolean;
  onClose: () => void;
  clusterId: string;
  namespace: string;
  name: string;
  kind: string; // "Deployment" | "StatefulSet" | "DaemonSet"
}

/**
 * Format an ISO timestamp as a human-readable relative age string.
 */
const formatAge = (isoString: string): string => {
  const date = new Date(isoString);
  const diffMs = Date.now() - date.getTime();
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
};

const RollbackModal = ({
  isOpen,
  onClose,
  clusterId,
  namespace,
  name,
  kind,
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
    if (!isOpen) return;

    setLoading(true);
    setFetchError(null);
    setRevisions([]);
    setSelectedRevision(null);
    setRollbackError(null);
    setDiffOnly(false);

    app
      .GetRevisionHistory(clusterId, namespace, name, kind)
      .then((entries) => {
        setRevisions(entries ?? []);

        // Auto-select the most recent non-current revision.
        const sortedNonCurrent = (entries ?? [])
          .filter((e) => !e.current)
          .sort((a, b) => b.revision - a.revision);
        if (sortedNonCurrent.length > 0) {
          setSelectedRevision(sortedNonCurrent[0].revision);
        }
      })
      .catch((err) => {
        setFetchError(String(err));
      })
      .finally(() => {
        setLoading(false);
      });
  }, [isOpen, clusterId, namespace, name, kind]);

  useModalFocusTrap({
    ref: modalRef,
    disabled: !isOpen,
  });

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [isOpen, onClose]);

  // Derive the current revision entry and the selected entry.
  const currentEntry = useMemo(() => revisions.find((r) => r.current) ?? null, [revisions]);
  const selectedEntry = useMemo(
    () => revisions.find((r) => r.revision === selectedRevision) ?? null,
    [revisions, selectedRevision]
  );

  // Whether there are any non-current revisions to roll back to.
  const hasNonCurrentRevisions = useMemo(() => revisions.some((r) => !r.current), [revisions]);

  // Compute diff lines between the current and selected pod templates.
  const diffResult = useMemo(() => {
    if (!currentEntry || !selectedEntry) return null;
    const raw = computeLineDiff(currentEntry.podTemplate, selectedEntry.podTemplate);
    return {
      lines: mergeDiffLines(raw.lines),
      leftText: currentEntry.podTemplate,
      rightText: selectedEntry.podTemplate,
    };
  }, [currentEntry, selectedEntry]);

  // Handle rollback confirmation.
  const handleRollback = useCallback(() => {
    if (selectedRevision === null) return;
    setRollbackLoading(true);
    setRollbackError(null);

    app
      .RollbackWorkload(clusterId, namespace, name, kind, selectedRevision)
      .then(() => {
        setConfirmOpen(false);
        onClose();
      })
      .catch((err) => {
        setRollbackError(String(err));
        setConfirmOpen(false);
      })
      .finally(() => {
        setRollbackLoading(false);
      });
  }, [clusterId, namespace, name, kind, selectedRevision, onClose]);

  // Return null when the modal is not open.
  if (!isOpen) {
    return null;
  }

  // Sort revisions by revision number descending for display.
  const sortedRevisions = [...revisions].sort((a, b) => b.revision - a.revision);

  return (
    <ModalSurface
      modalRef={modalRef}
      labelledBy="rollback-modal-title"
      onClose={onClose}
      containerClassName="rollback-modal"
      closeOnBackdrop={false}
    >
      {/* Header */}
      <div className="modal-header">
        <h2 id="rollback-modal-title">
          Rollback {kind} &mdash; {name}
        </h2>
        <button className="modal-close" onClick={onClose} aria-label="Close">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Body */}
      {loading && (
        <div className="rollback-loading" data-testid="rollback-loading">
          <div className="loading-spinner">
            <div className="spinner" />
            <p>Loading revisions...</p>
          </div>
        </div>
      )}

      {!loading && fetchError && (
        <div className="rollback-error" data-testid="rollback-error">
          {fetchError}
        </div>
      )}

      {!loading && !fetchError && !hasNonCurrentRevisions && (
        <div className="rollback-empty" data-testid="rollback-empty">
          No previous revisions available for rollback
        </div>
      )}

      {!loading && !fetchError && hasNonCurrentRevisions && (
        <div className="rollback-body">
          {/* Left panel: revision list */}
          <div className="rollback-revision-list" data-testid="rollback-revision-list">
            {sortedRevisions.map((entry) => {
              const isCurrent = entry.current;
              const isSelected = entry.revision === selectedRevision;
              const classNames = [
                'rollback-revision-item',
                isSelected ? 'rollback-revision-item--selected' : '',
                isCurrent ? 'rollback-revision-item--disabled' : '',
              ]
                .filter(Boolean)
                .join(' ');

              return (
                <button
                  key={entry.revision}
                  type="button"
                  className={classNames}
                  disabled={isCurrent}
                  onClick={() => setSelectedRevision(entry.revision)}
                  data-testid={`revision-item-${entry.revision}`}
                >
                  <div className="rollback-revision-item-header">
                    <span className="rollback-revision-number">Revision {entry.revision}</span>
                    {isCurrent && <span className="rollback-revision-badge">current</span>}
                  </div>
                  <span className="rollback-revision-age">{formatAge(entry.createdAt)}</span>
                  {entry.changeCause && (
                    <span className="rollback-revision-cause" title={entry.changeCause}>
                      {entry.changeCause}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Right panel: diff viewer */}
          <div className="rollback-diff-panel">
            <div className="rollback-diff-header">
              <span className="rollback-diff-label">
                Current &rarr; Revision {selectedRevision}
              </span>
              <label className="rollback-diff-only-toggle">
                <input
                  type="checkbox"
                  checked={diffOnly}
                  onChange={(e) => setDiffOnly(e.target.checked)}
                />
                Diff only
              </label>
            </div>
            <div className="rollback-diff-content">
              {diffResult && (
                <DiffViewer
                  lines={diffResult.lines}
                  leftText={diffResult.leftText}
                  rightText={diffResult.rightText}
                  showDiffOnly={diffOnly}
                />
              )}
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="rollback-modal-footer">
        {rollbackError && (
          <span className="rollback-modal-footer-error" title={rollbackError}>
            {rollbackError}
          </span>
        )}
        <button className="button cancel" onClick={onClose} disabled={rollbackLoading}>
          Cancel
        </button>
        <button
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
